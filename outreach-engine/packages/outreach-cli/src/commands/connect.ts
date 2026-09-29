import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { authorizeGoogle, GMAIL_SCOPES } from '@splitin/outreach-provider-email-gmail';
import { expandHome, UsageError } from '../runtime';
import { flag, required, type Command } from './types';

export const connectCommands: readonly Command[] = [
  {
    name: 'account connect gmail',
    usage: 'outreach account connect gmail --client-id <id> --client-secret-env <ENV_NAME> [--login-hint <address>] [--out <path>]',
    summary: 'Sign in to Google and store the Gmail grant in an owner-only file for a file: secret reference.',
    flags: { 'client-id': 'string', 'client-secret-env': 'string', 'login-hint': 'string', out: 'string' },
    async run({ flags, out, env, notice, openUrl }) {
      // The client secret is read from the environment, never from argv (visible to other users in `ps`).
      const secretEnv = required(flags, 'client-secret-env');
      const clientSecret = env[secretEnv];
      if (!clientSecret) throw new UsageError(`environment variable ${secretEnv} is empty; export the OAuth client secret there`);
      const loginHint = flag(flags, 'login-hint');
      const result = await authorizeGoogle({
        clientId: required(flags, 'client-id'),
        clientSecret,
        scopes: GMAIL_SCOPES,
        ...(loginHint ? { loginHint } : {}),
        onUrl: (url) => {
          notice(`Open this URL in a browser on this machine and sign in to the mailbox you will send from:\n\n  ${url}\n\nWaiting for Google...`);
          openUrl?.(url);
        },
        // Endpoint overrides exist for testing against a fake Google; leave them unset in real use.
        ...(env.OUTREACH_GOOGLE_AUTH_URL ? { authUrl: env.OUTREACH_GOOGLE_AUTH_URL } : {}),
        ...(env.OUTREACH_GOOGLE_TOKEN_URL ? { tokenUrl: env.OUTREACH_GOOGLE_TOKEN_URL } : {}),
        ...(env.OUTREACH_GMAIL_API ? { api: env.OUTREACH_GMAIL_API } : {}),
      });
      if (loginHint && loginHint.toLowerCase() !== result.emailAddress) {
        throw new Error(`you signed in as ${result.emailAddress}, not ${loginHint}; nothing was saved`);
      }
      const path = resolve(expandHome(flag(flags, 'out') ?? `~/.config/outreach/gmail-${result.emailAddress}.json`, env));
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, `${JSON.stringify(result.grant)}\n`, { mode: 0o600 });
      chmodSync(path, 0o600); // writeFileSync keeps the old mode when the file already existed.
      out.result({
        connected: result.emailAddress,
        secretRef: `file:${path}`,
        next:
          `outreach account add --provider gmail --external-id ${result.emailAddress} --sender-email ${result.emailAddress} ` +
          `--sender-name "<your name>" --postal "<postal address>" --purposes <purposes> --secret file:${path}`,
      });
    },
  },
];
