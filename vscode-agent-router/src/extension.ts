import * as vscode from "vscode";
import type { Job } from "./core/jobs";
import { upsertUserPeer } from "./core/registry";
import type { PeerManifest } from "./core/types";
import { SLACK_CLI_INSTALL_HINT } from "./transports/cli";
import { handoffClaude, handoffCodex, handoffCodexFile, handleRouterUri, probeCursorHandoff, handoffCursorPrompt } from "./ext/handoff";
import { JobsTreeProvider } from "./ext/jobsTree";
import { startMcpHost } from "./ext/mcpHost";
import { PeersTreeProvider, PeerItem } from "./ext/peersTree";
import { startJobPoller } from "./ext/poller";
import { makeRouter } from "./ext/routerFactory";
import type { AgentRouter } from "./core/router";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("Agent Router");
  let router = makeRouter(context);
  const getRouter = (): AgentRouter => router;

  const peersTree = new PeersTreeProvider(getRouter);
  const jobsTree = new JobsTreeProvider(getRouter);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  status.command = "agentRouter.probe";
  status.text = "Agent Router";
  status.show();

  const refreshStatus = async () => {
    const probes = await peersTree.reload();
    const ready = probes.filter((probe) => Object.values(probe.available).some(Boolean)).length;
    const last = router.jobs.list()[0];
    status.text = last
      ? `Agent Router: ${ready} peers · ${last.peer} ${last.status}`
      : `Agent Router: ${ready} peers ready`;
    jobsTree.refresh();
  };

  const rebuild = () => {
    router = makeRouter(context);
    void refreshStatus();
  };

  context.subscriptions.push(
    output,
    status,
    vscode.window.registerTreeDataProvider("agentRouter.peers", peersTree),
    vscode.window.registerTreeDataProvider("agentRouter.jobs", jobsTree),
    startMcpHost(context, output),
    startJobPoller(getRouter, jobsTree, output),
    vscode.window.registerUriHandler({
      handleUri: (uri) => handleRouterUri(uri),
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("agentRouter")) rebuild();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("agentRouter.listPeers", async () => {
      output.clear();
      output.appendLine(JSON.stringify(getRouter().list(), null, 2));
      output.show(true);
    }),
    vscode.commands.registerCommand("agentRouter.probe", async () => {
      const results = await getRouter().probeAll();
      output.clear();
      output.appendLine(JSON.stringify(results, null, 2));
      output.show(true);
      await refreshStatus();
    }),
    vscode.commands.registerCommand("agentRouter.refreshPeers", () => refreshStatus()),
    vscode.commands.registerCommand("agentRouter.showOutput", () => output.show(true)),
    vscode.commands.registerCommand("agentRouter.handoffClaude", (arg?: string | vscode.Uri) =>
      handoffClaude(typeof arg === "string" ? arg : undefined),
    ),
    vscode.commands.registerCommand("agentRouter.handoffCodex", (arg?: string | vscode.Uri) =>
      handoffCodex(typeof arg === "string" ? arg : undefined),
    ),
    vscode.commands.registerCommand("agentRouter.handoffCodexFile", (uri?: vscode.Uri) =>
      handoffCodexFile(uri),
    ),
    vscode.commands.registerCommand("agentRouter.handoffSlack", async () => {
      const editor = vscode.window.activeTextEditor;
      const text =
        editor?.document.getText(editor.selection)?.trim() ||
        (await vscode.window.showInputBox({ title: "Post to Slack", prompt: "Message text" }));
      if (!text) return;
      const channel =
        getRouter().ctx.settings.slackChannel ||
        (await vscode.window.showInputBox({ title: "Slack channel", prompt: "Channel ID (C…)" }));
      if (!channel) return;
      const result = await getRouter().route({
        peer: "slack",
        action: "launch",
        params: { channel, text },
      });
      output.appendLine(JSON.stringify(result, null, 2));
      if (!result.ok) {
        vscode.window.showErrorMessage(result.error || SLACK_CLI_INSTALL_HINT);
      } else {
        vscode.window.showInformationMessage("Posted to Slack.");
      }
    }),
    vscode.commands.registerCommand("agentRouter.slackAuth", async () => {
      const result = await getRouter().route({ peer: "slack", action: "inbox" });
      output.clear();
      output.appendLine(result.stdout || result.error || JSON.stringify(result, null, 2));
      output.show(true);
      if (!result.ok) {
        vscode.window.showErrorMessage(result.error || SLACK_CLI_INSTALL_HINT);
      }
    }),
    vscode.commands.registerCommand("agentRouter.slackPost", async () => {
      const channel =
        getRouter().ctx.settings.slackChannel ||
        (await vscode.window.showInputBox({ title: "Slack channel", prompt: "Channel ID (C…)" }));
      if (!channel) return;
      const text = await vscode.window.showInputBox({ title: "Post to Slack", prompt: "Message" });
      if (!text) return;
      const result = await getRouter().route({
        peer: "slack",
        action: "launch",
        params: { channel, text },
      });
      output.appendLine(JSON.stringify(result, null, 2));
      if (!result.ok) vscode.window.showErrorMessage(result.error || SLACK_CLI_INSTALL_HINT);
      else vscode.window.showInformationMessage("Posted to Slack.");
    }),
    vscode.commands.registerCommand("agentRouter.openJob", async (job?: Job) => {
      const target = job ?? getRouter().jobs.list()[0];
      if (!target?.url) {
        vscode.window.showInformationMessage("No job URL to open.");
        return;
      }
      await vscode.env.openExternal(vscode.Uri.parse(target.url));
    }),
    vscode.commands.registerCommand("agentRouter.showPeer", (item?: PeerItem) => {
      if (!item) return;
      output.clear();
      output.appendLine(JSON.stringify(item.probe, null, 2));
      output.show(true);
    }),
    vscode.commands.registerCommand("agentRouter.addPeer", async () => {
      const id = await vscode.window.showInputBox({
        title: "Add peer",
        prompt: "Peer id (e.g. docker)",
        validateInput: (value) => (/^[a-z][a-z0-9-]*$/.test(value) ? undefined : "lowercase id"),
      });
      if (!id) return;
      const bin = await vscode.window.showInputBox({
        title: "CLI binary",
        prompt: "Binary name on PATH",
        value: id,
      });
      if (!bin) return;
      const allowRaw = await vscode.window.showInputBox({
        title: "Allowlisted subcommands",
        prompt: "Comma-separated, e.g. ps,compose",
        value: "ps",
      });
      const peer: PeerManifest = {
        id,
        title: id,
        kind: "platform",
        runtimes: ["local"],
        capabilities: ["api"],
        transports: {
          cli: {
            bin,
            allow: (allowRaw || "ps")
              .split(",")
              .map((token) => token.trim())
              .filter(Boolean),
          },
        },
      };
      const path = upsertUserPeer(peer);
      rebuild();
      vscode.window.showInformationMessage(`Wrote peer "${id}" to ${path}`);
    }),
    vscode.commands.registerCommand("agentRouter.handoffCursor", async () => {
      const cmd = await probeCursorHandoff();
      if (!cmd) {
        vscode.window.showInformationMessage(
          "You are already the agent in this window. No Composer injection command on this build.",
        );
        return;
      }
      const prompt = await vscode.window.showInputBox({
        title: "Cursor handoff",
        prompt: `Will run ${cmd} (does not auto-submit unless the command does).`,
      });
      if (!prompt) return;
      await handoffCursorPrompt(prompt);
    }),
  );

  void refreshStatus();
  output.appendLine("Agent Router activated.");
}

export function deactivate(): void {}
