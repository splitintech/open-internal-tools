import { adapterFor, createGenericAdapter } from "../adapters/index";
import { IDE_ONLY_ERROR } from "../adapters/ideLaunch";
import { extractJobRef, JobStore } from "./jobs";
import { postHqJob } from "./hqJobs";
import { probePeer } from "./probe";
import { composeRoutePrompt, resolvePromptsDir } from "./prompts";
import { PeerRegistry } from "./registry";
import type {
  Action,
  AdapterContext,
  ProbeResult,
  RouteRequest,
  RouteResult,
  RouterSettings,
  Runtime,
} from "./types";

const ACTIONS: Action[] = ["consult", "launch", "handoff", "api", "inbox"];

export const DEFAULT_SETTINGS: RouterSettings = {
  timeoutMs: 120_000,
};

export function createContext(
  overrides: Partial<AdapterContext> = {},
): AdapterContext {
  return {
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? process.env,
    settings: { ...DEFAULT_SETTINGS, ...overrides.settings },
  };
}

export class AgentRouter {
  constructor(
    readonly registry: PeerRegistry,
    readonly ctx: AdapterContext = createContext(),
    readonly jobs: JobStore = new JobStore(),
  ) {}

  list() {
    return this.registry.list().map((peer) => ({
      id: peer.id,
      title: peer.title,
      kind: peer.kind,
      runtimes: peer.runtimes,
      capabilities: peer.capabilities,
      transports: Object.keys(peer.transports),
    }));
  }

  async probeAll(): Promise<ProbeResult[]> {
    const results: ProbeResult[] = [];
    for (const peer of this.registry.list()) {
      results.push(await probePeer(peer, this.ctx));
    }
    return results;
  }

  async route(req: RouteRequest): Promise<RouteResult> {
    if (!ACTIONS.includes(req.action)) {
      return {
        ok: false,
        peer: req.peer,
        action: req.action,
        runtime: req.runtime ?? "local",
        transport: req.transport ?? "cli",
        error: `Unknown action "${req.action}"`,
      };
    }

    const peer = this.registry.get(req.peer);
    if (!peer.capabilities.includes(req.action) && req.action !== "api") {
      return {
        ok: false,
        peer: peer.id,
        action: req.action,
        runtime: req.runtime ?? "local",
        transport: req.transport ?? "cli",
        error: `"${peer.id}" does not advertise ${req.action}. Capabilities: ${peer.capabilities.join(", ")}`,
      };
    }

    if (req.runtime && !peer.runtimes.includes(req.runtime)) {
      return {
        ok: false,
        peer: peer.id,
        action: req.action,
        runtime: req.runtime,
        transport: req.transport ?? "cli",
        error: `"${peer.id}" has no ${req.runtime} runtime. Runtimes: ${peer.runtimes.join(", ")}`,
      };
    }

    if (req.transport) {
      this.registry.pickTransport(peer, req.transport);
    }

    const adapter = adapterFor(this.registry, peer.id);
    const promptsDir = resolvePromptsDir(this.ctx.cwd, this.ctx.settings.promptsDir);
    let prompt = req.prompt;
    try {
      const composed = composeRoutePrompt(req, promptsDir);
      if (composed) prompt = composed;
    } catch (err) {
      if (req.params?.promptId) {
        return {
          ok: false,
          peer: peer.id,
          action: req.action,
          runtime: req.runtime ?? "ide",
          transport: req.transport ?? "cli",
          error: (err as Error).message,
        };
      }
    }
    const result = await adapter.route({ ...req, prompt }, this.ctx);

    if (req.action === "launch") {
      const extracted = extractJobRef(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
      const job = this.jobs.recordLaunch({
        peer: peer.id,
        runtime: result.runtime,
        prompt,
        remoteId: result.jobId || extracted.jobId,
        url: result.url || extracted.url,
        stdout: result.stdout,
        error: result.error,
        ok: result.ok,
      });
      result.jobId = job.id;
      if (!result.url && job.url) result.url = job.url;
      const projectId =
        typeof req.params?.project_id === "string"
          ? req.params.project_id
          : this.ctx.settings.projectId;
      void postHqJob(this.ctx, job, projectId);
    }

    return result;
  }

  async callCli(peerId: string, argv: string[], runtime: Runtime = "local"): Promise<RouteResult> {
    if (peerId === "claude" || peerId === "codex" || peerId === "chatgpt") {
      return {
        ok: false,
        peer: peerId,
        action: "api",
        runtime,
        transport: "cli",
        error: IDE_ONLY_ERROR,
      };
    }
    const peer = this.registry.get(peerId);
    return createGenericAdapter(peer).route(
      { peer: peerId, action: "api", runtime, transport: "cli", params: { argv } },
      this.ctx,
    );
  }

  async callApi(
    peerId: string,
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<RouteResult> {
    return this.route({
      peer: peerId,
      action: "api",
      transport: "api",
      params: { path, ...params },
    });
  }
}
