export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isInvited(members: readonly string[], email: string): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return members.some((member) => normalizeEmail(member) === normalized);
}
