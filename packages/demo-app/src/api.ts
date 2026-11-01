export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown,
  ) {
    super(message);
  }
}
export let lastMode = "WAITING";
const listeners = new Set<(mode: string) => void>();
export function onMode(listener: (mode: string) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ApiError(
      "Cannot reach Phantom. Check that the proxy is running.",
      0,
    );
  }
  const mode = response.headers.get("x-phantom-mode");
  if (mode) {
    lastMode = mode;
    listeners.forEach((listener) => listener(mode));
  }
  const text = response.status === 204 ? "" : await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(
      response.ok
        ? "The server returned an invalid JSON response."
        : `Request failed (${response.status}). Check the proxy connection.`,
      response.status,
    );
  }
  if (!response.ok) {
    const detail =
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : response.statusText;
    throw new ApiError(
      response.status === 429
        ? "Slow down a little — the model's request limit was reached. Wait a minute before trying again."
        : response.status === 502
        ? "Phantom could not complete that request. You can retry."
        : detail || `Request failed (${response.status}).`,
      response.status,
      data,
    );
  }
  return data as T;
}
