import type { PeerAdapter } from "../core/types";
import { probePeer } from "../core/probe";
import { loadMergedCatalog, PeerRegistry } from "../core/registry";
import { launchIdePeer, refuseVendorCli } from "./ideLaunch";

export const chatgptAdapter: PeerAdapter = {
  id: "chatgpt",
  async route(req) {
    const runtime = req.runtime ?? "ide";
    if (runtime !== "ide") return refuseVendorCli("chatgpt", req);
    const prompt = String(req.prompt ?? req.params?.prompt ?? "");
    return launchIdePeer("chatgpt", req, prompt);
  },
  async probe(ctx) {
    const peer = new PeerRegistry(loadMergedCatalog()).get("chatgpt");
    return probePeer(peer, ctx);
  },
};
