// Portfolio Risk Dashboard — pure functions.
//
// No I/O, no random, no clock except where passed in. Drives the /risk page
// and feeds new signals into the evaluator. All money in GBP.

export interface PositionInput {
  /** Stable id (holding id). */
  id: string;
  /** Display label — ticker / ISIN / name. */
  label: string;
  /** Account name (for grouping). */
  accountName?: string;
  quantity: number;
  avgCostGbp: number;
  /** Latest market price; null if unpriced. */
  marketPrice: number | null;
  /** Free-form tags (etf / stock / cash / crypto / speculative / defensive / sector_*). */
  tags: string[];
}

export interface ValuedPosition extends PositionInput {
  bookValueGbp: number;
  marketValueGbp: number;
  /** True iff a market price was available (else MV falls back to book). */
  priced: boolean;
  unrealisedPnlGbp: number | null;
  unrealisedPnlPct: number | null;
  /** This position's share of the portfolio market value. 0..1. */
  weightPct: number;
}

export interface PortfolioValuation {
  totalMvGbp: number;
  totalBookGbp: number;
  totalUnrealisedPnlGbp: number;
  pricedCount: number;
  unpricedCount: number;
  positions: ValuedPosition[];      // sorted by weightPct desc
}

export function valuePortfolio(positions: PositionInput[]): PortfolioValuation {
  let totalMv = 0;
  let totalBook = 0;
  let priced = 0;
  let unpriced = 0;

  const intermediate = positions.map((p) => {
    const book = p.quantity * p.avgCostGbp;
    const hasPrice = p.marketPrice != null;
    const mv = hasPrice ? p.quantity * (p.marketPrice as number) : book;
    if (hasPrice) priced++; else unpriced++;
    totalBook += book;
    totalMv += mv;
    return { p, book, mv, hasPrice };
  });

  const valued: ValuedPosition[] = intermediate.map(({ p, book, mv, hasPrice }) => ({
    ...p,
    bookValueGbp: book,
    marketValueGbp: mv,
    priced: hasPrice,
    unrealisedPnlGbp: hasPrice ? mv - book : null,
    unrealisedPnlPct: hasPrice && book > 0 ? (mv - book) / book : null,
    weightPct: totalMv > 0 ? mv / totalMv : 0,
  })).sort((a, b) => b.weightPct - a.weightPct);

  const totalUnrealised = valued.reduce(
    (acc, v) => acc + (v.unrealisedPnlGbp ?? 0), 0,
  );

  return {
    totalMvGbp: totalMv,
    totalBookGbp: totalBook,
    totalUnrealisedPnlGbp: totalUnrealised,
    pricedCount: priced,
    unpricedCount: unpriced,
    positions: valued,
  };
}

// ── Concentration ────────────────────────────────────────────────────────

export interface ConcentrationBreach {
  positionId: string;
  label: string;
  weightPct: number;
  capPct: number;
  severity: 'warn' | 'block';
}

/**
 * Check every position vs the active risk profile's single-position cap.
 * Warn when in [0.9 * cap, cap], block when > cap. Returns sorted by severity.
 */
export function concentrationBreaches(
  positions: ValuedPosition[],
  cap: number,
): ConcentrationBreach[] {
  const out: ConcentrationBreach[] = [];
  for (const p of positions) {
    if (p.weightPct > cap) {
      out.push({ positionId: p.id, label: p.label, weightPct: p.weightPct, capPct: cap, severity: 'block' });
    } else if (p.weightPct > cap * 0.9) {
      out.push({ positionId: p.id, label: p.label, weightPct: p.weightPct, capPct: cap, severity: 'warn' });
    }
  }
  return out.sort((a, b) => (a.severity === b.severity ? b.weightPct - a.weightPct : a.severity === 'block' ? -1 : 1));
}

// ── Tag exposure ─────────────────────────────────────────────────────────

export interface TagExposure {
  tag: string;
  marketValueGbp: number;
  weightPct: number;
  positionCount: number;
}

const UNTAGGED = '_untagged';

/** Sum market value per tag. A position with multiple tags contributes to each;
 *  positions with no tags fall into the `_untagged` bucket. */
export function tagExposure(positions: ValuedPosition[]): TagExposure[] {
  const total = positions.reduce((acc, p) => acc + p.marketValueGbp, 0);
  const map = new Map<string, { mv: number; n: number }>();
  for (const p of positions) {
    const tags = p.tags.length > 0 ? p.tags : [UNTAGGED];
    for (const t of tags) {
      const cur = map.get(t) ?? { mv: 0, n: 0 };
      cur.mv += p.marketValueGbp;
      cur.n += 1;
      map.set(t, cur);
    }
  }
  const out: TagExposure[] = [];
  for (const [tag, v] of map) {
    out.push({
      tag,
      marketValueGbp: v.mv,
      weightPct: total > 0 ? v.mv / total : 0,
      positionCount: v.n,
    });
  }
  return out.sort((a, b) => b.marketValueGbp - a.marketValueGbp);
}

// ── Drawdown ─────────────────────────────────────────────────────────────

export interface SnapshotInput {
  ts: Date;
  totalMvGbp: number;
}

export interface DrawdownResult {
  highWaterMarkGbp: number;
  currentMvGbp: number;
  drawdownPct: number;          // 0..1 (positive number = % below HWM)
  daysSinceHwm: number;         // days since the HWM was reached
}

