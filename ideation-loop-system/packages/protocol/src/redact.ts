const SECRETISH = [
  /\bxox[baprs]-[A-Za-z0-9-]+\b/g,
  /\bsk_live_[A-Za-z0-9]+\b/g,
  /\bsk_test_[A-Za-z0-9]+\b/g,
  /\bBearer\s+[A-Za-z0-9._\-]+\b/gi,
  /\b(?:api[_-]?key|secret|token|password)\s*[:=]\s*\S+/gi,
  /https?:\/\/hooks\.slack\.com\/[^\s]+/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRETISH) {
    out = out.replace(re, "[redacted]");
  }
  return out;
}
