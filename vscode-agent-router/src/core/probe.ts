import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AdapterContext, PeerManifest, ProbeResult } from "./types";
import { resolveSlackCli, runCli, which } from "../transports/cli";

interface CursorMcpFile {
  mcpServers?: Record<string, { command?: string; url?: string }>;
}

function readMcpConfig(): CursorMcpFile {
  const paths = [
    join(process.cwd(), ".cursor", "mcp.json"),
    join(homedir(), ".cursor", "mcp.json"),
  ];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as CursorMcpFile;
    } catch {
      continue;
    }
  }
  return {};
}

export async function probePeer(
  peer: PeerManifest,
  ctx: AdapterContext,
): Promise<ProbeResult> {
  const detail: Record<string, string> = {};
  const available: ProbeResult["available"] = {};

  if (peer.transports.cli) {
    if (peer.transports.cli.resolve === "slack-cli") {
      const slack = await resolveSlackCli();
      available.cli = Boolean(slack);
      detail.cli = slack ?? "Slack CLI not found (~/.slack/bin/slack)";
    } else {
      const bin = await which(peer.transports.cli.bin);
      available.cli = Boolean(bin);
      detail.cli = bin ?? `${peer.transports.cli.bin} not on PATH`;
    }
  }

  if (peer.transports.api) {
    const envName = peer.transports.api.authEnv;
    const present = Boolean(ctx.env[envName] || ctx.settings.slackBotToken && envName === "SLACK_BOT_TOKEN" || ctx.settings.cursorApiKey && envName === "CURSOR_API_KEY");
    available.api = present;
    detail.api = present ? `${envName} set` : `${envName} missing`;
  }

  if (peer.transports.mcp) {
    const config = readMcpConfig();
    const name = peer.transports.mcp.configName;
    const found = Boolean(config.mcpServers?.[name]);
    available.mcp = found;
    detail.mcp = found
      ? `MCP server "${name}" in mcp.json`
      : `MCP server "${name}" not in .cursor/mcp.json`;
  }

  if (peer.ide?.extensionId) {
    const installed = ctx.extensionIds
      ? ctx.extensionIds.includes(peer.ide.extensionId)
      : undefined;
    available.ide = installed ?? true;
    detail.ide =
      installed === false
        ? `${peer.ide.extensionId} not installed`
        : peer.ide.extensionId;
  }

  if (peer.id === "claude" && available.cli) {
    try {
      const version = await runCli("claude", ["--version"], { timeoutMs: 8_000 });
      detail.claudeVersion = version.stdout || version.stderr;
    } catch {
      /* ignore */
    }
  }

  return {
    id: peer.id,
    title: peer.title,
    kind: peer.kind,
    available,
    detail,
  };
}
