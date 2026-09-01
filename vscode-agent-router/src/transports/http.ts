import type { ApiTransport } from "../core/types";

export interface HttpCall {
  method?: string;
  path?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

function authHeader(transport: ApiTransport, env: NodeJS.ProcessEnv): Record<string, string> {
  const token = env[transport.authEnv];
  if (!token) return {};

  if (transport.authEnv === "CURSOR_API_KEY") {
    const basic = Buffer.from(`${token}:`).toString("base64");
    return { Authorization: `Basic ${basic}` };
  }
  if (transport.authEnv === "STRIPE_API_KEY") {
    const basic = Buffer.from(`${token}:`).toString("base64");
    return { Authorization: `Basic ${basic}` };
  }
  if (transport.authEnv === "ANTHROPIC_API_KEY") {
    return {
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
    };
  }
  if (transport.authEnv === "AGENT_ROUTER_JOBS_SECRET") {
    return { "x-agent-router-secret": token };
  }
  return { Authorization: `Bearer ${token}` };
}

export async function callHttpApi(
  transport: ApiTransport,
  call: HttpCall,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const path = call.path ?? "";
  const url = path.startsWith("http")
    ? path
    : `${transport.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : path ? `/${path}` : ""}`;

  const method = (call.method ?? (call.body ? "POST" : "GET")).toUpperCase();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...authHeader(transport, env),
    ...call.headers,
  };
  if (call.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), call.timeoutMs ?? 60_000);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: call.body === undefined ? undefined : JSON.stringify(call.body),
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { ok: res.ok, status: res.status, data, text };
  } finally {
    clearTimeout(timer);
  }
}
