import { shareJs } from "./assets";
import { card, escapeHtml, renderShell } from "./shell";
import type { Group, Share } from "../core/types";

export const DEFAULT_GROUP_ID = "default";

function field(opts: {
  name: string;
  label: string;
  type?: string;
  value?: string;
  placeholder?: string;
  required?: boolean;
}): string {
  const required = opts.required === false ? "" : " required";
  const value = opts.value ? ` value="${escapeHtml(opts.value)}"` : "";
  const placeholder = opts.placeholder ? ` placeholder="${escapeHtml(opts.placeholder)}"` : "";
  return `<div class="field">
    <label class="field__label" for="${escapeHtml(opts.name)}">${escapeHtml(opts.label)}</label>
    <input class="field__input" id="${escapeHtml(opts.name)}" name="${escapeHtml(opts.name)}" type="${escapeHtml(opts.type ?? "text")}"${value}${placeholder}${required}>
  </div>`;
}

function hidden(name: string, value: string): string {
  return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
}

function list(items: readonly string[], empty: string): string {
  if (items.length === 0) return `<p class="note">${escapeHtml(empty)}</p>`;
  return `<ul class="list">${items.map((item) => `<li><span>${escapeHtml(item)}</span></li>`).join("")}</ul>`;
}

export interface AdminView {
  groups: readonly Group[];
  shares: readonly Share[];
  selected?: Group | null;
  mintedUrl?: string;
  autoShare?: boolean;
  error?: string;
  notice?: string;
  form?: {
    emails?: string;
    originUrl?: string;
    ttlDays?: string;
  };
}

export function adminLoginPage(error?: string): string {
  const inner = `
    <div class="card__kicker">
      <p class="kicker">Operator</p>
      <p class="kicker">Admin</p>
    </div>
    <h2 class="card__title">Open the share desk</h2>
    <p class="card__hint">Use the operator token. Local CLI defaults this to GROUP_SHARE_SECRET.</p>
    <form class="stack" method="post" action="/__group-share/admin/login">
      ${field({
        name: "token",
        label: "Operator token",
        type: "password",
        placeholder: "GROUP_SHARE_OPERATOR_TOKEN",
      })}
      <button class="btn" type="submit">Enter</button>
      <p class="note${error ? " note--error" : ""}">${escapeHtml(error ?? "This is not a share. Recipients use a minted subdomain.")}</p>
    </form>`;
  return renderShell({
    title: "Admin · Group share",
    eyebrow: "Operator",
    headline: `Share a URL <em>private</em>.`,
    subhead: `Share it from this phone.`,
    body: "Three asks: who can open it, what you are sharing, and how long it lasts. Then Share from this device.",
    promises: [
      "Your current network is allowed automatically.",
      "Share uses the device sheet (AirDrop on iPhone).",
      "Copy link is the fallback where the sheet is missing.",
    ],
    card: card(inner),
  });
}