/**
 * Compute the running high-water mark and the latest drawdown.
 * If there's a current MV (passed as the last snapshot), it's used; otherwise
 * the most recent snapshot is treated as current.
 */
export function computeDrawdown(snapshots: SnapshotInput[]): DrawdownResult | null {
  if (snapshots.length === 0) return null;
  const sorted = [...snapshots].sort((a, b) => a.ts.getTime() - b.ts.getTime());
  let hwm = -Infinity;
  let hwmAt = sorted[0]!.ts;
  for (const s of sorted) {
    if (s.totalMvGbp > hwm) {
      hwm = s.totalMvGbp;
      hwmAt = s.ts;
    }
  }
  const last = sorted[sorted.length - 1]!;
  const drawdown = hwm > 0 ? Math.max(0, (hwm - last.totalMvGbp) / hwm) : 0;
  const daysSinceHwm = Math.max(0, Math.floor((last.ts.getTime() - hwmAt.getTime()) / 86_400_000));
  return {
    highWaterMarkGbp: hwm,
    currentMvGbp: last.totalMvGbp,
    drawdownPct: drawdown,
    daysSinceHwm,
  };
}

// ── Top-level risk status ────────────────────────────────────────────────

export type RiskBannerStatus = 'clear' | 'caution' | 'blocked';

export interface RiskStatusInput {
  concentrationBreaches: ConcentrationBreach[];
  drawdownPct: number;
  drawdownCautionPct: number;
  drawdownBlockPct: number;
  // Wider balance-sheet signals (mirrored from FinanceSnapshot):
  cashBufferGbp: number;
  cashFloorGbp: number;
  toxicDebtCount: number;
  businessObligationsDue90dGbp: number;
  businessCashGbp: number;
}

export interface RiskStatus {
  status: RiskBannerStatus;
  /** One-line headline summarising why the status is what it is. */
  headline: string;
  /** Specific reasons (severity-tagged). */
  reasons: Array<{ severity: 'warn' | 'block'; rule: string; message: string }>;
}

export function computeRiskStatus(i: RiskStatusInput): RiskStatus {
  const reasons: RiskStatus['reasons'] = [];

  // Blocked-severity rules.
  if (i.drawdownPct >= i.drawdownBlockPct) {
    reasons.push({
      severity: 'block',
      rule: 'drawdown_block',
      message: `Portfolio drawdown ${(i.drawdownPct * 100).toFixed(1)}% has hit the ${(i.drawdownBlockPct * 100).toFixed(0)}% block threshold. New risk-taking is frozen.`,
    });
  }
  if (i.businessObligationsDue90dGbp > i.businessCashGbp && i.businessObligationsDue90dGbp > 0) {
    reasons.push({
      severity: 'block',
      rule: 'business_obligations_unpaid',
      message: `Business obligations due in 90d (£${i.businessObligationsDue90dGbp.toFixed(0)}) exceed business cash (£${i.businessCashGbp.toFixed(0)}).`,
    });
  }
  if (i.cashFloorGbp > 0 && i.cashBufferGbp < i.cashFloorGbp) {
    reasons.push({
      severity: 'block',
      rule: 'cash_floor',
      message: `Personal cash buffer £${i.cashBufferGbp.toFixed(0)} is below the £${i.cashFloorGbp.toFixed(0)} floor.`,
    });
  }
  for (const c of i.concentrationBreaches.filter((b) => b.severity === 'block')) {
    reasons.push({
      severity: 'block',
      rule: 'concentration',
      message: `${c.label} is ${(c.weightPct * 100).toFixed(1)}% of the portfolio (cap ${(c.capPct * 100).toFixed(0)}%).`,
    });
  }

  // Warn-severity rules.
  if (i.drawdownPct >= i.drawdownCautionPct && i.drawdownPct < i.drawdownBlockPct) {
    reasons.push({
      severity: 'warn',
      rule: 'drawdown_caution',
      message: `Portfolio drawdown ${(i.drawdownPct * 100).toFixed(1)}% is above the ${(i.drawdownCautionPct * 100).toFixed(0)}% caution threshold.`,
    });
  }
  if (i.toxicDebtCount > 0) {
    reasons.push({
      severity: 'warn',
      rule: 'toxic_debt',
      message: `${i.toxicDebtCount} debt${i.toxicDebtCount === 1 ? '' : 's'} above 6% APR — clearing them is a guaranteed return.`,
    });
  }
  for (const c of i.concentrationBreaches.filter((b) => b.severity === 'warn')) {
    reasons.push({
      severity: 'warn',
      rule: 'concentration_warn',
      message: `${c.label} is approaching the cap (${(c.weightPct * 100).toFixed(1)}% vs ${(c.capPct * 100).toFixed(0)}%).`,
    });
  }

  const hasBlock = reasons.some((r) => r.severity === 'block');
  const hasWarn = reasons.some((r) => r.severity === 'warn');
  const status: RiskBannerStatus = hasBlock ? 'blocked' : hasWarn ? 'caution' : 'clear';

  let headline: string;
  if (status === 'blocked') {
    headline = 'Risk-up frozen — resolve the blocking issues before taking on more risk.';
  } else if (status === 'caution') {
    headline = 'Proceed with discipline — caution-level signals are active.';
  } else {
    headline = 'All clear — portfolio risk is within profile bounds.';
  }

  return { status, headline, reasons };
}
