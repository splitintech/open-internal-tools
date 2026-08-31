import * as vscode from "vscode";
import type { AgentRouter } from "../core/router";
import type { ProbeResult } from "../core/types";

export class PeerItem extends vscode.TreeItem {
  constructor(public readonly probe: ProbeResult) {
    super(probe.title, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = probe.id;
    this.description = probe.kind;
    const ready = Object.values(probe.available).filter(Boolean).length;
    this.iconPath = new vscode.ThemeIcon(
      ready > 0 ? "circle-filled" : "circle-outline",
    );
    this.tooltip = JSON.stringify(probe.detail, null, 2);
    this.contextValue = "agentRouterPeer";
    this.command = {
      command: "agentRouter.showPeer",
      title: "Show peer",
      arguments: [this],
    };
  }
}

class TransportItem extends vscode.TreeItem {
  constructor(label: string, ok: boolean | undefined, detail: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = ok ? "ready" : "missing";
    this.iconPath = new vscode.ThemeIcon(ok ? "check" : "circle-slash");
    this.tooltip = detail;
  }
}

export class PeersTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private probes: ProbeResult[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private getRouter: () => AgentRouter) {}

  refresh(): void {
    void this.reload();
  }

  async reload(): Promise<ProbeResult[]> {
    this.probes = await this.getRouter().probeAll();
    this.emitter.fire();
    return this.probes;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (!element) {
      return this.probes.map((probe) => new PeerItem(probe));
    }
    if (element instanceof PeerItem) {
      const { available, detail } = element.probe;
      return ["mcp", "cli", "api", "ide"].map(
        (key) =>
          new TransportItem(
            key,
            available[key as keyof typeof available],
            detail[key] ?? "",
          ),
      );
    }
    return [];
  }
}
