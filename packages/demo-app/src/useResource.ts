import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ReportError } from "./types";

export function useResource<T>(path: string, report: ReportError) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const active = useRef<AbortController>();
  const refresh = useCallback(async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setFailed(false);
    try {
      const value = await api<T>("GET", path, undefined, controller.signal);
      if (!controller.signal.aborted) setData(value);
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailed(true);
        report(error, refresh);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [path, report]);
  useEffect(() => {
    setData(null);
    void refresh();
    return () => active.current?.abort();
  }, [refresh]);
  const update = useCallback((change: (current: T | null) => T | null) => {
    // A read started before a successful mutation must not overwrite its result.
    active.current?.abort();
    setData(change);
    setLoading(false);
    setFailed(false);
  }, []);
  return { data, loading, failed, refresh, update };
}

export function useAction(report: ReportError) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = async (task: () => Promise<void>): Promise<void> => {
    if (busy.current || !mounted.current) return;
    busy.current = true;
    setPending(true);
    try {
      await task();
    } catch (error) {
      if (mounted.current) report(error, () => run(task));
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  };
  return { pending, run };
}
