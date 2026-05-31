# Ruflo Wealth OS — handover for external review

> **You are reviewing this cold.** No prior context. Read this file end to end,
> then do a sanity check on whether the design will actually work for a UK
> retail user who wants to compound capital responsibly over years — *not* day-
> trade. Specifically pressure-test the indicator / signal layer (section 6).

Branch: `claude/wealth-management-system-wbKsI`
Last commit at time of writing: `cea0041`
Stack: TypeScript, Next.js 15 (App Router), Postgres 16, Drizzle ORM, Auth.js v5, Tailwind, Vitest.
Code lives in `apps/wealth-os/`.

---

## 1. What this product is

A single-user personal wealth operating system for a UK resident. The owner is
a business owner who wants to compound modest contributions (a few hundred
pounds a month at the start, scaling later) across a Stocks & Shares ISA,
cash buffers, business reinvestment, and over time other wrappers.

**Default operating posture is *observe → analyse → recommend → human approves*.**
No autonomous trade execution unless the user explicitly unlocks it per
capability per session. The system is decision-support software and explicitly
not regulated financial advice — disclaimers are appended on every
recommendation and surfaced in the footer.

**Operating modes** are per-module, not global:
| Mode | Effect |
|---|---|
| Observer | Read-only, alerts only, no proposals written. Kill switch via `WEALTH_MODE=observer`. |
| Advisor *(default)* | Generates ranked proposals, never executes. |
| Assisted Live | Executes a proposal only after explicit human approval, only on platforms that legally support it. |
| High-Risk Unlock | Separately gated layer that enables CFDs/options/spread-bet/crypto analysis. Off by default, re-confirmed every 30 days. |

---

## 2. What is built and proven

Everything in this section is verified end-to-end in this branch.

### 2.1 Database (30 tables)

Files: `apps/wealth-os/src/db/schema/*.ts` (Drizzle), `apps/wealth-os/src/db/migrations/000{1,2}_*.sql`.

Domains:
- **Identity**: users, sessions, audit_events, recovery_codes
- **Accounts**: institutions, connections, accounts (cash / ISA / GIA / SIPP / mortgage / credit / business / property / debt / crypto)
- **Ledger**: categories, category_rules, transactions
- **Holdings & market data**: instruments, holdings, lots, corporate_actions, prices, fundamentals
- **ISA tracking**: isa_years, isa_deposits
- **Business**: businesses, business_metrics
- **Operations**: risk_profiles, risk_breaches, allocation_rules, spare_cash_events, opportunities, research_notes, proposed_actions, goals, reports, agent_runs

Money is always `numeric(20,4)` in account currency. Never floats. All timestamps UTC tz-aware. Audit events on mutations. `pnpm db:check` runs an 11-step structured verification that all 30 tables exist, the auth columns are on `users`, the seed user has the aggressive risk profile active, the ISA year is seeded at £20,000, and `audit_events` is writable.

### 2.2 Risk evaluator (K-701, K-702, K-706)

File: `apps/wealth-os/src/risk/evaluator.ts` (≈400 lines), tests in
`evaluator.test.ts` (24 tests), service layer in
`apps/wealth-os/src/services/submit-proposed-action.ts` (5 integration tests
against a live Postgres).

**This is a pure function.** No I/O, no clock except an optional `context.now`,
no LLM. Same input → same output across 50 calls (asserted in test).

It enforces, per the active `risk_profile`:
- Max single position (skipped when asset class is `cash`)
- Max speculative exposure (smallcap, thematic, EM, high-yield, commodity, crypto, derivative)
- Crypto cap
- Cash floor in months of essential expenses (skipped for paper trades)
- ISA allowance (block + suggest "switch wrapper to GIA")
- Leverage / options gating (block unless explicitly allowed)
- Always-approval gate for crypto and derivatives
- High-risk class gate for any adding-to-position action
- 90-day new-instrument size cap
- UK sleep-mode window (DST-aware via `Intl.DateTimeFormat`, handles midnight wrap)

Outputs: `{ allowed, blocked, requiresApproval, riskScore (0-10), reasons[], warnings[], breachedRules[], suggestedAdjustment, suggestedSaferAlternative }`.

**Wired into the insert path**: `submitProposedAction` loads the active risk
profile from the DB, runs the evaluator, and *refuses to write* any
block-severity outcome. The evaluation payload (warnings, breached rules,
suggested adjustment, alternative) is attached to the row when allowed.
Honours `WEALTH_MODE=observer` (evaluator still runs, nothing persisted).

