# Ruflo Wealth OS — MVP backlog (v0.1.0)

> Scope: Phase 1 only (see blueprint Phase 1). Goal of MVP: ingest → categorise →
> dashboard → ISA tracker → opportunity inbox → approval centre. **Zero broker
> write access.** Read-only and recommendation-only.

## Ruflo integration

Wealth OS reuses ruflo's framework rather than reinventing it. Concretely:

| Wealth OS need              | Ruflo package                   | Integration point                                          |
|-----------------------------|---------------------------------|------------------------------------------------------------|
| Agent definitions           | `v3/@claude-flow/agents/`       | 10 `wealth-*.yaml` files; registry in `src/ruflo/agents.ts`|
| Scheduling (weekly review)  | `@claude-flow/hooks` daemon     | `src/ruflo/hooks.ts` registers 6 cron jobs                 |
| Cross-session memory        | `@claude-flow/memory` (AgentDB) | `src/ruflo/memory.ts` — namespaces `wealth.*`              |
| PII redaction + validators  | `@claude-flow/security`         | `src/ruflo/security.ts` — Zod schemas, PII regexes         |
| 3-tier model routing        | ADR-026                         | `wealthAgents[].model` per role (haiku/sonnet/opus)        |
| Anti-drift swarm topology   | hierarchical/specialised        | `wealth-coach` coordinates, sub-agents have narrow scope   |

The kill switch `WEALTH_MODE=observer` disables every write at the integration
layer regardless of which subsystem invokes it.

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
| F-001 | Apply `0001_initial.sql` migration to Postgres dev DB.                                | 1   | ✅ | Done via `pnpm db:migrate` (30 tables created after 0002). |
| F-002 | Wire Drizzle ORM; verify `select 1` from each schema module.                          | 2   | ✅ | `pnpm db:check` verifies connection + every expected table + auth columns. |
| F-003 | Run `pnpm db:seed` to load tax rules, risk profiles, default categories.              | 1   | ✅ | Aggressive profile + allocation rule are active; 10 institutions seeded. |
| F-004 | Set up Next.js 15 app skeleton (App Router, Tailwind).                                | 3   | ✅ | App Router, Tailwind, custom utility classes (`.card`, `.btn`, etc.). |
| F-005 | Auth.js with email + password + TOTP 2FA; recovery codes; first-run setup.            | 5   | ✅ | Edge/Node split; JWT session strategy; bcrypt; AES-256-GCM TOTP enc; audit log on sign-in. Session-table revoke is K-705 follow-up. |
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

| ID    | Story                                                                                  | Pts | Status | Notes |
|-------|----------------------------------------------------------------------------------------|-----|--------|-------|
| K-701 | Pure-function rule evaluator: takes `(profile, holdings, action)` → pass/fail+reasons. | 5   | ✅ | `src/risk/evaluator.ts` + 24 tests. Sleep-mode + new-instrument cap baked in. |
| K-702 | Block `proposed_action` insert if rule-eval fails; surface reason in UI.               | 2   | ✅ | `src/services/submit-proposed-action.ts` + 5 integration tests. Honours `WEALTH_MODE=observer`. |
| K-703 | Daily breach scan: writes `risk_breaches` for current portfolio violations.            | 3   | ⏸ | Deferred — re-evaluate after user enters a portfolio and runs the system. |
| K-704 | Concentration warning at 1.5× cap.                                                     | 2   | ⏸ | Deferred — same reason as K-703. |
| K-705 | Cooling-off enforcement + session-table revoke flow.                                   | 2   | ⏸ | Deferred — Approval Centre middleware comes alongside first real use. |
| K-706 | Sleep-mode enforcement: block live-mode actions outside window.                        | 2   | ✅ | Pure-function check inside evaluator. |

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

## Epic 12 — Wealth Coach module  (target: week 8–9)

The personalised orchestrator that turns raw data and per-agent outputs into
plain-English guidance. Coach never generates net-new recommendations on its
own — it composes them from other agents' results, sequenced by what makes
sense for *this* user *this* week.

