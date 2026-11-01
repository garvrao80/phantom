import { useCallback, useEffect, useReducer, useState } from "react";
import { control } from "./api";
import { initialState, reducer, type Action } from "./state";
import type {
  Connection,
  Health,
  MaterializeEvent,
  Recording,
  Route,
} from "./types";

export function useEvents() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const reconnect = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let closed = false;
    let generation = 0;
    let controller: AbortController | undefined;
    let buffer: Action[] | null = null;
    const source = new EventSource("/phantom/events");
    setConnection("connecting");
    const apply = (action: Action) => {
      if (buffer) buffer.push(action);
      else dispatch(action);
    };
    async function hydrate() {
      const current = ++generation;
      controller?.abort();
      controller = new AbortController();
      // Keep events arriving during the snapshot fetch; replay only requests newer than its watermark.
      buffer ??= [];
      try {
        const [routes, requests, nextHealth] = await Promise.all([
          control<Route[]>("/routes", undefined, controller.signal),
          control<Recording[]>(
            "/recordings?limit=200",
            undefined,
            controller.signal,
          ),
          control<Health>("/health", undefined, controller.signal),
        ]);
        if (closed || current !== generation) return;
        if (!Array.isArray(routes) || !Array.isArray(requests))
          throw new Error(
            "The proxy returned an invalid routes or recordings list.",
          );
        dispatch({ type: "hydrate", routes, requests });
        setHealth(nextHealth);
        const watermark = Math.max(0, ...requests.map((rec) => rec.seq));
        buffer?.forEach((action) => {
          if (action.type !== "request" || action.data.seq > watermark)
            dispatch(action);
        });
        buffer = null;
        setError(null);
      } catch (failure) {
        if (closed || current !== generation) return;
        buffer?.forEach(dispatch);
        buffer = null;
        setError(
          failure instanceof Error
            ? failure.message
            : "Cannot load proxy state.",
        );
      }
    }
    const listen = (name: string, handler: (value: any) => void) =>
      source.addEventListener(name, (event) => {
        try {
          handler(JSON.parse((event as MessageEvent).data));
        } catch {
          setError(
            `An invalid ${name} event was ignored. Reconnect to refresh state.`,
          );
        }
      });
    listen("request", (data: Recording) => {
      if (
        !Number.isFinite(data.seq) ||
        !data.req ||
        !data.res ||
        !data.routeKey
      )
        throw new Error("Invalid recording");
      apply({ type: "request", data });
    });
    listen("route", (data: Pick<Route, "key" | "mode" | "locked">) => {
      if (!data.key) throw new Error("Invalid route");
      apply({ type: "route", data });
    });
    listen("materialize", (data: MaterializeEvent) => {
      if (
        !data.jobId ||
        !["context", "codex", "tests", "activate", "done", "failed"].includes(
          data.phase,
        )
      )
        throw new Error("Invalid job");
      apply({ type: "materialize", data });
    });
    listen("reset", () => {
      generation++;
      controller?.abort();
      buffer = null;
      dispatch({ type: "reset" });
      void hydrate();
    });
    source.onopen = () => {
      setConnection("live");
      void hydrate();
    };
    source.onerror = () => {
      setConnection("reconnecting");
    };
    void hydrate();
    return () => {
      closed = true;
      generation++;
      controller?.abort();
      source.close();
    };
  }, [attempt]);
  async function setReplay(on: boolean) {
    const result = await control<{ replay: boolean }>("/replay", { on });
    if (typeof result?.replay !== "boolean")
      throw new Error("The proxy did not confirm replay mode.");
    setHealth((previous) =>
      previous ? { ...previous, replay: result.replay } : previous,
    );
  }
  return {
    ...state,
    health,
    connection,
    error,
    reconnect,
    setReplay,
    beginJob: (jobId: string) => dispatch({ type: "begin", jobId }),
    clear: () => dispatch({ type: "reset" }),
  };
}
