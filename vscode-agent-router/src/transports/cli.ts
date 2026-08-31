import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SLACK_CLI_FINGERPRINT = "d41d8cd98f00b204e9800998ecf8427e";

export const SLACK_CLI_INSTALL_HINT = [
  "Slack CLI not found at ~/.slack/bin/slack.",
  "Install with:",
  "  curl -fsSL https://downloads.slack-edge.com/slack-cli/install.sh | bash",
  "Then reload the window. Do not use a random `slack` binary on PATH unless `slack _fingerprint` returns d41d8cd98f00b204e9800998ecf8427e.",
].join("\n");

export interface RunCliOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
}

export interface RunCliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function slackCliInstallPath(): string {
  if (process.platform === "win32") {
    const primary = join(
      homedir(),
      "AppData",
      "Local",
      "slack-cli",
      "bin",
      "slack.exe",
    );
    const fallback = join(homedir(), ".slack-cli", "bin", "slack.exe");
    return existsSync(primary) ? primary : fallback;
  }
  return join(homedir(), ".slack", "bin", "slack");
}

export async function runCli(
  bin: string,
  args: string[],
  options: RunCliOptions = {},
): Promise<RunCliResult> {
  const timeoutMs = options.timeoutMs ?? 120_000;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), timedOut });
    });
  });
}

export async function which(bin: string): Promise<string | null> {
  try {
    const result = await runCli(
      process.platform === "win32" ? "where" : "command",
      process.platform === "win32" ? [bin] : ["-v", bin],
      { timeoutMs: 5_000 },
    );
    if (result.code === 0 && result.stdout) {
      return result.stdout.split("\n")[0]?.trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function resolveSlackCli(): Promise<string | null> {
  const installPath = slackCliInstallPath();
  if (existsSync(installPath)) return installPath;

  const fromPath = await which("slack");
  if (!fromPath) return null;

  try {
    const fingerprint = await runCli(fromPath, ["_fingerprint"], {
      timeoutMs: 5_000,
    });
    if (fingerprint.stdout.includes(SLACK_CLI_FINGERPRINT)) return fromPath;
  } catch {
    return null;
  }
  return null;
}

export function assertAllowedSubcommand(
  argv: string[],
  allow: string[],
): string {
  const head = argv[0];
  if (!head) {
    throw new Error("CLI call needs at least one argument");
  }
  const allowed = allow.some(
    (token) => head === token || head.startsWith(token),
  );
  if (!allowed) {
    throw new Error(
      `CLI argument "${head}" is not allowlisted. Allowed: ${allow.join(", ")}`,
    );
  }
  return head;
}

export function buildSlackApiArgs(
  method: string,
  fields: Record<string, string>,
  teamId?: string,
): string[] {
  const args = ["api", method];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === "") continue;
    args.push(`${key}=${value}`);
  }
  if (teamId) args.push("--team", teamId);
  return args;
}