### 2.3 Auth (F-005)

Edge/Node split:
- `lib/auth.config.ts` — Edge-safe (used by middleware): JWT strategy, 8h sessions, `/login` page.
- `lib/auth.ts` — Node-only: Credentials provider, bcrypt, AES-256-GCM TOTP secret decryption.

First-run flow at `/setup`:
1. Password (12+ chars, bcrypt cost 12).
2. TOTP enrolment with QR (otpauth + qrcode), code verified with ±1 step drift.
3. 10 single-use recovery codes generated and stored hashed (SHA-256).

Sign-in writes an `audit_events` row. Middleware redirects unauth'd routes to
`/login?next=<original>`.

### 2.4 Onboarding wizard (WC-1201)

`apps/wealth-os/src/app/onboarding/{page,position,cashflow,goals}/page.tsx`.

1. Profile + risk profile (re-activates matching `risk_profiles` and `allocation_rules` rows).
2. Current position: cash, ISA balance, GIA, pension, business cash, total debt, ISA deposited this tax year. Writes one transaction per account tagged `source='onboarding'` so re-running is idempotent.
3. Monthly income + monthly essential expenses → `users.monthly_income_gbp`, `users.monthly_expenses_gbp`.
4. Up to six goals → `goals` table.

Marks `users.onboarded_at` and triggers playbook generation.

### 2.5 Deterministic playbook generator (WC-1202)

File: `apps/wealth-os/src/services/playbook.ts`. **Pure function over the
FinanceSnapshot** — no LLM. Renders a 6-month markdown plan with sections for:
emergency-fund gap (front-loaded if short), ISA-this-tax-year contribution
plan, higher-risk + opportunity sleeves, debt, business reinvestment, the
top goal's linear trajectory, and an ISA projection table at 3 / 5 / 7 / 10%.

Stored in `reports.kind='playbook'`. Rendered at `/playbook` with a small
inline markdown renderer (no third-party). Regenerate button writes a new row;
old rows kept for history.

### 2.6 Dashboard

Six cards driven by `loadSnapshot()` (`lib/finance.ts`): net worth, cash
position with months-of-expenses buffer, ISA allowance progress, "this week's
moves" (pending proposed actions), goals progress bars, risk profile summary,
allocation summary, monthly cashflow summary.

### 2.7 Tooling

```
pnpm db:up          # docker-first, falls back to system Postgres cluster
pnpm db:reset       # drop + recreate the database, apply all migrations
pnpm db:migrate     # apply migrations only (idempotent against an existing DB? no)
pnpm db:seed        # load tax rules, three risk profiles, allocation rules, ISA year
pnpm db:check       # 11-step verifier
pnpm db:bootstrap   # up + reset + seed + check (one-shot for fresh machines)
pnpm db:ensure      # idempotent role + database provisioning (handles macOS+brew)
pnpm test           # vitest — 43/43 green at last commit
pnpm typecheck      # clean at last commit
pnpm build          # 13 routes compile clean
pnpm dev            # zero env vars needed; safe dev defaults baked in
```

`scripts/db.sh` auto-provisions the Postgres role + database. It tries in
order: already-works → current OS user is a Postgres superuser (brew on
macOS) → sudo → root → prints the manual `createuser`/`createdb` commands.

`lib/env.ts` falls back to a stable dev default for `AUTH_SECRET` and
`TOTP_ENC_KEY`. Production (`NODE_ENV=production`) refuses to boot with
placeholders or any secret shorter than 32 chars.

---

## 3. What is designed but not yet built

These have *placeholders* in the schema and the agent registry (`src/ruflo/agents.ts`) but no working implementation.

| Capability | Schema in place | Implementation |
|---|---|---|
| Ingestion (TrueLayer Open Banking, CSV importers per broker, transfer-pair detection, ML categoriser) | yes (`connections`, `transactions`, `category_rules`) | none |
| Holdings sync (instrument lookup, price fetcher, fundamentals snapshot) | yes (`instruments`, `holdings`, `lots`, `prices`, `fundamentals`) | none |
| Opportunity scanner (stocks / ETFs / dividends / savings rates / cashback / grants) | yes (`opportunities`) | none |
| Research note generator (LLM-backed) | yes (`research_notes`) | none |
| Daily breach scan (K-703) | yes (`risk_breaches`) | deferred per user instruction |
| Cooling-off enforcement + session revoke (K-705) | yes (`sessions`) | deferred per user instruction |
| Weekly Wealth Review (Sunday 18:00 UK email) | yes (`reports`) | none |
| Approval Centre actions (approve / reject / snooze write paths) | yes (`proposed_actions.status`) | read-only listing only |
| Agent runtime (LLM calls, tool use, guardrail validation) | yes (`agent_runs`) | thin shell exists; no real agent invocations |

