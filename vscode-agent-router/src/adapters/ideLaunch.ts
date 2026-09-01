import { encodeClaudeHandoffUri, encodeRouterLaunchUri } from "../core/launchUri";
import { openExternalUri } from "../core/openUri";
import type { RouteRequest, RouteResult } from "../core/types";

export const IDE_ONLY_ERROR =
  "Open the extension; do not use claude -p / codex exec. Use route peer=<claude|codex|chatgpt> runtime=ide.";

const EXTENSION: Record<string, string> = {
  claude: "anthropic.claude-code",
  codex: "openai.chatgpt",
  chatgpt: "openai.chatgpt",
};

export function wrapIde(
  peer: string,
  req: RouteRequest,
  extra: Partial<RouteResult>,
): RouteResult {
  return {
    ok: extra.ok ?? !extra.error,
    peer,
    action: req.action,
    runtime: extra.runtime ?? req.runtime ?? "ide",
    transport: extra.transport ?? "cli",
    ...extra,
  };
}

export function refuseVendorCli(peer: string, req: RouteRequest): RouteResult {
  return wrapIde(peer, req, {
    ok: false,
    runtime: req.runtime ?? "local",
    error: IDE_ONLY_ERROR,
  });
}

export async function launchIdePeer(
  peer: string,
  req: RouteRequest,
  prompt: string,
): Promise<RouteResult> {
  if (!prompt.trim()) {
    return wrapIde(peer, req, { ok: false, error: "prompt is required for IDE launch" });
  }
  const url = encodeRouterLaunchUri(peer, prompt);
  await openExternalUri(url);
  const note =
    peer === "claude"
      ? "Opens Claude Code with a prefilled prompt. It does not auto-submit."
      : peer === "cursor"
        ? "Opens Composer in this window if a handoff command exists; otherwise you are already the agent."
        : "Adds the prompt to the Codex / ChatGPT thread (openai.chatgpt).";
  return wrapIde(peer, req, {
    ok: true,
    runtime: "ide",
    url,
    data: {
      note,
      extensionId: EXTENSION[peer],
      innerUri: peer === "claude" ? encodeClaudeHandoffUri(prompt) : undefined,
      commands:
        peer === "codex" || peer === "chatgpt"
          ? ["chatgpt.addToThread", "chatgpt.addFileToThread"]
          : undefined,
    },
  });
}
