// Everything coming back from the server is UNTRUSTED data: it may contain terminal escape
// sequences, secrets, and even text written to manipulate the agent (prompt injection via logs).

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const SECRET_ASSIGN_RE =
  /\b([A-Za-z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIALS?)[A-Za-z0-9_]*)(\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/g;
const URL_CREDS_RE = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi;
const PEM_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;

export function sanitize(text: string): string {
  return text
    .replace(ANSI_RE, '')
    .replace(CONTROL_RE, '')
    .replace(PEM_RE, '[private key removed]')
    .replace(SECRET_ASSIGN_RE, (_m, key: string, sep: string) => `${key}${sep}***`)
    .replace(BEARER_RE, (_m, scheme: string) => `${scheme} ***`)
    .replace(URL_CREDS_RE, (_m, scheme: string, user: string) => `${scheme}${user}:***@`);
}

/** For short fields (container name, image, status): sanitizes and caps the length. */
export function sanitizeField(value: unknown, max = 200): string {
  const s = sanitize(String(value ?? '')).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
