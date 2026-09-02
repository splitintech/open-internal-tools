import type { BrowserPlugin, BrowserPluginLoader } from './types.ts';

const loaded = new Map<string, BrowserPlugin>();

export async function loadBrowserPlugin(
  launcherKey: string,
  registry: Record<string, BrowserPlugin | BrowserPluginLoader>,
): Promise<BrowserPlugin | null> {
  const cached = loaded.get(launcherKey);
  if (cached) return cached;
  const entry = registry[launcherKey];
  if (!entry) return null;
  const plugin = typeof entry === 'function' ? unwrap(await entry()) : entry;
  loaded.set(launcherKey, plugin);
  return plugin;
}

export function clearPluginCache(): void {
  loaded.clear();
}

function unwrap(value: BrowserPlugin | { default: BrowserPlugin }): BrowserPlugin {
  return 'present' in value ? value : value.default;
}