---

## 4. Architectural decisions worth pressure-testing

### 4.1 UK regulatory posture
We are NOT seeking FCA authorisation. The system is single-user, manages only
the owner's own money, and frames every output as decision-support. We append a
fixed disclaimer to recommendations and route pension / SIPP / LISA changes
through a "speak to an FCA-authorised adviser" reminder.

**Is this the right line?** We have not formally taken legal advice. If the
reviewer thinks any of the planned modules (LISA modelling, business
dividend-vs-salary modelling, opportunity ranking) starts to look like
*arranging deals in investments* or *giving personal recommendations* under
COBS, flag it.

### 4.2 Tax rules as versioned data, not code
`apps/wealth-os/config/tax-rules.yaml` has the ISA allowance (£20k), dividend
allowance (£500), CGT annual exempt (£3k), income tax bands, NI rates, corp
tax rates, pension annual allowance. Reminder calendar entries are embedded.

**The reviewer should sanity-check these numbers against gov.uk for the
2025/26 tax year** and flag anything that's wrong or stale. The intent is
versioned YAML updated every Budget, with a `version` string that
`research_notes`-style outputs cite.

### 4.3 Risk profile defaults
The user picked **Aggressive** for themselves. Caps (`config/risk-profiles.yaml`):
- Max single position: 12%
- Max speculative (smallcap, thematic, EM, HY bond, commodity, crypto, derivative): 20%
- Crypto cap: 5%
- Cash floor: 2 months of essential expenses
- Sleep window: 23:30–06:00 UK
- New-instrument cap: 6% (first 90 days)

**Is "aggressive but disciplined" the right posture for someone starting with
hundreds, not tens of thousands?** The cash floor in particular is thin for
someone with business-owner irregular income. Worth a critique.

### 4.4 Allocation preset (aggressive)
Spare-cash split (`weights`):
- Emergency fund 10%
- ISA 35%
- Higher risk 20%
- Debt 5%
- Business reinvestment 20%
- Education 5%
- Opportunity 5%

This is what drives `spare_cash_events` → `proposed_action` rows. **Does the
breakdown make sense for a UK Ltd-director business owner trying to compound
through an ISA while keeping the business funded?** Particularly the
debt-payoff weight when the user has a mortgage.

### 4.5 ISA wrapper logic
- Recognises the post-6-April-2024 rule allowing multiple ISAs of the same type.
- Flexible-ISA replacement is in the schema (`isa_deposits` references the source transaction) but the recompute logic for "withdrew £X, replaced £Y in same tax year" is **not implemented**.
- ISA-eligibility check against the configured `eligible_investments` list (`uk_listed_shares`, `eea_listed_shares`, `aim_listed_shares`, `oeic_units`, `investment_trusts`, gilts, corp bonds with >5y remaining, REITs, cash) is **not yet wired into research notes**.

Flag anything we have wrong about post-2024 rules, or about what counts as ISA-eligible.

### 4.6 Integration realism (Open Banking + UK ISA platforms)

- **Open Banking**: planned via TrueLayer (AISP scope, read-only, 90-day reconsent). Tink / Plaid UK / Yapily are alternatives behind a `Provider` interface.
- **UK ISA platforms**: HL, AJ Bell, Vanguard UK, Trading 212, Freetrade, InvestEngine, Fidelity UK — **none expose retail execution APIs to third parties**. Trading 212 has a limited surface. Interactive Brokers can host an ISA via partners. Plan is therefore CSV / PDF statement import + contract-note email parsing as primary, never broker-level write access.
- **No screen-scraping.** Breaches T&Cs and is fragile.

**Question for the reviewer**: any UK ISA platform we're missing that *does*
expose a clean read or write API for a personal-finance tool? Anything we've
got wrong about TrueLayer vs Tink vs Yapily for this scope?

