#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentRouter, createContext } from "../core/router";
import { PeerRegistry, loadMergedCatalog } from "../core/registry";
import { createMcpServer } from "./createServer";

const router = new AgentRouter(
  new PeerRegistry(loadMergedCatalog(process.env.AGENT_ROUTER_CATALOG)),
  createContext({
    cwd: process.env.AGENT_ROUTER_CWD || process.cwd(),
    settings: {
      timeoutMs: Number(process.env.AGENT_ROUTER_TIMEOUT_MS ?? 120_000),
      cursorApiKey: process.env.CURSOR_API_KEY,
      slackTeamId: process.env.SLACK_TEAM_ID,
      slackChannel: process.env.SLACK_CHANNEL,
      slackBotToken: process.env.SLACK_BOT_TOKEN,
      codexCloudEnvId: process.env.CODEX_CLOUD_ENV_ID,
      cursorCloudRepoUrl: process.env.CURSOR_CLOUD_REPO_URL,
      notifySlackOnJobComplete: process.env.AGENT_ROUTER_NOTIFY_SLACK === "1",
    },
  }),
);

const server = createMcpServer(router);
const transport = new StdioServerTransport();
void server.connect(transport);