| ID    | Story                                                                                  | Pts | Notes |
|-------|----------------------------------------------------------------------------------------|-----|-------|
| WC-1201 | Onboarding flow: 4-step wizard (profile, accounts, goals, risk tolerance check).     | 5 ✅ | `src/app/onboarding/*` — profile + risk, position (cash/ISA/GIA/pension/biz/debt), monthly cashflow, up-to-6 goals. Saves to canonical tables; idempotent. |
| WC-1202 | Personalised playbook generator: 6-month written plan derived from goals + profile.  | 5 ✅ | `src/services/playbook.ts` — pure-function markdown, ISA projections at 3/5/7/10%, stored as `reports.kind='playbook'`, re-runnable from `/playbook`. |
| WC-1203 | "Next 3 actions" widget: top-N pending `proposed_action` rows ranked by fit + urgency.| 3   | Re-uses risk evaluator score + age + ISA-deadline urgency multiplier. |
| WC-1204 | Monthly review prompt: cron on the 1st of each month, opens an in-app card.          | 3   | Calls Coach agent to synthesise the month. |
| WC-1205 | "Talk to the Coach" inline thread: anchored to a dashboard card or an opportunity.   | 5   | Conversation persists in `agent_runs`; PII-redacted before LLM call. |
| WC-1206 | Coach guardrail: refuses tax/regulated-advice questions; routes to disclaimer + adviser link. | 3 | Deterministic intent classifier upstream of LLM. |
| WC-1207 | "Are you on track?" status: traffic light per active goal vs current trajectory.     | 3   | Pure-function projector over `goals` + recent contribution rate. |
| WC-1208 | Coach memory pinning: surface notes the user marked "remember" in subsequent reviews. | 2   | Uses `@claude-flow/memory` (optional peer dep) when available. |

**Epic total: 29 pts**

---

## Epics added after external review (2026-05-31)

The external review (`docs/wealth-os/handover.md`, reviewer reply
captured in chat) reshaped scope. Eight new epics, in priority order.

### Epic 13 — Default benchmark plan  (foundation for everything else)

