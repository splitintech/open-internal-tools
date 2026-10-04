import { card, escapeHtml, renderShell } from "./shell";

function field(opts: {
  name: string;
  label: string;
  type?: string;
  value?: string;
  placeholder?: string;
  autocomplete?: string;
  required?: boolean;
  hidden?: boolean;
}): string {
  if (opts.hidden) {
    return `<input type="hidden" name="${escapeHtml(opts.name)}" value="${escapeHtml(opts.value ?? "")}">`;
  }
  const type = opts.type ?? "text";
  const required = opts.required === false ? "" : " required";
  const autocomplete = opts.autocomplete ? ` autocomplete="${escapeHtml(opts.autocomplete)}"` : "";
  const placeholder = opts.placeholder ? ` placeholder="${escapeHtml(opts.placeholder)}"` : "";
  const value = opts.value ? ` value="${escapeHtml(opts.value)}"` : "";
  const inputMode = type === "email" ? ' inputmode="email"' : type === "text" && opts.name === "code" ? ' inputmode="numeric"' : "";
  return `<div class="field">
    <label class="field__label" for="${escapeHtml(opts.name)}">${escapeHtml(opts.label)}</label>
    <input class="field__input" id="${escapeHtml(opts.name)}" name="${escapeHtml(opts.name)}" type="${escapeHtml(type)}"${value}${placeholder}${autocomplete}${inputMode}${required}>
  </div>`;
}

function note(message: string | undefined, error: boolean): string {
  if (!message) return `<p class="note">Email, then code, then continue</p>`;
  return `<p class="note${error ? " note--error" : ""}" aria-live="polite">${escapeHtml(message)}</p>`;
}

export function recipientSignInPage(next: string, error?: string): string {
  const inner = `
    <div class="card__kicker">
      <p class="kicker">Recipient</p>
      <p class="kicker">Private</p>
    </div>
    <h2 class="card__title">Enter with your work email</h2>
    <p class="card__hint">A one-time code proves who you are. You still need to be invited.</p>
    <form class="stack" method="post" action="/__group-share/signin" novalidate>
      ${field({ name: "next", hidden: true, label: "next", value: next })}
      ${field({
        name: "email",
        label: "Email address",
        type: "email",
        placeholder: "maya@splitin.net",
        autocomplete: "username",
      })}
      <button class="btn" type="submit">Send code</button>
      ${note(error, Boolean(error))}
    </form>`;
  return renderShell({
    title: "Sign in · Group share",
    eyebrow: "Group share",
    headline: `Open this <em>share</em>.`,
    subhead: `Sign in as the person who was <em>invited</em>.`,
    body: "Forwarding the URL is not enough. Enter your email, then the code.",
    promises: [
      "AirDrop and a forwarded link are the same URL.",
      "Only invited people get a code.",
      "Open this from the office network or VPN.",
    ],
    card: card(inner),
  });
}

export function recipientVerifyPage(email: string, next: string, error?: string): string {
  const inner = `
    <div class="card__kicker">
      <p class="kicker">Recipient</p>
      <p class="kicker">Code</p>
    </div>
    <h2 class="card__title">Enter the code</h2>
    <p class="card__hint">Sent to ${escapeHtml(email)}. This cookie only remembers who you are — not whether you may enter.</p>
    <form class="stack" method="post" action="/__group-share/verify" novalidate>
      ${field({ name: "next", hidden: true, label: "next", value: next })}
      ${field({ name: "email", hidden: true, label: "email", value: email })}
      ${field({
        name: "code",
        label: "One-time code",
        placeholder: "123456",
        autocomplete: "one-time-code",
      })}
      <button class="btn" type="submit">Continue</button>
      ${note(error, Boolean(error))}
    </form>`;
  return renderShell({
    title: "Enter code · Group share",
    eyebrow: "Group share",
    headline: `Prove it's <em>you</em>.`,
    subhead: `Then the gateway checks the <em>group</em>.`,
    body: "A valid code issues a host-scoped session. Membership and IP are re-checked on the next request, and on every request after that.",
    promises: [
      "The cookie is bound to this share label.",
      "Someone off the invite list is still forbidden.",
      "Someone off the allowlist is still forbidden.",
    ],
    card: card(inner),
  });
}

export function statusPage(title: string, message: string): string {
  const inner = `
    <div class="card__kicker">
      <p class="kicker">Access</p>
      <p class="kicker">Closed</p>
    </div>
    <h2 class="card__title">${escapeHtml(title)}</h2>
    <p class="card__hint">${escapeHtml(message)}</p>
    <p class="note">Having the link is not membership</p>`;
  return renderShell({
    title: `${title} · Group share`,
    eyebrow: "Group share",
    headline: `This door stays <em>shut</em>.`,
    subhead: `Invite list and network, every <em>time</em>.`,
    body: message,
    promises: [
      "Unknown or revoked labels 404.",
      "Outsiders on an allowed IP are still 403.",
      "Members off the allowlist are still 403.",
    ],
    card: card(inner),
  });
}
