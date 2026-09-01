import type { PeerAdapter } from "../core/types";
import { probePeer } from "../core/probe";
import { loadMergedCatalog, PeerRegistry } from "../core/registry";
import { launchIdePeer, refuseVendorCli } from "./ideLaunch";

export const codexAdapter: PeerAdapter = {
  id: "codex",
  async route(req) {
    const runtime = req.runtime ?? "ide";
    if (runtime !== "ide") return refuseVendorCli("codex", req);
    const prompt = String(req.prompt ?? req.params?.prompt ?? "");
    return launchIdePeer("codex", req, prompt);
  },
  async probe(ctx) {
    return probePeer(new PeerRegistry(loadMergedCatalog()).get("codex"), ctx);
  },
};