Before any opportunity scanner: define the disciplined boring default
plan ("ISA into global tracker, gilts, cash, debt paydown, business
reserve"). Every proposal must explicitly beat or improve this baseline.

| ID    | Story | Pts | Notes |
|-------|-------|-----|-------|
| BM-1301 | Default-plan service: pure function over snapshot → waterfall + blended return. | 5 ✅ | `src/services/default-plan.ts` (10 tests). `/plan` page. |
| BM-1302 | "Would the default plan be better?" comparator. | 3 ✅ | `compareToDefaultPlan` — default_is_better / roughly_equal / proposal_is_better. |
| BM-1303 | Capture default-plan delta on paper positions; comparator available for `submitProposedAction`. | 3 ◐ | Paper positions store `benchmark_return_pct` + `default_plan_delta_pct` at open. Wiring into proposed_action insert is a small follow-up. |

**Epic total: 11 pts**

### Epic 14 — Paper portfolio + decision journal  (review §9)

Before any read-only broker integration: a paper portfolio surface that
marks every approved proposal to simulated execution price, tracks
mark-to-market vs the default-plan baseline, surfaces 30/90/180/365-day
outcomes. Closes the learning loop without ever touching real execution.

| ID    | Story | Pts | Notes |
|-------|-------|-----|-------|
| PP-1401 | `paper_positions` table; `paper_fills` table. | 2 ✅ | Migration 0004. |
| PP-1402 | Paper-fill simulator + fees model (stamp duty, FX spread, dealing fee). | 3 ✅ | `openPaperPosition` + `estimateFees` (tested). |
| PP-1403 | Mark-to-market: `valuePosition` computes unrealised P&L, annualised return. | 3 ✅ | Pure + tested. Manual mark via UI; automatic price feed arrives with ingest epics. |
| PP-1404 | Decision-journal page: reason codes, mark-to-market, default-plan delta, age. | 5 ✅ | `/paper`. Review-checkpoint columns (30/90/180/365d) in schema; reminders are a follow-up. |
| PP-1405 | "vs default plan" view: every position marked against the benchmark captured at open. | 3 ✅ | `valuePosition.vsBenchmarkGbp`; surfaced per-position and in the header total. |

**Epic total: 16 pts**

### Epic 15 — Business cashflow engine  (review §10.2)

The "do not extract cash that's owed to HMRC" guard. Uses the new
`business_obligations` table.

| ID    | Story | Pts | Notes |
|-------|-------|-----|-------|
| BC-1501 | Business obligations UI: add / edit / mark paid; recurring auto-generation. | 5 ✅ | `/business` — add VAT/PAYE/CT/payroll/rent/supplier, mark paid, delete. |
| BC-1502 | Reserve forecast: rolling 90-day projection of business cash less obligations. | 3 ✅ | Dashboard "Business reserve" card + `/business` runway. |
| BC-1503 | Xero / FreeAgent read connection (OAuth). | 5 | Read-only. Behind the same `Provider` interface as Open Banking. Deferred. |
| BC-1504 | Wire `businessCashGbp` + `businessObligationsDue90dGbp` into `FinanceSnapshot` for the evaluator. | 2 ✅ | `loadSnapshot` + `toPortfolioState`. Proven live: obligations>cash → `business_obligations_unpaid` block. |

**Epic total: 15 pts**

### Epic 16 — Debt triage  (review §10.3)

APR-aware. The `debt_items` table is in; this epic adds the UI and the
"do this debt before this investment" comparator.

| ID    | Story | Pts | Notes |
|-------|-------|-----|-------|
| DT-1601 | Debt items UI: add / edit / mark cleared. | 3 ✅ | `/debt` — add per-debt with APR, balance, kind, secured, delete. |
| DT-1602 | Debt-vs-invest comparator: after-tax marginal hurdle vs each debt APR. | 3 ✅ | `src/services/debt-advice.ts` (pure, 6 tests). Surfaced on `/debt` with verdict per debt. |
| DT-1603 | Toxic-debt warning on dashboard. | 2 ✅ | Dashboard "Debt" card shows toxic count; gates crypto + higher-risk. |
| DT-1604 | Wire `highestDebtAprPct` into `FinanceSnapshot`. | 1 ✅ | `loadSnapshot`. Proven live: 22% card → `crypto_requires_no_toxic_debt` block. |

**Epic total: 9 pts**

### Epic 17 — Fee drag engine  (review §10.4)

Make the cost layer visible. Uses the new `fee_schedules` table.

| ID    | Story | Pts | Notes |
|-------|-------|-----|-------|
| FE-1701 | Fee schedule library: seed with current public fees for HL, AJ Bell, Vanguard UK, T212, Freetrade, InvestEngine, Fidelity UK. | 3 | YAML, versioned. Verified against each provider's published page. |
| FE-1702 | Fee-impact calculator on the playbook ISA projection: shows gross vs net of platform + OCF + dealing. | 3 | |
| FE-1703 | "Switch broker" suggestion when annual fee drag exceeds a threshold for the user's pattern. | 3 | |

**Epic total: 9 pts**

### Epic 18 — Behavioural risk system  (review §10.5)

Stops the user doing daft things on bad days.

| ID    | Story | Pts | Notes |
|-------|-------|-----|-------|
| BE-1801 | Late-night risk-up detection: any proposal kind=trade between 22:00 and 07:00 UK auto-snoozes until 09:00. | 2 | Extends sleep window from K-706. |
| BE-1802 | Repeated High-Risk Unlock attempts → 24-hour cool-off. | 2 | |
| BE-1803 | "Selling after drawdown" pattern detector: warns before confirming. | 3 | |
| BE-1804 | "Chasing winners" detector: position-add after recent strong run. | 3 | |
| BE-1805 | "Averaging down into broken thesis" detector: position-add after thesis-status downgrade. | 3 | |

**Epic total: 13 pts**

### Epic 19 — Data quality layer  (review §10.6)

The new `reconciliation_status`, `last_verified_at`, `confidence_score`
columns exist; this epic uses them.

| ID    | Story | Pts | Notes |
|-------|-------|-----|-------|
| DQ-1901 | Reconciliation UI: list of un-reconciled transactions; one-tap confirm. | 5 | |
| DQ-1902 | Stale-data badge on every dashboard number: surfaces `last_verified_at`. | 3 | |
| DQ-1903 | Source-of-truth picker on holdings: manual override > broker CSV > price feed. | 3 | |
| DQ-1904 | Confidence-weighted aggregation in `loadSnapshot` — low-confidence balances flagged. | 3 | |

**Epic total: 14 pts**

### Epic 20 — Protection / insurance tracker  (review §10.7)

The new `insurance_policies` table; this epic adds the UI + the renewal
reminders + the "what's missing" gap analysis.

| ID    | Story | Pts | Notes |
|-------|-------|-----|-------|
| PR-2001 | Insurance UI: add / edit / mark lapsed; renewal reminders. | 5 ✅ | `/protection` — add policy, mark lapsed. Renewal-date reminders are a follow-up. |
| PR-2002 | Gap analysis: identifies missing cover (income protection if business owner, life if dependants, etc.). | 3 ✅ | `analyseProtectionGaps` (pure, 4 tests). Surfaced on `/protection`. |
| PR-2003 | Will + LPA tracking with renewal nudges. | 2 ◐ | Will/LPA are insurance kinds (trackable now); renewal nudges deferred. |

**Epic total: 10 pts**

---

## Explicitly NOT in scope

These were called out in the review (§8) and reaffirmed by the user
on 2026-05-31:

- **Autonomous trade execution.** The system never places live trades.
  Default mode is recommend → human approves → human submits. Even
  Assisted Live mode (much later, after legal review) only drafts a
  pre-filled ticket the user submits with one click.
- **Personal recommendations under COBS.** No "buy/sell this named
  instrument tailored to you". The system surfaces options against the
  default plan with bear cases populated; the user decides.
- **Pension / SIPP / LISA recommendations as advice.** Routed to a
  "speak to an FCA-authorised adviser" reminder.
- **Multi-user.** Single-user, single account holder's funds only.
- **Tax evasion.** Tax *efficiency* via legitimate wrappers only.
- **Intraday TA as a signal.** No RSI / MACD / stochastic / Bollinger /
  Fibonacci / golden-cross. Long-horizon momentum may surface as a
  *portfolio-level* tilt signal but never a single-name buy trigger.
- **Crypto exposure above caps.** Hard-gated by `cryptoCapPct` plus
  cash-buffer and toxic-debt preconditions.

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
| 12 Wealth Coach module              | 29  |
| 13 Default benchmark plan           | 11  |
| 14 Paper portfolio + decision journal | 16 |
| 15 Business cashflow engine         | 15  |
| 16 Debt triage                      |  9  |
| 17 Fee drag engine                  |  9  |
| 18 Behavioural risk                 | 13  |
| 19 Data quality                     | 14  |
| 20 Protection / insurance           | 10  |
| **MVP total**                       | **363** |

At 4–6 pts per focused day (solo dev, real life), the post-review MVP
lands in **13–16 weeks**. Foundations (Epics 0/7/12 done so far) gave
the disciplined spine; the new epics turn it into a wealth-owner OS
instead of a stock-research terminal.

Critical path (post-review):
F-001 → F-005 → WC-1201 → K-701/K-702 → BM-1301 (default plan) →
BC-1501..BC-1504 (business cashflow) → DT-1601..DT-1604 (debt) →
PP-1401..PP-1404 (paper portfolio) → I-101/I-105 (real-data ingest) →
DQ-1901..DQ-1904 (reconcile) → WC-1203 (next-3-actions) → W-1001 (weekly review).

Cut lines if time runs short, in order:
1. C-202 (LLM categoriser) — fall back to rules + manual.
2. I-105 (TrueLayer) — fall back to CSV.
3. O-503 (dividend filter) — keep O-501/O-502/O-504.
4. R-603 (research generator) — keep R-601/R-602/R-605 (data view only).
5. WC-1205 / WC-1208 — Coach without conversational thread or memory pinning is still useful.

## Done so far

| ID    | Story | Verified by |
|-------|-------|-------------|
| F-001 | Migrations 0001/0002/0003 apply cleanly (34 tables incl. business_obligations, debt_items, insurance_policies, fee_schedules, recovery_codes). | `pnpm db:migrate` + `pnpm db:check` |
| F-002 | Drizzle ORM connects, all expected tables present, audit_events writable. | `pnpm db:check` (11/11 green) |
| F-003 | Seed loads aggressive profile (post-review tighter caps), allocation, ISA year **2026/27**, categories, institutions. | `pnpm db:seed` + `pnpm db:check` |
| F-004 | Next.js 15 App Router + Tailwind shell with chrome (nav, sign-out, footer). | `pnpm build` (13 routes) |
| F-005 | Auth.js + Credentials (email/password) + TOTP 2FA + recovery codes + first-run setup. | curl-driven sign-in: 302 → session JSON → middleware-protected routes |
| K-701 | Deterministic risk evaluator. | `pnpm test` |
| K-702 | `submitProposedAction` wires evaluator into insert path; blocks never written; observer mode honoured. | `pnpm test` |
| K-706 | Sleep-mode rule baked into evaluator (UK timezone, DST-aware, midnight wrap). | `pnpm test` |
| K-RV1 | Post-review caps: portfolio-size aware single-position cap, speculative-until-buffer-healthy, crypto-requires-buffer, crypto-requires-no-toxic-debt, business-obligations-unpaid, business-reserve-floor. | `pnpm test` (50/50) |
| WC-1201 | Four-step onboarding wizard saving to canonical tables. | `/onboarding` → `/position` → `/cashflow` → `/goals` |
| WC-1202 | Deterministic playbook generator (markdown + ISA projection table). | `/playbook` renders the most recent `reports.kind='playbook'`. |
| BC/DT/PR | Business obligations, debt triage, protection — UI + wired into evaluator. | `/business` `/debt` `/protection`; live gates proven. |
| BM-1301/1302 | Default benchmark plan (waterfall + blended return) + comparator. | `/plan`; 10 tests. |
| PP-1401..1405 | Paper portfolio + decision journal + vs-benchmark. | `/paper`; 10 tests; open/mark/close proven live. |
