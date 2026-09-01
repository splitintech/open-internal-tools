import { spawn } from "node:child_process";

export function shouldOpenExternalUri(): boolean {
  return process.env.AGENT_ROUTER_DRY_RUN !== "1" && process.env.VITEST !== "true";
}

/** Open a vscode:// / cursor:// URI from the MCP child (no executeCommand there). */
export async function openExternalUri(uri: string): Promise<void> {
  if (!shouldOpenExternalUri()) return;
  const platform = process.platform;
  if (platform === "darwin") {
    await spawnDetached("open", [uri]);
    return;
  }
  if (platform === "win32") {
    await spawnDetached("cmd", ["/c", "start", "", uri]);
    return;
  }
  await spawnDetached("xdg-open", [uri]);
}

function spawnDetached(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", reject);
    child.unref();
    resolve();
  });
}
