# Ruflo Wealth OS — MVP backlog (v0.1.0)

> Scope: Phase 1 only (see blueprint Phase 1). Goal of MVP: ingest → categorise →
> dashboard → ISA tracker → opportunity inbox → approval centre. **Zero broker
> write access.** Read-only and recommendation-only.

Story-point scale: Fibonacci (1, 2, 3, 5, 8, 13). A point ≈ a half day of focused
work for one developer who already knows the stack. 13 means "split this".

Status legend: ⏳ todo · 🔧 in progress · ✅ done · 🚧 blocked

Definition of done for every story:
- Code merged on a feature branch with passing CI.
- Tests written and passing (unit + at least one integration test where IO is involved).
- Audit-log entry written for any state-changing action.
- No PII leaked into logs or LLM prompts.
- Disclaimer surfaced on any user-facing recommendation.

---

## Epic 0 — Foundations  (target: week 1)

| ID    | Story                                                                                 | Pts | Status | Notes |
|-------|---------------------------------------------------------------------------------------|-----|--------|-------|
| F-001 | Apply `0001_initial.sql` migration to Postgres dev DB.                                | 1   | ⏳ | `psql $DATABASE_URL -f src/db/migrations/0001_initial.sql` |
| F-002 | Wire Drizzle ORM; verify `select 1` from each schema module.                          | 2   | ⏳ | Generated migrations vs hand-written SQL parity test. |
| F-003 | Run `pnpm db:seed` to load tax rules, risk profiles, default categories.              | 1   | ⏳ | Requires `DATABASE_URL`, optional `SEED_USER_EMAIL`. |
| F-004 | Set up Next.js 15 app skeleton (App Router, Tailwind, shadcn/ui).                     | 3   | ⏳ | Single-user mode for MVP. |
| F-005 | Auth.js with email + TOTP 2FA; session table integration; revoke flow.                | 5   | ⏳ | No password reset by email in MVP — recovery codes only. |
| F-006 | Audit-log middleware: every mutation writes a row to `audit_events`.                  | 3   | ⏳ | Use a Drizzle hook + request-context store. |
| F-007 | KMS-backed envelope encryption for `connections.refresh_token_encrypted` etc.         | 3   | ⏳ | Local: libsodium secretbox; prod: AWS KMS or Fly secrets. |
| F-008 | CI: typecheck, lint, vitest, `pnpm db:push --dry-run`, secret scan.                   | 2   | ⏳ | GitHub Actions; required checks on main. |
| F-009 | Observability: pino → file + OpenTelemetry exporter stub.                             | 2   | ⏳ | Wire Sentry later. |

**Epic total: 22 pts**

---

## Epic 1 — Ingest  (target: weeks 2–3)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| I-101 | CSV import: detect schema for HL, AJ Bell, Vanguard UK, Trading 212, Freetrade.        | 5   | One adapter per broker; fixtures in `tests/fixtures/brokers/`. |
| I-102 | CSV import: bank statements (Monzo, Starling, Revolut, HSBC, Barclays).                | 5   | Same adapter pattern. |
| I-103 | Manual transaction entry UI with category picker.                                      | 3   | Used as fallback for everything. |
| I-104 | Manual holding entry UI: instrument lookup by ISIN/ticker, cost basis, asof.           | 3   | Lookup hits FMP/Tiingo, caches `instruments` rows. |
| I-105 | TrueLayer AISP integration: OAuth flow, accounts + balances + 90d transactions.        | 8   | Provider abstraction so Tink/Yapily can swap in. |
| I-106 | Consent expiry handler: alert user 7 days before; one-tap reconsent.                   | 3   | Reads `connections.consent_expires_at`. |
| I-107 | Transfer-pair detection: same amount, opposite signs, ≤2 days apart, ≥0.9 confidence.  | 3   | Idempotent re-run safe. |
| I-108 | Duplicate-transaction detection: `(account_id, posted_at, amount, counterparty)`.      | 2   | Surface in import preview. |
| I-109 | Import preview screen: show first 50 rows, category guesses, transfer pairs.           | 5   | User accepts before commit. |

**Epic total: 37 pts**

---