### 4.7 LLM usage policy (when we get to agents)
Planned policy:
- Three-tier model routing: Haiku for classification + per-rule explanations, Sonnet for research notes and Coach synthesis, Opus reserved for genuinely hard portfolio-level reasoning.
- **All numeric claims in LLM outputs must cite a `source_id` resolvable to a `fundamentals` / `price` / `news` row.** Guardrail rejects outputs that fail this check.
- PII redactor (sort codes, account numbers, IBAN, NI number, UTR, card PAN, postcode, email) runs before every prompt.
- Banned phrases ("guaranteed return", "risk-free", "can't lose", "sure thing", "insider tip/info", "pump", "get rich quick", "zero risk") trigger guardrail rejection. Implemented and tested (`src/ruflo/security.test.ts`).
- Disclaimer required on any output that goes to the user.

We have not yet invoked an LLM anywhere. The plumbing exists; the calls
don't. This is intentional — wanted the deterministic spine in first.

---

## 5. What this system explicitly does NOT do

The user has been clear about these. The reviewer should call out anything
that's drifting toward them.

- Not a day-trading or short-term-momentum tool.
- Not a CFD / options / spread-bet / leverage product. Those are behind a
  separate "High-Risk Unlock" that has to be re-confirmed every 30 days.
- Not a "buy this now" alert system. Every proposal goes through the Approval
  Centre with the bear case populated.
- Not a multi-user product. Single-user, single account holder's funds only.
- Not a tax-evasion tool. Tax *efficiency* via legitimate wrappers only.
- Not a regulated-advice tool. Pension / SIPP / LISA touches always route
  through a "speak to an adviser" reminder.

---

## 6. The signal / indicator layer — review this most carefully

**This is the question the user explicitly wants you to pressure-test.** We
have *not* yet implemented the opportunity scanner or research generator.
What follows is the planned indicator stack. The user's concern, in their
words: *not like RSI indicators, like proper good indicators.* That is the
right instinct for a multi-year compounding tool. Validate or replace.

### 6.1 What we plan to USE

For long-horizon equity selection (the ISA + GIA core):
- **Valuation**: P/E, P/B, P/S, EV/EBIT, EV/EBITDA, P/FCF — both absolute and relative to the stock's own 10y history and to a peer median. Reject any single-multiple decision.
- **Quality**: ROIC ≥ cost of capital sustained over 5-10y, gross margin stability, FCF / net income conversion ≥ 0.8, interest coverage, net debt / EBITDA.
- **Growth durability**: 5y and 10y revenue CAGR, 5y FCF CAGR, customer concentration where disclosed, gross retention for SaaS.
- **Income (for income sleeves)**: dividend yield, payout ratio < 0.8, dividend growth streak in years, FCF cover of the dividend, special vs ordinary split.
- **Risk**: rolling 3y max drawdown, downside deviation, beta to FTSE All-Share, currency exposure of underlying earnings vs reporting currency.

Portfolio-level signals:
- **Concentration**: HHI across positions, sector exposure, single-country, single-currency. Drives the rebalance proposals.
- **Factor exposures**: tilts to size / value / quality / low-vol via the FF/Carhart factors run against the portfolio.
- **Tracking error** against the user's stated target allocation.
- **Tax-utilisation**: % of ISA allowance used to date, % of dividend allowance consumed, CGT headroom remaining this tax year.

Macro / regime signals (light touch — not a market-timing tool):
- UK 10y gilt real yield trend
- US 10y - 3m yield curve (regime flag, not a trade trigger)
- Investment-grade credit spreads
- GBP TWI for currency-hedge sizing

Personal-finance signals (the actual core of the Coach):
- Savings rate trend (monthly income − essential expenses) / income, 3-month rolling.
- Cash buffer in months of essential expenses vs the profile floor.
- Spare-cash detector: balance above 1.1× emergency fund floor for ≥ 7 days.
- ISA-deadline urgency: days to 5 April × (allowance remaining / allowance).
- Goal trajectory: required monthly contribution to hit each goal at 3/5/7/10% real, vs the user's actual current contribution rate.

### 6.2 What we plan NOT to use as buy/sell triggers

These are either wrong-horizon (intraday/swing rather than multi-year), have
weak academic backing for retail single-stock decisions, or both:
- RSI, stochastic, MACD as trigger primitives.
- Bollinger bands as a buy/sell signal.
- Fibonacci retracements.
- Volume-weighted moving-average crossovers.
- "Golden cross / death cross" headlines.
- Pump signals from social media velocity (sentiment is contextual only).

We may surface long-horizon (12-month minus most-recent-month) price momentum
as a portfolio-level tilt signal — it has reasonable academic backing — but
not as a single-name buy trigger.

