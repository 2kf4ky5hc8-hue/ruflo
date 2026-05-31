// Centralised env access.
//
// Dev: works with zero env vars — falls back to stable defaults so
//      `pnpm dev` boots without anything in your shell. AUTH_SECRET and
//      TOTP_ENC_KEY both fall back to deterministic 32-byte dev values
//      (so JWTs and TOTP enrolment survive restarts in dev).
//
// Prod: NODE_ENV=production refuses to boot with dev defaults, dev
//       placeholders, or short secrets — fail-fast.

const DEV_AUTH_SECRET  = 'ruflo-wealth-os-dev-secret-do-not-use-in-prod';   // 47 chars
const DEV_TOTP_ENC_KEY = 'ruflo-wealth-os-dev-totp-key-do-not-use-in-prod'; // 48 chars

const PLACEHOLDERS = new Set(['', '…', '...', 'change-me', 'dev-secret-change-me']);

function pickSecret(name: string, raw: string | undefined, devDefault: string): string {
  const value = raw ?? '';
  const isDev = process.env.NODE_ENV !== 'production';
  // Next.js sets NEXT_PHASE during build-time collection. Page-data collection
  // touches server modules; we don't need a real secret to compile — only at
  // runtime to sign tokens. Treat build phases as dev for this check.
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';
  const looksWeak = PLACEHOLDERS.has(value) || value.length < 32;

  if (looksWeak) {
    if (!isDev && !isBuildPhase) {
      throw new Error(
        `${name} must be a strong 32+ character secret in production. ` +
        `Generate one with: openssl rand -base64 32`,
      );
    }
    if (value && value !== devDefault && !isBuildPhase) {
      console.warn(`[env] ${name} too short — using dev default. Set a 32+ char value to silence this.`);
    }
    return devDefault;
  }
  return value;
}

export const env = {
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgres://wealth_os:wealth_os@localhost:5432/wealth_os',
  AUTH_SECRET:
    pickSecret('AUTH_SECRET', process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET, DEV_AUTH_SECRET),
  TOTP_ENC_KEY:
    pickSecret('TOTP_ENC_KEY', process.env.TOTP_ENC_KEY, DEV_TOTP_ENC_KEY),
  WEALTH_MODE: (process.env.WEALTH_MODE ?? 'advisor') as 'observer' | 'advisor' | 'assisted_live',
  APP_NAME: process.env.APP_NAME ?? 'Ruflo Wealth',
};
