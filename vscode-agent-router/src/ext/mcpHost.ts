import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import * as vscode from "vscode";
import { mcpEnv } from "./routerFactory";

interface CursorMcp {
  registerServer?(config: {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
  }): vscode.Disposable;
}

function cursorMcp(): CursorMcp | undefined {
  const cursor = (vscode as unknown as { cursor?: { mcp?: CursorMcp } }).cursor;
  return cursor?.mcp;
}

export function startMcpHost(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
): vscode.Disposable {
  const mcpJs = join(context.extensionPath, "dist", "mcp.js");
  const env = mcpEnv(context);
  const api = cursorMcp();

  if (typeof api?.registerServer === "function") {
    try {
      const disposable = api.registerServer({
        name: "agent-router",
        command: process.execPath,
        args: [mcpJs],
        env,
      });
      output.appendLine("Registered agent-router MCP via vscode.cursor.mcp.registerServer");
      return disposable;
    } catch (err) {
      output.appendLine(`cursor.mcp.registerServer failed, spawning stdio: ${(err as Error).message}`);
    }
  }

  const child: ChildProcess = spawn(process.execPath, [mcpJs], {
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? context.extensionPath,
    env,
    stdio: "pipe",
  });
  child.stderr?.on("data", (chunk) => output.append(String(chunk)));
  child.on("exit", (code) => {
    output.appendLine(`agent-router MCP child exited ${code}`);
  });
  output.appendLine(`Spawned agent-router MCP: ${mcpJs}`);
  return new vscode.Disposable(() => {
    child.kill();
  });
}