## Epic 2 — Categorise  (target: weeks 3–4)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| C-201 | Rule engine: apply `category_rules` in priority order; track which rule matched.       | 3   |       |
| C-202 | LLM fallback categoriser (Haiku, structured output) for unrules transactions.          | 5   | Batch 50/req; never sends merchant→PII names without masking. |
| C-203 | Manual recategorise UI; "always categorise like this" promotes to a rule.              | 3   |       |
| C-204 | Subscription detection: repeating amount + counterparty, monthly cadence ±2 days.      | 3   | Surfaced on dashboard. |
| C-205 | Waste detector v1: subscriptions with no related merchant activity in 60 days.         | 3   | Output as `proposed_action` kind `cancel_subscription_review`. |

**Epic total: 17 pts**

---

## Epic 3 — Dashboard  (target: week 4)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| D-301 | Net worth widget: sum of accounts (FX-normalised to GBP).                              | 3   | Uses latest FX from prices table or static fallback. |
| D-302 | Cash position + emergency fund tracker (months of essential spend).                    | 3   | Pulls cash floor from active `risk_profile`. |
| D-303 | ISA progress bar: `deposited / allowance` and remaining for current tax year.          | 2   |       |
| D-304 | Business cash snapshot (latest `business_metrics`).                                    | 2   |       |
| D-305 | "This week's moves" panel: top 3 pending `proposed_action` rows.                       | 3   |       |
| D-306 | Risk status pill: all profile rules vs current portfolio; green/amber/red.             | 5   | Deterministic — same input → same colour. |
| D-307 | Compounding projection chart with rate toggles (3/5/7/10%).                            | 3   |       |
| D-308 | Period switcher (today, 7d, 30d, YTD, all).                                            | 2   |       |

**Epic total: 23 pts**

---

## Epic 4 — ISA tracker  (target: week 5)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| A-401 | Auto-detect ISA deposits from transactions tagged `ISA deposit`; write `isa_deposits`. | 3   |       |
| A-402 | Daily recompute of `isa_years.remaining` for current tax year.                         | 2   |       |
| A-403 | Flexible-ISA replacement handling (withdrawals + same-year replacement do not consume).| 5   | Edge case: cash ISA partial transfers. |
| A-404 | Holdings view per ISA: cost basis, unrealised P/L, dividends YTD, fee drag.            | 5   |       |
| A-405 | ISA eligibility check on each holding (consult tax-rules.yaml eligible list).          | 3   |       |
| A-406 | Allowance deadline reminders (30d, 14d, 7d, 1d) — write `proposed_action` kind alert.  | 2   |       |

**Epic total: 20 pts**

---

## Epic 5 — Opportunity scanner v1  (target: week 6)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| O-501 | Stock universe loader (FTSE 350 + curated global ETF list).                            | 3   | Pin universe; rotate quarterly. |
| O-502 | Filter: trailing P/E in band, FCF yield > threshold, debt/equity < threshold.          | 5   | Configurable per user. |
| O-503 | Dividend opportunity filter: yield > 3%, payout ratio < 80%, 5y growth ≥ 0.            | 3   |       |
| O-504 | Savings rate opportunity: curated list of UK easy-access + fixed; manual rate refresh. | 3   | No scraping. List is editable YAML. |
| O-505 | Rank: weighted score over upside, risk, liquidity, capital fit, tax fit.               | 5   | Pure function; unit-tested. |
| O-506 | Persist top 20 to `opportunities` daily; expire after 7 days.                          | 2   |       |
| O-507 | Opportunity inbox UI: list, filter by kind, mark "ignore for 30d".                     | 3   |       |

**Epic total: 24 pts**

---

## Epic 6 — Single-ticker research  (target: week 7)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| R-601 | Fundamentals snapshot fetcher (FMP or Tiingo); caches in `fundamentals`.               | 3   |       |
| R-602 | News fetcher (last 14d); store titles + URLs; never full body.                         | 3   |       |
| R-603 | Research generator agent: produce `research_note` with bull/base/bear + citations.     | 8   | Claude Sonnet; structured JSON schema enforced. |
| R-604 | Citation validator: every numeric claim must have a `source_id` resolvable to a row.   | 3   | Run as part of agent output validation. |
| R-605 | Research note viewer; copy-to-clipboard markdown export.                               | 3   |       |
| R-606 | "Refresh research" button with rate-limit (max 1 per ticker per 6h).                   | 2   |       |

**Epic total: 22 pts**

---

