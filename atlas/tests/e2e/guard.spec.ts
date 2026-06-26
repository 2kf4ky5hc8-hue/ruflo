import { test, expect } from '@playwright/test';
import { assertNotProduction } from './guard';

// Pure-logic checks for the production safety guard. These run without a browser
// or credentials, so they always execute as a first line of defence.
test.describe('production safety guard', () => {
  test('allows the staging URL', () => {
    expect(() =>
      assertNotProduction('https://atlas-staging-19w.pages.dev'),
    ).not.toThrow();
  });

  test('rejects the production frontend URL', () => {
    expect(() => assertNotProduction('https://ruflo-35k.pages.dev')).toThrow(
      /PRODUCTION GUARD/,
    );
  });

  test('rejects the production Supabase ref', () => {
    expect(() =>
      assertNotProduction('https://svllpyrcxvxtwsqaippg.supabase.co'),
    ).toThrow(/PRODUCTION GUARD/);
  });

  test('rejects unknown / unexpected hosts', () => {
    expect(() => assertNotProduction('https://example.com')).toThrow(
      /PRODUCTION GUARD/,
    );
  });
});
