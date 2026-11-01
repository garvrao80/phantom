import type { Job, MaterializeEvent, Recording, Route } from "./types";
export type State = {
  requests: Recording[];
  routes: Record<string, Route>;
  job: Job | null;
  resetVersion: number;
};
export const initialState: State = {
  requests: [],
  routes: {},
  job: null,
  resetVersion: 0,
};
export type Action =
  | { type: "request"; data: Recording }
  | { type: "route"; data: Pick<Route, "key" | "mode" | "locked"> }
  | { type: "materialize"; data: MaterializeEvent }
  | { type: "begin"; jobId: string }
  | { type: "restore"; job: MaterializeEvent }
  | { type: "hydrate"; requests: Recording[]; routes: Route[] }
  | { type: "reset" };
const emptyRoute = (key: string): Route => ({
  key,
  mode: "PHANTOM",
  calls: 0,
  lastLatencyMs: 0,
  locked: false,
});
const recent = (requests: Recording[]) =>
  [...new Map(requests.map((rec) => [rec.seq, rec])).values()]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, 500);
export const isRunning = (job: Job | null) =>
  !!job && job.phase !== "done" && job.phase !== "failed";
export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { ...initialState, resetVersion: state.resetVersion + 1 };
    case "hydrate":
      return {
        ...state,
        requests: recent(action.requests),
        routes: Object.fromEntries(
          action.routes.map((route) => [route.key, route]),
        ),
      };
    case "request": {
      const rec = action.data;
      if (state.requests.some((existing) => existing.seq === rec.seq))
        return state;
      const route = state.routes[rec.routeKey] ?? emptyRoute(rec.routeKey);
      return {
        ...state,
        requests: recent([rec, ...state.requests]),
        routes: {
          ...state.routes,
          [rec.routeKey]: {
            ...route,
            calls: route.calls + 1,
            lastLatencyMs: rec.latencyMs,
          },
        },
      };
    }
    case "route":
      return {
        ...state,
        routes: {
          ...state.routes,
          [action.data.key]: {
            ...(state.routes[action.data.key] ?? emptyRoute(action.data.key)),
            ...action.data,
          },
        },
      };
    case "begin":
      return state.job?.jobId === action.jobId
        ? state
        : {
            ...state,
            job: { jobId: action.jobId, phase: "context", lines: [] },
          };
    case "restore":
      // A job still running on the server after a dashboard reload; live events take over from here.
      return state.job
        ? state
        : {
            ...state,
            job: {
              ...action.job,
              lines: ["Reconnected to a running job. Live output continues below."],
            },
          };
    case "materialize": {
      if (
        state.job &&
        state.job.jobId !== action.data.jobId &&
        isRunning(state.job)
      )
        return state;
      const previous =
        state.job?.jobId === action.data.jobId ? state.job : { lines: [] };
      // Delayed log chunks must never move a completed job back into a running phase.
      if (
        "phase" in previous &&
        (previous.phase === "done" || previous.phase === "failed") &&
        action.data.phase !== previous.phase
      )
        return state;
      return {
        ...state,
        job: {
          ...previous,
          ...action.data,
          lines: [
            ...previous.lines,
            ...(action.data.line ? [action.data.line] : []),
          ].slice(-1000),
        },
      };
    }
  }
}
