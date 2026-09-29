import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeGmailServer } from '@splitin/outreach-fakes';
import { main } from './main';
import { envSecrets } from './runtime';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0)) await step();
});

describe('outreach account connect gmail', () => {
  it('signs in over loopback OAuth and writes the grant to an owner-only file usable as file: secret', async () => {
    const gmail = await new FakeGmailServer({ mailbox: 'sam@example.com' }).start();
    const dir = mkdtempSync(join(tmpdir(), 'outreach-connect-'));
    cleanup.push(() => gmail.stop(), () => rmSync(dir, { recursive: true, force: true }));
    const out = join(dir, 'nested', 'gmail.json');
    const env = {
      HOME: dir,
      GOOGLE_CLIENT_SECRET: 'client-secret-value',
      OUTREACH_GOOGLE_AUTH_URL: `${gmail.url}/authorize`,
      OUTREACH_GOOGLE_TOKEN_URL: `${gmail.url}/token`,
      OUTREACH_GMAIL_API: gmail.url,
    };
    let stdout = '';
    let stderr = '';
    const code = await main(['account', 'connect', 'gmail', '--client-id', 'client-id', '--client-secret-env', 'GOOGLE_CLIENT_SECRET', '--out', out, '--json'], {
      env,
      write: (text) => (stdout += text),
      writeError: (text) => (stderr += text),
      openUrl: (url) => void fetch(url), // The "browser": follows the consent redirect to the loopback callback.
    });
    expect(code).toBe(0);
    expect(stderr).toMatch(/Open this URL/);
    expect(JSON.parse(stdout)).toMatchObject({ connected: 'sam@example.com', secretRef: `file:${out}` });
    expect(stdout).not.toContain('refresh-token-value');
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(out, 'utf8'))).toMatchObject({ clientId: 'client-id', refreshToken: 'refresh-token-value' });

    expect(await envSecrets(env).get(`file:${out}`)).toContain('refresh-token-value');
    chmodSync(out, 0o644);
    await expect(envSecrets(env).get(`file:${out}`)).rejects.toThrow(/readable by other users/);
  });

  it('refuses to run without the client secret in the environment', async () => {
    let stderr = '';
    const code = await main(['account', 'connect', 'gmail', '--client-id', 'x', '--client-secret-env', 'MISSING'], { env: {}, writeError: (text) => (stderr += text) });
    expect(code).toBe(2);
    expect(stderr).toMatch(/MISSING is empty/);
  });
});
