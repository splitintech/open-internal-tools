const secrets = new Map<string, { secret: string; expiresAt: number }>();

function storageBlocked(): void {
  // Transient secrets must never enter Web Storage. This function exists so
  // tests can assert the controller never writes launch credentials.
}

export function rememberTransientSecret(attemptId: string, secret: string, expiresAt?: string | null): void {
  storageBlocked();
  secrets.set(attemptId, {
    secret,
    expiresAt: expiresAt ? Date.parse(expiresAt) : Date.now() + 5 * 60_000,
  });
}

export function peekTransientSecret(attemptId: string, now = Date.now()): string | undefined {
  const row = secrets.get(attemptId);
  if (!row) return undefined;
  if (row.expiresAt <= now) {
    secrets.delete(attemptId);
    return undefined;
  }
  return row.secret;
}

export function takeTransientSecret(attemptId: string, now = Date.now()): string | undefined {
  const secret = peekTransientSecret(attemptId, now);
  secrets.delete(attemptId);
  return secret;
}

export function forgetTransientSecret(attemptId: string): void {
  secrets.delete(attemptId);
}

export function forgetAllTransientSecrets(): void {
  secrets.clear();
}

export function rememberLaunchSecrets(attemptId: string, launch: { transientSecret?: string; transientSecretExpiresAt?: string } | null): void {
  if (!launch?.transientSecret) return;
  rememberTransientSecret(attemptId, launch.transientSecret, launch.transientSecretExpiresAt);
}
