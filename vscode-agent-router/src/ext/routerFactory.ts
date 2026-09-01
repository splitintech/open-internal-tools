import * as vscode from "vscode";
import { AgentRouter, createContext } from "../core/router";
import { JobStore, type Job } from "../core/jobs";
import {
  loadMergedCatalog,
  PeerRegistry,
  resolveCatalogPath,
} from "../core/registry";

const JOBS_STATE_KEY = "agentRouter.jobs";

export function readSettings(extensionPath: string) {
  const config = vscode.workspace.getConfiguration("agentRouter");
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const catalogPath = resolveCatalogPath(
    config.get<string>("catalogPath") || undefined,
    extensionPath,
  );
  const extensionIds = vscode.extensions.all.map((ext) => ext.id);
  return {
    folder,
    catalogPath,
    ctx: createContext({
      cwd: folder,
      extensionIds,
      settings: {
        timeoutMs: config.get("timeoutMs") ?? 120_000,
        slackTeamId: config.get("slackTeamId") || undefined,
        slackChannel: config.get("slackChannel") || undefined,
        slackBotToken: process.env.SLACK_BOT_TOKEN,
        cursorApiKey: process.env.CURSOR_API_KEY,
        codexCloudEnvId:
          config.get("codexCloudEnvId") || process.env.CODEX_CLOUD_ENV_ID,
        cursorCloudRepoUrl:
          config.get("cursorCloudRepoUrl") || process.env.CURSOR_CLOUD_REPO_URL,
        notifySlackOnJobComplete: config.get("notifySlackOnJobComplete") ?? false,
        pollIntervalMs: config.get("pollIntervalMs") ?? 15_000,
        hqUrl: config.get("hqUrl") || process.env.AGENT_ROUTER_HQ_URL,
        hqJobsSecret: process.env.AGENT_ROUTER_JOBS_SECRET,
        projectId: config.get("projectId") || process.env.AGENT_ROUTER_PROJECT_ID,
        promptsDir: config.get("promptsDir") || process.env.AGENT_ROUTER_PROMPTS_DIR,
      },
    }),
  };
}

export function makeRouter(
  context: vscode.ExtensionContext,
): AgentRouter {
  const { catalogPath, ctx } = readSettings(context.extensionPath);
  const persist = {
    load(): Job[] {
      return (context.globalState.get<Job[]>(JOBS_STATE_KEY) ?? []).filter(
        (job) => job && job.id,
      );
    },
    save(jobs: Job[]) {
      void context.globalState.update(JOBS_STATE_KEY, jobs);
    },
  };
  return new AgentRouter(
    new PeerRegistry(loadMergedCatalog(catalogPath)),
    ctx,
    new JobStore(persist),
  );
}

export function mcpEnv(context: vscode.ExtensionContext): NodeJS.ProcessEnv {
  const { catalogPath, ctx } = readSettings(context.extensionPath);
  return {
    ...process.env,
    AGENT_ROUTER_CWD: ctx.cwd,
    AGENT_ROUTER_TIMEOUT_MS: String(ctx.settings.timeoutMs),
    AGENT_ROUTER_CATALOG: catalogPath ?? "",
    SLACK_TEAM_ID: ctx.settings.slackTeamId ?? "",
    SLACK_CHANNEL: ctx.settings.slackChannel ?? "",
    CODEX_CLOUD_ENV_ID: ctx.settings.codexCloudEnvId ?? "",
    CURSOR_CLOUD_REPO_URL: ctx.settings.cursorCloudRepoUrl ?? "",
    AGENT_ROUTER_NOTIFY_SLACK: ctx.settings.notifySlackOnJobComplete ? "1" : "0",
    AGENT_ROUTER_HQ_URL: ctx.settings.hqUrl ?? "",
    AGENT_ROUTER_JOBS_SECRET: ctx.settings.hqJobsSecret ?? process.env.AGENT_ROUTER_JOBS_SECRET ?? "",
    AGENT_ROUTER_PROJECT_ID: ctx.settings.projectId ?? "",
    AGENT_ROUTER_PROMPTS_DIR: ctx.settings.promptsDir ?? "",
    AGENT_ROUTER_EXTENSION_IDS: ctx.extensionIds?.join(",") ?? "",
  };
}
