import * as vscode from "vscode";
import type { Job } from "../core/jobs";
import type { AgentRouter } from "../core/router";

export class JobItem extends vscode.TreeItem {
  constructor(public readonly job: Job) {
    super(`${job.peer} ${job.status}`, vscode.TreeItemCollapsibleState.None);
    this.id = job.id;
    this.description = age(job.createdAt);
    this.tooltip = job.error || job.url || job.prompt || job.id;
    this.iconPath = new vscode.ThemeIcon(iconFor(job.status));
    this.contextValue = "agentRouterJob";
    if (job.url) {
      this.command = {
        command: "agentRouter.openJob",
        title: "Open job",
        arguments: [job],
      };
    }
  }
}

export class JobsTreeProvider implements vscode.TreeDataProvider<JobItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private getRouter: () => AgentRouter) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: JobItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<JobItem[]> {
    return this.getRouter().jobs.list().map((job) => new JobItem(job));
  }
}

function iconFor(status: Job["status"]): string {
  if (status === "succeeded") return "pass";
  if (status === "failed") return "error";
  if (status === "queued") return "clock";
  return "sync~spin";
}

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.round(ms / 60_000));
  if (mins < 1) return "just now";
  if (mins === 1) return "1m ago";
  return `${mins}m ago`;
}
