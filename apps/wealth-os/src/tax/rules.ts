// Server-only loader for config/tax-rules.yaml.
//
// Cached after first read. Validates with Zod — a malformed YAML or a missing
// field crashes at startup instead of silently returning bad tax numbers.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TaxRulesSchema, type TaxRules } from './types';

let cached: TaxRules | null = null;

export function getTaxRules(): TaxRules {
  if (cached) return cached;

  const path = resolve(process.cwd(), 'config', 'tax-rules.yaml');
  const raw = readFileSync(path, 'utf8');
  const parsed = parseYaml(raw);
  cached = TaxRulesSchema.parse(parsed);
  return cached;
}

// Test-only: lets specs inject a known ruleset without touching disk.
export function __setTaxRulesForTest(rules: TaxRules | null): void {
  cached = rules;
}
