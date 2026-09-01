import { claudeAdapter } from "./claude";
import { chatgptAdapter } from "./chatgpt";
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
  chatgpt: chatgptAdapter,
  slack: slackAdapter,
};

export function adapterFor(registry: PeerRegistry, id: string): PeerAdapter {
  return SPECIAL[id] ?? createGenericAdapter(registry.get(id));
}

export {
  chatgptAdapter,
  claudeAdapter,
  codexAdapter,
  cursorAdapter,
  slackAdapter,
  createGenericAdapter,
};
