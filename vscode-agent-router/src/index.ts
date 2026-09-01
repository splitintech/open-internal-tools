export { AgentRouter, createContext, DEFAULT_SETTINGS } from "./core/router";
export {
  PeerRegistry,
  loadCatalog,
  loadMergedCatalog,
  DEFAULT_CATALOG_PATH,
  userCatalogPath,
  upsertUserPeer,
} from "./core/registry";
export { probePeer } from "./core/probe";
export { adapterFor } from "./adapters/index";
export { encodeClaudeHandoffUri, encodeRouterLaunchUri, parseRouterLaunchUri } from "./core/launchUri";
export { JobStore, extractJobRef, isTerminalStatus } from "./core/jobs";
export {
  resolveSlackCli,
  slackCliInstallPath,
  SLACK_CLI_FINGERPRINT,
  SLACK_CLI_INSTALL_HINT,
  buildSlackApiArgs,
} from "./transports/cli";
export type {
  Action,
  Catalog,
  PeerManifest,
  ProbeResult,
  RouteRequest,
  RouteResult,
  Runtime,
  TransportKind,
} from "./core/types";
