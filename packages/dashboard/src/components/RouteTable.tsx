import { useEffect, useRef, useState } from "react";
import type { Route } from "../types";
import { ModeBadge } from "./ModeBadge";
function RouteRow({
  route,
  selected,
  disabled,
  toggle,
  inspect,
}: {
  route: Route;
  selected: boolean;
  disabled: boolean;
  toggle: () => void;
  inspect: () => void;
}) {
  const previous = useRef(route.mode);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (previous.current !== "REAL" && route.mode === "REAL") {
      setFlash(true);
      const timer = setTimeout(() => setFlash(false), 600);
      previous.current = route.mode;
      return () => clearTimeout(timer);
    }
    previous.current = route.mode;
  }, [route.mode]);
  const [method, ...path] = route.key.split(" ");
  return (
    <div className={`route-row ${flash ? "route-flash" : ""}`}>
      <input
        type="checkbox"
        aria-label={`Select ${route.key}`}
        checked={selected}
        disabled={disabled || !route.locked || route.mode === "REAL"}
        onChange={toggle}
      />
      <button
        className="route-name"
        onClick={inspect}
        title={`Show requests for ${route.key}`}
      >
        <span className={`method method-${method.toLowerCase()}`}>
          {method}
        </span>
        <span>{path.join(" ")}</span>
      </button>
      <div className="route-info">
        <ModeBadge mode={route.mode} />
        <span className="route-calls">
          {route.calls} calls{" "}
          <span
            title={
              route.locked
                ? "Response schema locked"
                : "Awaiting response schema"
            }
            aria-label={route.locked ? "Schema locked" : "Schema not locked"}
          >
            {route.locked ? "▣" : "□"}
          </span>
        </span>
      </div>
    </div>
  );
}
export function RouteTable({
  routes,
  selected,
  setSelected,
  busy,
  materialize,
  inspect,
}: {
  routes: Route[];
  selected: string[];
  setSelected: (keys: string[]) => void;
  busy: boolean;
  materialize: () => void;
  inspect: (key: string) => void;
}) {
  const eligible = routes.filter(
    (route) => route.locked && route.mode !== "REAL",
  );
  return (
    <section className="panel route-panel" aria-labelledby="routes-title">
      <div className="panel-heading">
        <h2 id="routes-title">
          <span className="section-icon">⌘</span> Routes{" "}
          <span className="number-label">{routes.length}</span>
        </h2>
        <button
          className="text-button"
          disabled={busy || !eligible.length}
          onClick={() =>
            setSelected(
              eligible.every((route) => selected.includes(route.key))
                ? []
                : eligible.map((route) => route.key),
            )
          }
        >
          {eligible.length &&
          eligible.every((route) => selected.includes(route.key))
            ? "Clear"
            : "Select all"}
        </button>
      </div>
      <div className="route-list">
        {routes.map((route) => (
          <RouteRow
            key={route.key}
            route={route}
            selected={selected.includes(route.key)}
            disabled={busy}
            toggle={() =>
              setSelected(
                selected.includes(route.key)
                  ? selected.filter((key) => key !== route.key)
                  : [...selected, route.key],
              )
            }
            inspect={() => inspect(route.key)}
          />
        ))}
        {!routes.length && (
          <div className="empty-routes">
            <span aria-hidden="true">⌘</span>
            <h3>Your API takes shape here.</h3>
            <p>Routes appear automatically as your frontend makes requests.</p>
          </div>
        )}
      </div>
      <div className="materialize-action">
        <p>
          <span className="lock-icon">▣</span> Select routes with a locked
          response schema.
        </p>
        <button
          className="primary-button"
          disabled={busy || !selected.length}
          onClick={materialize}
        >
          <span>✦</span>
          {busy ? "Materializing…" : "Materialize selected"}
          <span className="selection-count">{selected.length}</span>
        </button>
        <small>Recorded behavior → tested backend code</small>
      </div>
    </section>
  );
}