## Epic 7 — Risk engine  (target: week 7)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| K-701 | Pure-function rule evaluator: takes `(profile, holdings, action)` → pass/fail+reasons. | 5   | Deterministic; 100% test coverage required. |
| K-702 | Block proposed_action insert if rule-eval fails; surface reason in UI.                 | 2   |       |
| K-703 | Daily breach scan: writes `risk_breaches` for current portfolio violations.            | 3   |       |
| K-704 | Concentration warning at 1.5× cap.                                                     | 2   |       |
| K-705 | Cooling-off enforcement: block approval if last decision < `cooling_off_minutes` ago.  | 2   |       |
| K-706 | Sleep-mode enforcement: block live-mode actions outside window.                        | 2   | Live mode not enabled in MVP, but middleware must exist. |

**Epic total: 16 pts**

---

## Epic 8 — Allocation engine  (target: week 8)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| L-801 | Spare-cash detector: balance above 1.1× emergency fund for ≥7 days.                    | 3   |       |
| L-802 | Recommend split using active `allocation_rules.weights`.                               | 3   |       |
| L-803 | Write `spare_cash_event` + `proposed_action` for allocation.                           | 2   |       |
| L-804 | Allocation rule editor UI; preview impact on next £100/£500/£1,000.                    | 5   |       |

**Epic total: 13 pts**

---

## Epic 9 — Approval centre  (target: week 8)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| P-901 | Inbox list of pending `proposed_action` sorted by `expires_at`.                        | 2   |       |
| P-902 | Detail view: reason, upside, downside, risk score, confidence, alternatives.           | 3   |       |
| P-903 | Approve / reject / snooze; record decision + decided_by + decision_note.               | 3   |       |
| P-904 | "Approve" never executes externally in MVP — marks intent + records outcome later.     | 2   | Document explicitly in UI: "MVP: no external execution." |
| P-905 | Empty-state and "show learned preferences" panel.                                      | 2   |       |

**Epic total: 12 pts**

---

## Epic 10 — Weekly Wealth Review  (target: week 8)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| W-1001| Cron at Sunday 18:00 UK; assemble template (see blueprint H).                           | 5   | Use Ruflo's `@claude-flow/hooks` daemon as the scheduler. |
| W-1002| Persist as `reports` row; render as markdown + sendable HTML email.                    | 3   |       |
| W-1003| Email delivery via Postmark or Resend; record `sent_at`.                               | 3   |       |
| W-1004| In-app history view of past reviews.                                                   | 2   |       |

**Epic total: 13 pts**

---

## Epic 11 — Quality & launch readiness  (target: week 8)

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| Q-1101| Guardrail validator: scans all agent outputs for banned phrases + missing disclaimers. | 3   | Deterministic. |
| Q-1102| PII redactor: masks account numbers / sort codes / addresses before LLM call.          | 3   |       |
| Q-1103| Kill switch: `WEALTH_MODE=observer` env var disables all writes globally.              | 2   |       |
| Q-1104| Restore-from-backup runbook; tested at least once.                                     | 3   |       |
| Q-1105| Threat-model doc; penetration smoke test (auth, IDOR, SSRF, CSRF).                     | 5   |       |
| Q-1106| Privacy-policy + disclaimer copy reviewed.                                             | 2   |       |

**Epic total: 18 pts**

---

## Totals & critical path

| Epic                                | Pts |
|-------------------------------------|----:|
| 0 Foundations                       | 22  |
| 1 Ingest                            | 37  |
| 2 Categorise                        | 17  |
| 3 Dashboard                         | 23  |
| 4 ISA tracker                       | 20  |
| 5 Opportunity scanner v1            | 24  |
| 6 Single-ticker research            | 22  |
| 7 Risk engine                       | 16  |
| 8 Allocation engine                 | 13  |
| 9 Approval centre                   | 12  |
| 10 Weekly Wealth Review             | 13  |
| 11 Quality & launch readiness       | 18  |
| **MVP total**                       | **237** |

At 4–6 pts per focused day (solo dev, real life), MVP lands in **8–10 weeks** as planned.

Critical path: F-001 → F-005 → I-101/I-105 → C-201 → D-301 → A-401 → K-701 → P-901 → W-1001.

Cut lines if time runs short, in order:
1. C-202 (LLM categoriser) — fall back to rules + manual.
2. I-105 (TrueLayer) — fall back to CSV.
3. O-503 (dividend filter) — keep O-501/O-502/O-504.
4. R-603 (research generator) — keep R-601/R-602/R-605 (data view only).
