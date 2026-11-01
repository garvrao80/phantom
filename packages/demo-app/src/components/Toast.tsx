export type Notice = { message: string; retry: () => Promise<void> };
export function Toast({
  notice,
  dismiss,
}: {
  notice: Notice | null;
  dismiss: () => void;
}) {
  if (!notice) return null;
  return (
    <div className="toast" role="alert">
      <div>
        <strong>That didn’t go through</strong>
        <p>{notice.message}</p>
      </div>
      <button
        onClick={() => {
          dismiss();
          void notice.retry();
        }}
      >
        Retry
      </button>
      <button
        className="icon-button"
        aria-label="Dismiss error"
        onClick={dismiss}
      >
        ×
      </button>
    </div>
  );
}
