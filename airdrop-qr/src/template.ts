import type { AirdropQrEntry, Theme } from "./types";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cardStyles(theme: Theme): string {
  return `
    :root {
      --bg: ${theme.background};
      --ink: ${theme.ink};
      --muted: ${theme.muted};
      --accent: ${theme.accent};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      background: var(--bg);
      color: var(--ink);
      font-family: Georgia, "Times New Roman", serif;
    }
    main {
      width: min(100%, 22rem);
      text-align: center;
    }
    .brand {
      margin: 0 0 0.35rem;
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.1;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.35rem;
      font-weight: 600;
      line-height: 1.2;
    }
    .blurb {
      margin: 0 0 1.25rem;
      color: var(--muted);
      font-size: 1rem;
      line-height: 1.35;
    }
    .qr {
      display: grid;
      place-items: center;
      margin: 0 auto 1.25rem;
      padding: 0.75rem;
      width: min(100%, 20rem);
      background: #ffffff;
      border-radius: 0.35rem;
    }
    .qr svg {
      display: block;
      width: 100%;
      height: auto;
    }
    a.url {
      display: inline-block;
      color: var(--accent);
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      font-size: 0.85rem;
      line-height: 1.4;
      word-break: break-all;
      text-underline-offset: 0.15em;
    }
  `.trim();
}

function indexStyles(theme: Theme): string {
  return `
    :root {
      --bg: ${theme.background};
      --ink: ${theme.ink};
      --muted: ${theme.muted};
      --accent: ${theme.accent};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100dvh;
      padding: 1.75rem 1.25rem 2.5rem;
      background: var(--bg);
      color: var(--ink);
      font-family: Georgia, "Times New Roman", serif;
    }
    main { width: min(100%, 28rem); margin: 0 auto; }
    .brand {
      margin: 0 0 0.35rem;
      font-size: 1.75rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.35rem;
      font-weight: 600;
    }
    .blurb {
      margin: 0 0 1.5rem;
      color: var(--muted);
      line-height: 1.4;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 0.85rem;
    }
    li {
      display: grid;
      gap: 0.2rem;
    }
    a {
      color: var(--accent);
      font-size: 1.1rem;
      font-weight: 600;
      text-underline-offset: 0.15em;
    }
    span {
      color: var(--muted);
      font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      font-size: 0.8rem;
      word-break: break-all;
    }
  `.trim();
}

export function renderCardHtml(args: {
  theme: Theme;
  entry: AirdropQrEntry;
  displayUrl: string;
  svg: string;
}): string {
  const title = escapeHtml(args.entry.label);
  const blurb = escapeHtml(args.entry.blurb ?? "Scan to open the link");
  const brand = escapeHtml(args.theme.brand);
  const href = escapeHtml(args.displayUrl);
  const textUrl = escapeHtml(args.displayUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${brand} — ${title}</title>
  <style>
${cardStyles(args.theme)}
  </style>
</head>
<body>
  <main>
    <p class="brand">${brand}</p>
    <h1>${title}</h1>
    <p class="blurb">${blurb}</p>
    <div class="qr" aria-hidden="true">${args.svg}</div>
    <a class="url" href="${href}">${textUrl}</a>
  </main>
</body>
</html>
`;
}

export function renderIndexHtml(args: {
  theme: Theme;
  entries: AirdropQrEntry[];
  title: string;
  blurb: string;
}): string {
  const brand = escapeHtml(args.theme.brand);
  const title = escapeHtml(args.title);
  const blurb = escapeHtml(args.blurb);
  const items = args.entries
    .map(
      (entry) =>
        `      <li><a href="./${escapeHtml(entry.slug)}.html">${escapeHtml(entry.label)}</a><span>${escapeHtml(entry.url)}</span></li>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>${brand} — ${title}</title>
  <style>
${indexStyles(args.theme)}
  </style>
</head>
<body>
  <main>
    <p class="brand">${brand}</p>
    <h1>${title}</h1>
    <p class="blurb">${blurb}</p>
    <ul>
${items}
    </ul>
  </main>
</body>
</html>
`;
}
