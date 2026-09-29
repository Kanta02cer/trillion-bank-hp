/**
 * share_token: 32 byte の CSPRNG → base64url（43 文字、パディングなし）。
 * DB には SHA-256 hex だけを渡す。生トークンは保存せず、ログにも出さない。
 */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export const SHARE_TOKEN_HASH_RE = /^[0-9a-f]{64}$/;

export function generateShareToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export async function sha256Hex(input) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Buffer.from(digest).toString('hex');
}

export function isShareTokenFormat(token) {
  return typeof token === 'string' && SHARE_TOKEN_RE.test(token);
}
