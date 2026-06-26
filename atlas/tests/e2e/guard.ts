// =============================================================================
// HARD SAFETY GUARD — E2E tests must NEVER run against production.
//
// Production frontend:  ruflo-35k.pages.dev
// Production Supabase:  svllpyrcxvxtwsqaippg  (project ref)
//
// These tests create/modify data, so they are only ever allowed to point at the
// STAGING app (atlas-staging…) or a local dev server. Anything that looks like
// production aborts the whole run before a single test starts.
// =============================================================================

// If any of these appear in the target URL or relevant env vars, we refuse.
export const PRODUCTION_MARKERS = [
  'ruflo-35k', // production Cloudflare Pages project
  'svllpyrcxvxtwsqaippg', // production Supabase project ref
];

// The target URL must contain one of these to be considered a safe target.
export const ALLOWED_HOST_MARKERS = ['atlas-staging', 'localhost', '127.0.0.1'];

/** Throws if the URL or env looks like production. */
export function assertNotProduction(url: string): void {
  const candidates = [
    url,
    process.env.ATLAS_E2E_BASE_URL,
    process.env.ATLAS_E2E_SUPABASE_REF,
    process.env.ATLAS_E2E_SUPABASE_URL,
    process.env.VITE_SUPABASE_URL,
  ].filter(Boolean) as string[];

  for (const marker of PRODUCTION_MARKERS) {
    const hit = candidates.find((c) => c.includes(marker));
    if (hit) {
      throw new Error(
        `🚫 PRODUCTION GUARD: detected production marker "${marker}" in "${hit}". ` +
          `E2E tests must never run against production. Aborting.`,
      );
    }
  }

  if (!ALLOWED_HOST_MARKERS.some((m) => url.includes(m))) {
    throw new Error(
      `🚫 PRODUCTION GUARD: "${url}" is not a recognised staging/local target ` +
        `(must contain one of: ${ALLOWED_HOST_MARKERS.join(', ')}). Aborting.`,
    );
  }
}

/** Resolves the base URL from env and validates it is safe (staging/local). */
export function resolveBaseURL(): string {
  const url = process.env.ATLAS_E2E_BASE_URL?.trim();
  if (!url) {
    throw new Error(
      'ATLAS_E2E_BASE_URL is not set. Point it at the STAGING app, e.g.\n' +
        '  ATLAS_E2E_BASE_URL=https://atlas-staging-19w.pages.dev\n' +
        'Refusing to run E2E tests with no target.',
    );
  }
  assertNotProduction(url);
  return url;
}
