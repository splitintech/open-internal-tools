/** Canonical JSON: recursively sorted object keys, no insignificant whitespace. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, sortValue(record[key])]),
    );
  }
  return value;
}

export async function digestCanonical(value: unknown): Promise<string> {
  const { sha256Hex } = await import('./hash.ts');
  return sha256Hex(canonicalize(value));
}
