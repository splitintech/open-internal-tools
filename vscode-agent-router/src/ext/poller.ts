import * as vscode from "vscode";
import { isTerminalStatus } from "../core/jobs";
import { pollJob } from "../core/poll";
import type { AgentRouter } from "../core/router";
import type { JobsTreeProvider } from "./jobsTree";

export function startJobPoller(
  getRouter: () => AgentRouter,
  jobsTree: JobsTreeProvider,
  output: vscode.OutputChannel,
): vscode.Disposable {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const router = getRouter();
      const interval = router.ctx.settings.pollIntervalMs ?? 15_000;
      void interval;
      for (const job of router.jobs.list()) {
        if (isTerminalStatus(job.status)) continue;
        const next = await pollJob(job, router.ctx);
        const changed = next.status !== job.status;
        router.jobs.upsert(next);
        if (changed && isTerminalStatus(next.status) && router.ctx.settings.notifySlackOnJobComplete) {
          const channel = router.ctx.settings.slackChannel;
          if (channel) {
            const posted = await router.route({
              peer: "slack",
              action: "launch",
              params: {
                channel,
                text: `Agent Router job ${next.id} (${next.peer}) ${next.status}${next.url ? ` ${next.url}` : ""}`,
              },
            });
            output.appendLine(
              posted.ok
                ? `Slack notified for ${next.id}`
                : `Slack notify failed: ${posted.error}`,
            );
          }
        }
      }
      jobsTree.refresh();
    } catch (err) {
      output.appendLine(`Job poller error: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => void tick(), getRouter().ctx.settings.pollIntervalMs ?? 15_000);
  return new vscode.Disposable(() => clearInterval(handle));
}
