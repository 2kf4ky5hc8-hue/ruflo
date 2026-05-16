// TOTP helpers — RFC 6238 via the `otpauth` library.

import * as OTPAuth from 'otpauth';
import { env } from './env';

export interface NewTotp {
  secretBase32: string;
  uri: string;
}

export function newTotpForEmail(email: string): NewTotp {
  const secret = new OTPAuth.Secret({ size: 20 });
  const totp = new OTPAuth.TOTP({
    issuer: env.APP_NAME,
    label: email,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret,
  });
  return { secretBase32: secret.base32, uri: totp.toString() };
}

export function verifyTotp(secretBase32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const totp = new OTPAuth.TOTP({
    algorithm: 'SHA1', digits: 6, period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  // Accept ±1 step of clock drift.
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}
