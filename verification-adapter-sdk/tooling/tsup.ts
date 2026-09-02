import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsup';

const emitDeclarationMaps = join(dirname(fileURLToPath(import.meta.url)), '../scripts/emit-declaration-maps.mjs');

export function createTsupConfig(entry: Record<string, string>, external: string[] = []) {
  return defineConfig({
    entry,
    format: ['esm', 'cjs'],
    dts: {
      compilerOptions: {
        declaration: true,
        declarationMap: true,
        composite: false,
        incremental: false,
      },
    },
    sourcemap: true,
    clean: true,
    treeshake: true,
    splitting: false,
    target: 'es2022',
    external,
    async onSuccess() {
      const result = spawnSync(process.execPath, [emitDeclarationMaps], { stdio: 'inherit' });
      if (result.status !== 0) {
        throw new Error(`emit-declaration-maps failed with exit ${result.status ?? 1}`);
      }
    },
  });
}
