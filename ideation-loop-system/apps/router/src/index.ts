import { loadHqConfig, ProjectStore } from "@slack-agent-hq/protocol";
import { createRouterApp } from "./app.ts";
import { startHookServer } from "./http.ts";
import { slackGateway } from "./slack-gateway.ts";

export async function startRouter() {
  const config = loadHqConfig();
  const store = new ProjectStore();
  const app = createRouterApp(config, store);
  const port = Number(process.env.PORT || 3000);
  const slack = slackGateway(app.client);
  const http = startHookServer({
    port,
    config,
    store,
    slack,
  });
  await app.start();
  console.log(`@router listening (socket mode) and HTTP :${port}`);
  return { app, http, store };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startRouter().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
