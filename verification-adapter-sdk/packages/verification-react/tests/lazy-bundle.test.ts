import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const launcherDir = join(dirname(fileURLToPath(import.meta.url)), '../src/launcher');

describe('verification launcher lazy bundle', () => {
  it('lazy-loads vendor SDKs instead of statically importing them from the launcher entry', () => {
    const indexSource = readFileSync(join(launcherDir, 'index.ts'), 'utf8');
    const launcherSource = readFileSync(join(launcherDir, 'VerificationLauncher.tsx'), 'utf8');
    const source = `${indexSource}\n${launcherSource}`;
    expect(source).toContain('lazy(()');
    expect(indexSource).not.toMatch(/from ['"]@stripe\/stripe-js['"]/);
    expect(indexSource).not.toMatch(/from ['"]persona['"]/);
    expect(indexSource).not.toMatch(/from ['"]react-plaid-link['"]/);
    const topLevel = launcherSource.split('export function VerificationLauncher')[0] ?? launcherSource;
    expect(topLevel).not.toMatch(/from ['"]@stripe\/stripe-js['"]/);
    expect(topLevel).not.toMatch(/from ['"]persona['"]/);
    expect(topLevel).not.toMatch(/from ['"]react-plaid-link['"]/);
  });
});
