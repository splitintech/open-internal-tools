import { loadDotEnv } from "./load-env.ts";

loadDotEnv();

type Starter = () => Promise<unknown>;

async function maybe(label: string, tokenEnv: string, start: Starter) {
  if (!process.env[tokenEnv]) {
    console.log(`skip ${label} (set ${tokenEnv} to run this bot)`);
    return;
  }
  await start();
}

async function main() {
  const { startRouter } = await import("../apps/router/src/index.ts");
  const { startTriage } = await import("../apps/triage/src/index.ts");
  const { startCi } = await import("../apps/ci/src/index.ts");
  const { startInbox } = await import("../apps/inbox/src/index.ts");
  const { startWatchdog } = await import("../apps/watchdog/src/index.ts");

  if (!process.env.SLACK_BOT_TOKEN) {
    throw new Error("SLACK_BOT_TOKEN is required for @router. Copy env.example to .env");
  }
  await startRouter();
  await maybe("triage", "TRIAGE_SLACK_BOT_TOKEN", startTriage);
  await maybe("ci", "CI_SLACK_BOT_TOKEN", startCi);
  await maybe("inbox", "INBOX_SLACK_BOT_TOKEN", startInbox);
  await maybe("watchdog", "WATCHDOG_SLACK_BOT_TOKEN", startWatchdog);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
