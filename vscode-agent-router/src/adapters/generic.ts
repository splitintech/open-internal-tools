import type {
  AdapterContext,
  PeerAdapter,
  PeerManifest,
  RouteRequest,
  RouteResult,
} from "../core/types";
import { assertAllowedSubcommand, runCli, which } from "../transports/cli";
import { callHttpApi } from "../transports/http";
import { probePeer } from "../core/probe";

export function createGenericAdapter(peer: PeerManifest): PeerAdapter {
  return {
    id: peer.id,
    async route(req, ctx) {
      const transport =
        req.transport ??
        (peer.transports.mcp ? "mcp" : peer.transports.cli ? "cli" : "api");

      if (transport === "mcp") {
        return {
          ok: false,
          peer: peer.id,
          action: req.action,
          runtime: req.runtime ?? "local",
          transport: "mcp",
          error: `MCP for "${peer.id}" is already on the Cursor agent. Call that server's tools directly, or use transport=cli/api through Agent Router.`,
        };
      }

      if (transport === "cli") {
        return routeCli(peer, req, ctx);
      }
      return routeApi(peer, req, ctx);
    },
    probe: (ctx) => probePeer(peer, ctx),
  };
}

async function routeCli(
  peer: PeerManifest,
  req: RouteRequest,
  ctx: AdapterContext,
): Promise<RouteResult> {
  const cli = peer.transports.cli;
  if (!cli) {
    return fail(peer, req, "cli", "No CLI transport on this peer");
  }
  const binPath = (await which(cli.bin)) ?? cli.bin;
  const argv = Array.isArray(req.params?.argv)
    ? (req.params.argv as string[])
    : inferArgv(peer, req);
  if (!argv.length) {
    return fail(
      peer,
      req,
      "cli",
      `Pass params.argv for ${peer.id} (allowlisted: ${cli.allow.join(", ")})`,
    );
  }
  try {
    assertAllowedSubcommand(argv, cli.allow);
  } catch (err) {
    return fail(peer, req, "cli", (err as Error).message);
  }

  const ran = await runCli(binPath, argv, {
    cwd: ctx.cwd,
    env: ctx.env,
    timeoutMs: ctx.settings.timeoutMs,
  });
  return {
    ok: ran.code === 0 && !ran.timedOut,
    peer: peer.id,
    action: req.action,
    runtime: req.runtime ?? "local",
    transport: "cli",
    stdout: ran.stdout,
    stderr: ran.stderr,
    error: ran.timedOut ? "timed out" : ran.code === 0 ? undefined : ran.stderr || `exit ${ran.code}`,
  };
}

async function routeApi(
  peer: PeerManifest,
  req: RouteRequest,
  ctx: AdapterContext,
): Promise<RouteResult> {
  const api = peer.transports.api;
  if (!api) {
    return fail(peer, req, "api", "No API transport on this peer");
  }
  const path = String(req.params?.path ?? req.params?.method ?? "");
  const method = String(req.params?.httpMethod ?? (req.params?.body ? "POST" : "GET"));
  if (!path && !req.params?.body) {
    return fail(
      peer,
      req,
      "api",
      `Pass params.path (and optional params.body / params.httpMethod) for ${peer.id} API`,
    );
  }
  const res = await callHttpApi(
    peer.id === "ideation-hq"
      ? {
          ...api,
          baseUrl: ctx.settings.hqUrl || ctx.env.AGENT_ROUTER_HQ_URL || api.baseUrl,
        }
      : api,
    {
      method,
      path,
      body: req.params?.body,
      timeoutMs: ctx.settings.timeoutMs,
    },
    ctx.env,
  );
  return {
    ok: res.ok,
    peer: peer.id,
    action: req.action,
    runtime: req.runtime ?? "cloud",
    transport: "api",
    data: res.data,
    error: res.ok ? undefined : res.text,
  };
}

function inferArgv(peer: PeerManifest, req: RouteRequest): string[] {
  if (req.prompt && peer.id === "github") return ["issue", "list", "--limit", "10"];
  if (req.prompt && peer.transports.cli?.allow.includes("status")) return ["status"];
  return [];
}

function fail(
  peer: PeerManifest,
  req: RouteRequest,
  transport: "cli" | "api" | "mcp",
  error: string,
): RouteResult {
  return {
    ok: false,
    peer: peer.id,
    action: req.action,
    runtime: req.runtime ?? "local",
    transport,
    error,
  };
}
