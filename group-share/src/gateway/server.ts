import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

import { handleGatewayRequest, type GatewayConfig, type GatewayRequest } from "./handler";

function collect(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function toGatewayRequest(req: IncomingMessage, body: string): GatewayRequest {
  const headers: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key] = value;
  }
  return {
    method: req.method ?? "GET",
    url: req.url ?? "/",
    headers,
    remoteAddress: req.socket.remoteAddress,
    body,
  };
}

function proxy(res: ServerResponse, target: { originUrl: string; path: string; method: string; headers: Record<string, string> }, body: string): void {
  const origin = new URL(target.originUrl);
  const transport = origin.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = transport(
    {
      protocol: origin.protocol,
      hostname: origin.hostname,
      port: origin.port,
      path: target.path,
      method: target.method,
      headers: { ...target.headers, host: origin.host },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("Origin unreachable.");
  });
  if (target.method !== "GET" && target.method !== "HEAD") upstream.write(body);
  upstream.end();
}

export function createGatewayServer(config: GatewayConfig) {
  return createServer(async (req, res) => {
    try {
      const body = await collect(req);
      const result = await handleGatewayRequest(toGatewayRequest(req, body), config);
      if (result.proxy) {
        proxy(res, result.proxy, body);
        return;
      }
      const headers = { ...result.headers };
      if (result.setCookie) headers["set-cookie"] = result.setCookie;
      res.writeHead(result.status, headers);
      res.end(result.body);
    } catch {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("Gateway error.");
    }
  });
}

export function listenGateway(config: GatewayConfig, port: number, host = "127.0.0.1") {
  const server = createGatewayServer(config);
  return new Promise<{ server: ReturnType<typeof createGatewayServer>; url: string }>((resolve) => {
    server.listen(port, host, () => resolve({ server, url: `http://${host}:${port}` }));
  });
}
