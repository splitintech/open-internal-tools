export function encodeClaudeHandoffUri(prompt: string): string {
  return `vscode://anthropic.claude-code/open?prompt=${encodeURIComponent(prompt)}`;
}

export const ROUTER_URI_AUTHORITY = "splitin.agent-router";

export function encodeRouterLaunchUri(peer: string, prompt: string): string {
  const clipped =
    prompt.length > 7000 ? `${prompt.slice(0, 7000)}\n\n…truncated for the vscode:// URI.` : prompt;
  const query = new URLSearchParams({ peer, prompt: clipped });
  return `vscode://${ROUTER_URI_AUTHORITY}/launch?${query.toString()}`;
}

export function parseRouterLaunchQuery(query: string): { peer: string; prompt: string } | null {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  const peer = (params.get("peer") ?? "").trim().toLowerCase();
  const prompt = params.get("prompt") ?? "";
  if (!peer) return null;
  return { peer, prompt };
}

export function parseRouterLaunchUri(uri: string): { peer: string; prompt: string } | null {
  try {
    const parsed = new URL(uri);
    const host = parsed.host || parsed.hostname;
    if (host !== ROUTER_URI_AUTHORITY && parsed.pathname.indexOf(ROUTER_URI_AUTHORITY) < 0) {
      if (!uri.includes(ROUTER_URI_AUTHORITY)) return null;
    }
    return parseRouterLaunchQuery(parsed.search);
  } catch {
    const q = uri.split("?")[1];
    return q ? parseRouterLaunchQuery(q) : null;
  }
}