### 6.3 What we want the reviewer to do here

1. Sanity-check the indicator list above for a UK retail compounding context
   over a 5-30 year horizon.
2. Call out anything missing that materially helps a disciplined wealth
   builder (we suspect we're light on bond / fixed-income signals and on
   currency-hedging logic).
3. Call out anything in 6.1 that's actually noise dressed up as a signal.
4. Flag any decisions we're making (caps, defaults, allocation weights) that
   don't survive contact with a real portfolio.
5. Say explicitly whether "no RSI / no intraday TA" is the right line, or
   whether we're over-correcting.

---

## 7. Approval Centre semantics

A `proposed_action` row is the only thing the user acts on. Every agent or
job that wants the user's attention must go through `submitProposedAction`.

Statuses: `pending` → `{ approved | rejected | snoozed | expired }`. Default
expiry 7 days. Decision writes `decided_at`, `decided_by`, `decision_note`.

For MVP, "approve" does **not** execute anything externally. It records
intent + the outcome later. Live execution arrives only when (a) the broker
exposes an API the user has explicitly opted into, and (b) the action is in
Assisted Live mode, and (c) the action passes a *second* risk-evaluator call
at execution time (not just at proposal time).

**Question for the reviewer**: is the proposal → approval → record-outcome
loop enough for the user to learn what's working without execution? Or do we
need a "paper portfolio" surface (simulated execution + mark-to-market) to
actually close that loop?

---

## 8. Files to read first

In order:
1. `docs/wealth-os/mvp-backlog.md` — full backlog with story points, status, cut lines, critical path.
2. `apps/wealth-os/src/db/schema/{identity,finance,operations}.ts` — full data model.
3. `apps/wealth-os/src/risk/types.ts` and `evaluator.ts` — risk semantics.
4. `apps/wealth-os/src/services/submit-proposed-action.ts` — the choke point everything flows through.
5. `apps/wealth-os/config/{tax-rules,risk-profiles}.yaml` — the values we'd change every Budget.
6. `apps/wealth-os/src/services/playbook.ts` — what we surface to the user.
7. `apps/wealth-os/src/ruflo/agents.ts` — the 10 planned agents (not invoked yet).

---

## 9. How to run it locally

macOS:
```
brew install node pnpm postgresql@16
brew services start postgresql@16
git clone <your repo URL> ruflo
cd ruflo/apps/wealth-os
pnpm install --ignore-workspace
pnpm db:bootstrap
pnpm dev
```

Open <http://localhost:3000>. First-run walks you through `/setup` → `/login`
→ `/onboarding` (4 steps) → `/playbook` → `/dashboard`.

---

## 10. Direct questions for the reviewer

Please answer these explicitly. Yes / no / "depends, because …" is fine.

1. **Indicator stack (section 6).** Is the "no RSI, valuation + quality + growth + risk + portfolio-level concentration + macro regime" stance correct for a multi-year compounding tool? What's missing? What's noise?
2. **Risk caps (section 4.3).** Are 12% single position, 20% speculative, 5% crypto, 2-month cash floor sensible for an aggressive UK retail profile starting small and scaling? Where would you push back?
3. **Allocation preset (section 4.4).** Does the 10/35/20/5/20/5/5 split (emergency/ISA/higher-risk/debt/business/education/opportunity) work for a Ltd-director business owner with a mortgage and a long ISA runway?
4. **Tax rules (section 4.2).** Sanity-check `config/tax-rules.yaml` against gov.uk for 2025/26. Anything wrong or stale?
5. **ISA logic (section 4.5).** Are we right about post-6-April-2024 multiple-same-type ISAs? What does the flexible-ISA replacement logic need to handle that we haven't?
6. **Integration realism (section 4.6).** Anything wrong about the "no UK retail execution APIs, CSV-first" stance? Any platform we should add to the import adapter list?
7. **LLM policy (section 4.7).** Is "every numeric claim must cite a source row, guardrail rejects otherwise" enough, or do we need stronger constraints?
8. **Regulatory posture (section 4.1).** Are we drifting toward anything that needs FCA authorisation? Where's the line?
9. **Approval semantics (section 7).** Do we need a paper-portfolio surface before the first real broker integration?
10. **What's missing entirely.** What capability would you expect in a "powerful personal wealth management system" that we haven't even put in the backlog?

Reply directly against these section numbers. Concrete pushback is more
useful than directional praise.
