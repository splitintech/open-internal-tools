import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  PaymentEngine,
  PostgresStore,
  createPaymentHandler,
  type Authenticate,
  type EngineOptions,
} from "@splitin/jpmc-zelle-quick-pay/server";
import { createSyntheticFixture } from "@splitin/jpmc-zelle-quick-pay/testing";

const synthetic = process.env.SYNTHETIC_DEMO === "1";
if (synthetic && process.env.NODE_ENV === "production")
  throw new Error("Synthetic mode cannot run in production");
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const fixture = synthetic
  ? createSyntheticFixture(
      pool ? new PostgresStore(pool, "synthetic") : undefined,
    )
  : null;
let engine: PaymentEngine;
let authenticate: Authenticate;
if (fixture) {
  engine = fixture.engine;
  authenticate = async (request) => {
    if (request.headers.get("x-demo-token") !== "synthetic-ui")
      throw new Error("demo authentication required");
    return fixture.actor;
  };
} else {
  if (!pool || !process.env.ZELLE_ADAPTER_MODULE)
    throw new Error(
      "DATABASE_URL and ZELLE_ADAPTER_MODULE are required. No default live bank adapter is available.",
    );
  const adapter = await import(
    pathToFileURL(process.env.ZELLE_ADAPTER_MODULE).href
  );
  const dependencies = (await adapter.createDependencies()) as Omit<
    EngineOptions,
    "store"
  > & { authenticate: Authenticate };
  engine = new PaymentEngine({
    ...dependencies,
    store: new PostgresStore(pool, process.env.ZELLE_NAMESPACE ?? "splitin"),
  });
  authenticate = dependencies.authenticate;
}
const handler = createPaymentHandler(engine, authenticate);
const server = createServer(async (req, res) => {
  try {
    const buffers: Buffer[] = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 65536) {
        res.writeHead(413);
        res.end();
        return;
      }
      buffers.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(buffers);
    const url = "http://localhost" + req.url;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers))
      if (v) headers.set(k, Array.isArray(v) ? v.join(",") : v);
    if (
      fixture &&
      req.method === "POST" &&
      new URL(url).pathname === "/synthetic/confirm"
    ) {
      if (headers.get("x-demo-token") !== "synthetic-ui") {
        res.writeHead(401);
        res.end();
        return;
      }
      const { sessionId } = JSON.parse(raw.toString());
      const session = await engine.get(fixture.actor, sessionId);
      await fixture.ingest(fixture.receipt(session));
      await engine.tick();
      res.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(await engine.get(fixture.actor, sessionId)));
      return;
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      ...(req.method !== "GET" && req.method !== "HEAD" ? { body: raw } : {}),
    });
    const response = await handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "reference_service_error" } }));
  }
});
let draining = false;
const timer = setInterval(async () => {
  if (draining) return;
  draining = true;
  try {
    await engine.tick();
  } catch {
    console.error("zelle_outbox_delivery_failed");
  } finally {
    draining = false;
  }
}, 5000);
const port = Number(process.env.PORT ?? 4319);
server.listen(
  port,
  synthetic ? "127.0.0.1" : (process.env.HOST ?? "127.0.0.1"),
  () =>
    console.log(
      synthetic
        ? `SYNTHETIC ONLY service http://127.0.0.1:${port}`
        : `Zelle private service listening on ${port}`,
    ),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => {
      void pool?.end();
    });
  });
