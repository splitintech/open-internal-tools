import { waitlistCss } from "./assets";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Familjen+Grotesk:ital,wght@0,400..700;1,400..700&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&family=Manrope:wght@700&display=swap";

const LOGO = `<a class="logo" href="/" aria-label="SplitIn home">
  <svg class="logo__mark" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true">
    <rect width="32" height="32" rx="8" fill="#EE7828"/>
    <rect x="15" y="7" width="2" height="18" rx="1" fill="#fff"/>
  </svg>
  <span class="logo__word"><span>Split</span><span class="logo__in">In</span></span>
</a>`;

export interface ShellCopy {
  title: string;
  eyebrow: string;
  headline: string;
  subhead: string;
  body: string;
  promises: readonly string[];
  meta?: string;
  card: string;
  scripts?: string;
}

export function renderShell(copy: ShellCopy): string {
  const promises = copy.promises
    .map(
      (item, index) =>
        `<li><span class="promises__n">${String(index + 1).padStart(2, "0")}</span><span class="promises__t">${escapeHtml(item)}</span></li>`,
    )
    .join("");
  const script = copy.scripts ? `<script>${copy.scripts}</script>` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(copy.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="${FONT_HREF}">
  <style>${waitlistCss()}</style>
</head>
<body>
  <div class="questionnaire-page min-h-[100dvh] bg-saffron-ember">
    <div class="molten" aria-hidden="true">
      <div class="molten__blob molten__blob--1"></div>
      <div class="molten__blob molten__blob--2"></div>
      <div class="molten__blob molten__blob--3"></div>
      <div class="molten__blob molten__blob--4"></div>
      <div class="molten__blob molten__blob--5"></div>
    </div>
    <div class="scrim-radial" aria-hidden="true"></div>
    <div class="scrim-linear" aria-hidden="true"></div>
    <div class="film-grain" aria-hidden="true"></div>
    <div class="page">
      <div class="page__inner">
        <header class="site-header">
          ${LOGO}
          <p class="header-meta">${escapeHtml(copy.meta ?? "Private share")}</p>
        </header>
        <h1 class="headline">${copy.headline}</h1>
        <main class="layout">
          <section class="copy">
            <p class="eyebrow"><span class="eyebrow__dot"></span>${escapeHtml(copy.eyebrow)}</p>
            <h2 class="subhead">${copy.subhead}</h2>
            <p class="lede">${escapeHtml(copy.body)}</p>
            <ul class="promises">${promises}</ul>
          </section>
          <div class="seam" aria-hidden="true"></div>
          <section>${copy.card}</section>
        </main>
        <footer class="site-footer">
          <p>© 2026 SplitIn</p>
          <a href="https://splitin.net/privacy">Privacy</a>
        </footer>
      </div>
    </div>
  </div>
  ${script}
</body>
</html>`;
}

export function card(inner: string): string {
  return `<div class="grain card"><div class="card__body">${inner}</div></div>`;
}
