export function RetryButton({
  disabled,
  busy,
  onClick,
}: {
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="siv-button" onClick={onClick} disabled={disabled || busy} aria-busy={busy || undefined}>
      {busy ? 'Retrying…' : 'Retry verification'}
    </button>
  );
}

export default RetryButton;
