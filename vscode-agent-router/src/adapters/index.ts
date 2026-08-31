import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";
import { createGenericAdapter } from "./generic";
import { slackAdapter } from "./slack";
import type { PeerAdapter } from "../core/types";
import type { PeerRegistry } from "../core/registry";

const SPECIAL: Record<string, PeerAdapter> = {
  cursor: cursorAdapter,
  claude: claudeAdapter,
  codex: codexAdapter,
  slack: slackAdapter,
};

export function adapterFor(registry: PeerRegistry, id: string): PeerAdapter {
  return SPECIAL[id] ?? createGenericAdapter(registry.get(id));
}

export { claudeAdapter, codexAdapter, cursorAdapter, slackAdapter, createGenericAdapter };