export function adminDashboardPage(view: AdminView): string {
  const selected =
    view.selected ??
    view.groups.find((group) => group.groupId === DEFAULT_GROUP_ID) ??
    view.groups[0] ??
    null;
  const groupId = selected?.groupId ?? DEFAULT_GROUP_ID;
  const minted = view.mintedUrl ?? "";
  const ttl = view.form?.ttlDays ?? "7";
  const emails =
    view.form?.emails ?? (selected?.members.length ? selected.members.join(", ") : "");
  const originUrl = view.form?.originUrl ?? "http://127.0.0.1:4010";
  const groupOptions = view.groups
    .map(
      (group) =>
        `<option value="${escapeHtml(group.groupId)}"${group.groupId === groupId ? " selected" : ""}>${escapeHtml(group.groupId)}</option>`,
    )
    .join("");

  const shareBlock = minted
    ? `
      <div class="field">
        <label class="field__label" for="share-url">Private URL</label>
        <input class="url-box" id="share-url" data-share-url-value readonly value="${escapeHtml(minted)}">
      </div>
      <div class="btn-row">
        <button class="btn" type="button" data-share${view.autoShare ? " data-auto-share" : ""} data-share-url="${escapeHtml(minted)}" data-share-title="Private group share" data-share-text="Open this private share. Sign-in and the group network still apply.">Share again</button>
        <button class="btn btn--ghost" type="button" data-copy data-share-url="${escapeHtml(minted)}">Copy link</button>
      </div>
      <p class="note" data-share-status>AirDrop is the system sheet, not a second access path</p>`
    : "";

  const advanced = `
    <details class="advanced">
      <summary class="advanced__summary">Advanced</summary>
      <div class="advanced__body stack">
        <p class="note">Defaults hide these. Use only when you need another group, a wider network, or a revoke.</p>
        <form class="stack" method="get" action="/">
          <div class="field">
            <label class="field__label" for="group">Active group</label>
            <select class="field__select" id="group" name="group" onchange="this.form.submit()">
              ${groupOptions || `<option value="${DEFAULT_GROUP_ID}">${DEFAULT_GROUP_ID}</option>`}
            </select>
          </div>
        </form>
        <form class="stack" method="post" action="/__group-share/admin/groups">
          ${field({ name: "groupId", label: "Create group id", placeholder: "design", required: false })}
          <button class="btn btn--ghost" type="submit">Create group</button>
        </form>
        <p class="kicker">Network allowlist</p>
        ${list(selected?.cidrs ?? [], "No CIDRs yet — Share seeds your current IP")}
        <form class="stack" method="post" action="/__group-share/admin/cidr">
          ${hidden("groupId", groupId)}
          ${field({ name: "cidr", label: "Add CIDR", placeholder: "203.0.113.0/24" })}
          <button class="btn btn--ghost" type="submit">Add network</button>
        </form>
        <form class="stack" method="post" action="/__group-share/admin/revoke">
          ${hidden("groupId", groupId)}
          <button class="btn btn--ghost" type="submit">Revoke latest share</button>
        </form>
      </div>
    </details>`;

  const inner = `
    <div class="card__kicker">
      <p class="kicker">Admin</p>
      <p class="kicker">Three asks</p>
    </div>
    <h2 class="card__title">Share with the group</h2>
    <p class="card__hint">Who can open it, what you are sharing, and how long it lasts.</p>
    ${view.error ? `<p class="note note--error" aria-live="polite">${escapeHtml(view.error)}</p>` : ""}
    ${view.notice && !view.error ? `<p class="note" aria-live="polite">${escapeHtml(view.notice)}</p>` : ""}

    <form class="stack" method="post" action="/__group-share/admin/quick-share">
      ${hidden("groupId", groupId)}
      <div class="field">
        <label class="field__label" for="emails">Who</label>
        <input class="field__input" id="emails" name="emails" type="text" value="${escapeHtml(emails)}" placeholder="ada@example.com, bob@example.com" required autocomplete="email">
      </div>
      ${field({
        name: "originUrl",
        label: "Where",
        value: originUrl,
        placeholder: "http://127.0.0.1:4010",
      })}
      <div class="field">
        <label class="field__label" for="ttlDays">How long</label>
        <select class="field__select" id="ttlDays" name="ttlDays">
          <option value="1"${ttl === "1" ? " selected" : ""}>1 day</option>
          <option value="7"${ttl === "7" ? " selected" : ""}>7 days</option>
          <option value="30"${ttl === "30" ? " selected" : ""}>30 days</option>
        </select>
      </div>
      <button class="btn" type="submit">Share</button>
      <p class="note">Your current network is allowed automatically</p>
    </form>
    ${shareBlock}
    ${advanced}`;

  return renderShell({
    title: "Admin · Group share",
    eyebrow: "Operator",
    headline: `Share a URL <em>private</em>.`,
    subhead: `Who. Where. How long.`,
    body: "Share mints the private host and opens the device sheet. Invite list and network still decide who gets in.",
    promises: [
      "Three asks on the first screen — not group ids or CIDRs.",
      "navigator.share is AirDrop on iOS — not a bypass.",
      "Advanced stays collapsed for revoke and wider networks.",
    ],
    meta: groupId,
    card: card(inner),
    scripts: shareJs(),
  });
}
