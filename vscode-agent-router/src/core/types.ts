export const TRANSPORT_PREFERENCE = ["mcp", "cli", "api"] as const;

export type TransportKind = (typeof TRANSPORT_PREFERENCE)[number];
export type Runtime = "local" | "cloud" | "ide";
export type PeerKind = "agent" | "comms" | "platform";
export type Action = "consult" | "launch" | "handoff" | "api" | "inbox";

export interface CliTransport {
  bin: string;
  allow: string[];
  resolve?: "slack-cli" | "path";
}

export interface ApiTransport {
  baseUrl: string;
  authEnv: string;
  cloudCreatePath?: string;
}

export interface McpTransport {
  configName: string;
}

export interface IdeBridge {
  extensionId: string;
  handoffUri?: string;
  commands?: string[];
}

export interface PeerManifest {
  id: string;
  title: string;
  kind: PeerKind;
  runtimes: Runtime[];
  capabilities: Action[];
  transports: {
    mcp?: McpTransport;
    cli?: CliTransport;
    api?: ApiTransport;
  };
  ide?: IdeBridge;
  cloud?: {
    envIdSetting?: string;
  };
}

export interface Catalog {
  version: number;
  transportPreference: TransportKind[];
  peers: PeerManifest[];
}

export interface RouteRequest {
  peer: string;
  action: Action;
  runtime?: Runtime;
  transport?: TransportKind;
  prompt?: string;
  params?: Record<string, unknown>;
}

export interface RouteResult {
  ok: boolean;
  peer: string;
  action: Action;
  runtime: Runtime;
  transport: TransportKind;
  jobId?: string;
  url?: string;
  stdout?: string;
  stderr?: string;
  data?: unknown;
  error?: string;
}

export interface ProbeResult {
  id: string;
  title: string;
  kind: PeerKind;
  available: Partial<Record<TransportKind | "ide", boolean>>;
  detail: Record<string, string>;
}

export interface AdapterContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  settings: RouterSettings;
  extensionIds?: string[];
}

export interface RouterSettings {
  cursorApiKey?: string;
  slackTeamId?: string;
  slackChannel?: string;
  slackBotToken?: string;
  codexCloudEnvId?: string;
  cursorCloudRepoUrl?: string;
  notifySlackOnJobComplete?: boolean;
  pollIntervalMs?: number;
  timeoutMs: number;
}

export interface PeerAdapter {
  id: string;
  route(req: RouteRequest, ctx: AdapterContext): Promise<RouteResult>;
  probe(ctx: AdapterContext): Promise<ProbeResult>;
}
