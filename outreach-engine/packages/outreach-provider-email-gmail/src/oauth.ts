import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GOOGLE_TOKEN_URL, type GoogleGrant } from './token';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export interface GoogleAuthorizeOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: readonly string[];
  /** Pre-selects the mailbox in Google's account chooser. */
  readonly loginHint?: string;
  /** Receives the URL the user must open; the CLI prints it (and may open a browser). */
  readonly onUrl: (url: string) => void;
  readonly authUrl?: string;
  readonly tokenUrl?: string;
  readonly api?: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface GoogleAuthorization {
  readonly grant: GoogleGrant;
  /** The mailbox that granted access, read from Gmail itself (not from what the user typed). */
  readonly emailAddress: string;
  readonly scopes: readonly string[];
}

const b64url = (buffer: Buffer) => buffer.toString('base64url');

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Outreach engine</title><p style="font:16px system-ui;margin:3rem">${message}</p>`;

/**
 * Google's installed-app flow with a loopback redirect (RFC 8252): PKCE (S256), a random `state`, a
 * listener bound to 127.0.0.1 only, and one callback accepted. Resolves with a refresh-token grant.
 */
export async function authorizeGoogle(options: GoogleAuthorizeOptions): Promise<GoogleAuthorization> {
  const doFetch = options.fetch ?? fetch;
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const state = b64url(randomBytes(16));

  let settle: (value: { code: string } | Error) => void = () => {};
  const callback = new Promise<{ code: string } | Error>((resolve) => (settle = resolve));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== '/callback') {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const ok = !error && code && url.searchParams.get('state') === state;
    res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE(ok ? 'Connected. You can close this tab and return to the terminal.' : 'Authorization failed. Return to the terminal.'));
    settle(ok ? { code } : new Error(error ? `Google returned ${error}` : 'callback had a missing code or a mismatched state'));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;

  try {
    const auth = new URL(options.authUrl ?? GOOGLE_AUTH_URL);
    auth.search = new URLSearchParams({
      client_id: options.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: options.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      ...(options.loginHint ? { login_hint: options.loginHint } : {}),
    }).toString();
    options.onUrl(auth.toString());

    const timeout = new Promise<Error>((resolve) => setTimeout(() => resolve(new Error('timed out waiting for the Google sign-in')), options.timeoutMs ?? 300_000).unref());
    const result = await Promise.race([callback, timeout]);
    if (result instanceof Error) throw result;

    const exchange = await doFetch(options.tokenUrl ?? GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: options.clientId,
        client_secret: options.clientSecret,
        code: result.code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    const tokens = (await exchange.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; scope?: string; error?: string };
    if (!exchange.ok || !tokens.access_token) throw new Error(`token exchange failed (${tokens.error ?? `HTTP ${exchange.status}`})`);
    if (!tokens.refresh_token) throw new Error('Google returned no refresh token; remove the app under myaccount.google.com/permissions and connect again');
    const granted = (tokens.scope ?? options.scopes.join(' ')).split(' ');
    const missing = options.scopes.filter((scope) => !granted.includes(scope));
    if (missing.length) throw new Error(`the grant is missing scopes: ${missing.join(', ')} (tick every box on the consent screen)`);

    const profile = await doFetch(new URL('/gmail/v1/users/me/profile', options.api ?? 'https://gmail.googleapis.com'), {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const body = (await profile.json().catch(() => ({}))) as { emailAddress?: string };
    if (!profile.ok || !body.emailAddress) throw new Error(`could not read the connected mailbox (HTTP ${profile.status})`);
    return {
      grant: { clientId: options.clientId, clientSecret: options.clientSecret, refreshToken: tokens.refresh_token },
      emailAddress: body.emailAddress.toLowerCase(),
      scopes: granted,
    };
  } finally {
    server.closeAllConnections();
    server.close();
  }
}
