import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEvents } from "../src/useEvents";
import { initialState, reducer } from "../src/state";
import { statistics } from "../src/components/Header";
import App from "../src/App";
import type { Recording } from "../src/types";

class FakeEvents {
  static instances: FakeEvents[] = [];
  listeners = new Map<string, Array<(event: { data: string }) => void>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    FakeEvents.instances.push(this);
  }
  addEventListener(type: string, callback: (event: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }
  emit(type: string, data: unknown) {
    this.listeners
      .get(type)
      ?.forEach((callback) => callback({ data: JSON.stringify(data) }));
  }
}
const route = {
  key: "POST /teams",
  mode: "PHANTOM",
  calls: 1,
  locked: true,
  lastLatencyMs: 320,
};
const rec = (seq = 1): Recording => ({
  seq,
  ts: 1793500000000 + seq,
  mode: "PHANTOM",
  ok: true,
  routeKey: "POST /teams",
  req: {
    method: "POST",
    path: "/teams",
    params: {},
    query: {},
    body: { name: "A" },
  },
  res: { status: 201, body: { id: `team_${seq}`, name: "A" } },
  storeOps: [],
  latencyMs: 320,
  retries: 0,
  tokens: { in: 100, out: 50 },
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
function setup(
  custom?: (
    url: string,
    options?: RequestInit,
  ) => Promise<Response> | undefined,
) {
  FakeEvents.instances = [];
  vi.stubGlobal("EventSource", FakeEvents);
  const fetcher = vi.fn(
    (url: string, options?: RequestInit) =>
      custom?.(url, options) ??
      Promise.resolve(
        json(
          url.endsWith("/routes")
            ? [route]
            : url.includes("/recordings")
              ? [rec()]
              : { ok: true, model: "gpt-oss-120b", replay: false },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("live state", () => {
  it("hydrates, deduplicates SSE requests, counts calls, updates locks and clears on reset", async () => {
    setup();
    const { result } = renderHook(useEvents);
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    const source = FakeEvents.instances[0];
    act(() => {
      source.emit("request", rec());
      source.emit("request", rec(2));
      source.emit("route", { key: route.key, mode: "REAL", locked: true });
    });
    expect(result.current.requests.map((row) => row.seq)).toEqual([2, 1]);
    expect(result.current.routes[route.key]).toMatchObject({
      calls: 2,
      mode: "REAL",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          json(
            url.endsWith("/health")
              ? { ok: true, model: "test", replay: false }
              : [],
          ),
        ),
      ),
    );
    await act(async () => {
      source.emit("reset", {});
    });
    expect(result.current.requests).toHaveLength(0);
    expect(result.current.routes).toEqual({});
  });

  it("preserves an event arriving during initial hydration and closes the stream on unmount", async () => {
    let resolveRecordings!: (response: Response) => void;
    setup((url) =>
      url.includes("/recordings")
        ? new Promise((resolve) => {
            resolveRecordings = resolve;
          })
        : undefined,
    );
    const { result, unmount } = renderHook(useEvents);
    const source = FakeEvents.instances[0];
    act(() => {
      source.emit("request", rec(2));
    });
    await act(async () => {
      resolveRecordings(json([rec()]));
    });
    expect(result.current.requests.map((row) => row.seq)).toEqual([2, 1]);
    unmount();
    expect(source.close).toHaveBeenCalledOnce();
  });

  it("refetches snapshots on SSE reconnect and ignores invalid events without losing data", async () => {
    const fetcher = setup();
    const { result } = renderHook(useEvents);
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    act(() => {
      FakeEvents.instances[0].onerror?.();
    });
    expect(result.current.connection).toBe("reconnecting");
    await act(async () => {
      FakeEvents.instances[0].onopen?.();
    });
    expect(result.current.connection).toBe("live");
    expect(fetcher).toHaveBeenCalledTimes(8);
    act(() => {
      FakeEvents.instances[0].emit("request", {});
    });
    expect(result.current.error).toContain("invalid request");
    expect(result.current.requests).toHaveLength(1);
  });

  it("does not let a pre-reset HTTP snapshot resurrect previous recordings", async () => {
    let resolveOld!: (response: Response) => void;
    setup((url) =>
      url.includes("/recordings")
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : undefined,
    );
    const { result } = renderHook(useEvents);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          json(
            url.endsWith("/health")
              ? { ok: true, model: "test", replay: false }
              : [],
          ),
        ),
      ),
    );
    await act(async () => {
      FakeEvents.instances[0].emit("reset", {});
    });
    await act(async () => {
      resolveOld(json([rec()]));
    });
    expect(result.current.requests).toHaveLength(0);
  });
});

describe("materialize controls", () => {
  it("changes replay through the proxy and uses its confirmed setting", async () => {
    const fetcher = setup((url) =>
      url === "/phantom/replay"
        ? Promise.resolve(json({ replay: true }))
        : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await act(async () => {
      FakeEvents.instances[0].onopen?.();
    });
    await user.click(
      screen.getByRole("switch", { name: "Server replay mode" }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("switch", {
            name: "Server replay mode",
          }) as HTMLInputElement
        ).checked,
      ).toBe(true),
    );
    expect(
      fetcher.mock.calls.find(([url]) => url === "/phantom/replay")?.[1]?.body,
    ).toBe(JSON.stringify({ on: true }));
  });

  it("posts selected routes, preserves early job output, and only announces success after done", async () => {
    let resolveStart!: (response: Response) => void;
    const fetcher = setup((url) =>
      url === "/phantom/materialize"
        ? new Promise((resolve) => {
            resolveStart = resolve;
          })
        : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("checkbox", { name: "Select POST /teams" });
    await act(async () => {
      FakeEvents.instances[0].onopen?.();
    });
    await user.click(
      screen.getByRole("checkbox", { name: "Select POST /teams" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Materialize selected/ }),
    );
    expect(
      fetcher.mock.calls.find(([url, options]) => url === "/phantom/materialize" && options?.method === "POST")?.[1]
        ?.body,
    ).toBe(JSON.stringify({ routes: ["POST /teams"] }));
    await act(async () => {
      FakeEvents.instances[0].emit("materialize", {
        jobId: "job_1",
        phase: "tests",
        line: "Checking every recording",
        tests: { passed: 8, failed: 0, total: 8 },
      });
      resolveStart(json({ jobId: "job_1" }, 202));
    });
    expect(
      screen.getByLabelText("Materialize job output").textContent,
    ).toContain("Checking every recording");
    expect(screen.queryByText(/Verification complete/)).toBeNull();
    expect(
      screen
        .getByRole("button", { name: /Reset session/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    act(() => {
      FakeEvents.instances[0].emit("route", {
        key: route.key,
        mode: "REAL",
        locked: true,
      });
      FakeEvents.instances[0].emit("materialize", {
        jobId: "job_1",
        phase: "done",
        tests: { passed: 8, failed: 0, total: 8 },
      });
    });
    expect(screen.getByText("✓ 8 tests passed")).toBeTruthy();
    expect(
      screen
        .getByRole("checkbox", { name: "Select POST /teams" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("shows failure and retries through the agreed retry endpoint", async () => {
    const fetcher = setup((url) =>
      url.endsWith("/retry")
        ? Promise.resolve(json({ jobId: "job_2" }, 202))
        : undefined,
    );
    const user = userEvent.setup();
    render(<App />);
    await act(async () => {
      FakeEvents.instances[0].onopen?.();
    });
    act(() =>
      FakeEvents.instances[0].emit("materialize", {
        jobId: "job_1",
        phase: "failed",
        line: "Replay mismatch",
        tests: { passed: 7, failed: 1, total: 8 },
      }),
    );
    expect(screen.getByText("Materialize failed")).toBeTruthy();
    expect(screen.queryByText(/Verification complete/)).toBeNull();
    await user.click(
      screen.getByRole("button", { name: /Retry with failure output/ }),
    );
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url]) => url === "/phantom/materialize/retry",
        ),
      ).toBe(true),
    );
    expect(
      screen.getByLabelText("Materialize job output").textContent,
    ).not.toContain("Replay mismatch");
  });

  it("requires explicit reset confirmation and never posts reset on cancel", async () => {
    const fetcher = setup();
    const user = userEvent.setup();
    render(<App />);
    await act(async () => {
      FakeEvents.instances[0].onopen?.();
    });
    await user.click(screen.getByRole("button", { name: /Reset session/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Keep session" }));
    expect(fetcher.mock.calls.some(([url]) => url === "/phantom/reset")).toBe(
      false,
    );
    await user.click(screen.getByRole("button", { name: /Reset session/ }));
    await user.click(screen.getByRole("button", { name: "Reset everything" }));
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url, options]) =>
            url === "/phantom/reset" && options?.method === "POST",
        ),
      ).toBe(true),
    );
  });
});

describe("bounded state and statistics", () => {
  it("caps recordings and isolates job logs; terminal jobs cannot regress", () => {
    let state = initialState;
    for (let seq = 1; seq <= 510; seq++)
      state = reducer(state, { type: "request", data: rec(seq) });
    expect(state.requests).toHaveLength(500);
    expect(state.routes[route.key].calls).toBe(510);
    state = reducer(state, {
      type: "materialize",
      data: { jobId: "one", phase: "failed", line: "old failure" },
    });
    state = reducer(state, {
      type: "materialize",
      data: { jobId: "two", phase: "codex", line: "new work" },
    });
    expect(state.job?.lines).toEqual(["new work"]);
    state = reducer(state, {
      type: "materialize",
      data: { jobId: "two", phase: "done" },
    });
    state = reducer(state, {
      type: "materialize",
      data: { jobId: "two", phase: "codex", line: "late chunk" },
    });
    expect(state.job?.phase).toBe("done");
  });
  it("uses a true median and excludes cached/replay token reuse from estimated billing", () => {
    const result = statistics([
      rec(),
      { ...rec(2), latencyMs: 100, cached: true },
      { ...rec(3), latencyMs: 20, mode: "REPLAY" },
      { ...rec(4), latencyMs: 400 },
    ]);
    expect(result.median).toBe(210);
    expect(result.tokens).toBe(300);
    expect(result.cost).toBeCloseTo(0.000145);
  });
});

describe("job recovery", () => {
  it("restores a running job after a reload and keeps following live events", async () => {
    setup((url) =>
      url === "/phantom/materialize"
        ? Promise.resolve(
            json({ running: true, job: { jobId: "job_9", routes: ["POST /teams"], phase: "codex" } }),
          )
        : undefined,
    );
    const { result } = renderHook(useEvents);
    await waitFor(() => expect(result.current.job?.jobId).toBe("job_9"));
    expect(result.current.job?.phase).toBe("codex");
    act(() => {
      FakeEvents.instances[0].emit("materialize", {
        jobId: "job_9",
        phase: "done",
        tests: { passed: 4, failed: 0, total: 4 },
      });
    });
    expect(result.current.job).toMatchObject({ phase: "done", tests: { passed: 4 } });
  });

  it("does not resurrect a finished job after a reload", async () => {
    setup((url) =>
      url === "/phantom/materialize"
        ? Promise.resolve(json({ running: false, job: { jobId: "job_8", phase: "done" } }))
        : undefined,
    );
    const { result } = renderHook(useEvents);
    await waitFor(() => expect(result.current.requests).toHaveLength(1));
    expect(result.current.job).toBeNull();
  });
});
