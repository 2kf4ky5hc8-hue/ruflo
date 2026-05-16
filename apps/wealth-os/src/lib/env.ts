// Centralised env access with defaults — never throws at import time.
// Auth secrets are required at runtime when auth handlers actually run.

export const env = {
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgres://wealth_os:wealth_os@localhost:5432/wealth_os',
  AUTH_SECRET:
    process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'dev-secret-change-me',
  TOTP_ENC_KEY:
    process.env.TOTP_ENC_KEY ?? 'dev-enc-key-change-me-32-bytes!!!',
  WEALTH_MODE: (process.env.WEALTH_MODE ?? 'advisor') as 'observer' | 'advisor' | 'assisted_live',
  APP_NAME: process.env.APP_NAME ?? 'Ruflo Wealth',
};
