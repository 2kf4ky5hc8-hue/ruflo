// Envelope encryption for small secrets (TOTP secrets, recovery codes).
// Uses Node's built-in AES-256-GCM. Key is derived from env via SHA-256.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { env } from './env';

const ALGO = 'aes-256-gcm';

function key32(): Buffer {
  return createHash('sha256').update(env.TOTP_ENC_KEY).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key32(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: v1.iv.tag.cipher (base64url, dot-separated)
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function decryptSecret(encoded: string): string {
  const parts = encoded.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Bad ciphertext format');
  const [, ivB64, tagB64, encB64] = parts as [string, string, string, string];
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const enc = Buffer.from(encB64, 'base64url');
  const decipher = createDecipheriv(ALGO, key32(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}
