export const styles = `
:where(.siv){color:var(--siv-fg,#111827);background:var(--siv-bg,#fff);font-family:var(--siv-font,system-ui,sans-serif)}
`;

let injected = false;

export function injectDefaultStyles(): void {
  if (injected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.dataset.siv = 'verification-react';
  style.textContent = styles;
  document.head.appendChild(style);
  injected = true;
}
