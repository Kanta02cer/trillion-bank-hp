/**
 * Google の更新用トークン（refresh_token）を DB に置く前に暗号化する（AES-256-GCM）。
 *   鍵は環境変数 GOOGLE_TOKEN_KEY（32 バイトを base64 にしたもの）。鍵が無ければ保管しない（これまでどおりブラウザだけ）。
 *   形式: v1.<iv>.<tag>.<暗号文>（いずれも base64url）。DB は v1. で始まらないものを受け付けない。
 *   平文のトークンは記録・応答に出さない。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export function tokenKey(env = process.env) {
  const raw = String(env.GOOGLE_TOKEN_KEY || '').trim();
  if (!raw) return null;
  try {
    const k = Buffer.from(raw, 'base64');
    return k.length === 32 ? k : null;
  } catch (e) { return null; }
}

export function canStoreTokens(env = process.env) { return !!tokenKey(env); }

export function encryptToken(plain, env = process.env) {
  const key = tokenKey(env);
  if (!key || !plain) return null;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptToken(enc, env = process.env) {
  const key = tokenKey(env);
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(enc || ''));
  if (!key || !m) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(m[1], 'base64url'));
    d.setAuthTag(Buffer.from(m[2], 'base64url'));
    return Buffer.concat([d.update(Buffer.from(m[3], 'base64url')), d.final()]).toString('utf8');
  } catch (e) { return null; }
}
