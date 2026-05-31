import { describe, it, expect } from 'vitest';
import { compareDebtsVsInvest, type DebtLike } from './debt-advice';

const cc: DebtLike = { name: 'Credit card', kind: 'credit_card', balanceGbp: 3000, aprPct: 0.219, secured: false, taxDeductible: false };
const lowMortgage: DebtLike = { name: 'Mortgage', kind: 'mortgage', balanceGbp: 200000, aprPct: 0.020, secured: true, taxDeductible: false };
const midLoan: DebtLike = { name: 'Personal loan', kind: 'personal_loan', balanceGbp: 8000, aprPct: 0.059, secured: false, taxDeductible: false };

describe('compareDebtsVsInvest', () => {
  it('says clear a 21.9% credit card before investing', () => {
    const [r] = compareDebtsVsInvest([cc], { assumedInvestReturnPct: 0.05 });
    expect(r!.verdict).toBe('clear_debt_first');
  });

  it('says invest before overpaying a 2% mortgage at 5% assumed return', () => {
    const [r] = compareDebtsVsInvest([lowMortgage], { assumedInvestReturnPct: 0.05 });
    // 2% vs 5% → 3pp below → invest_first
    expect(r!.verdict).toBe('invest_first');
  });

  it('leans towards clearing a 5.9% loan vs a 5% return', () => {
    const [r] = compareDebtsVsInvest([midLoan], { assumedInvestReturnPct: 0.05 });
    // 5.9% vs 5% → +0.9pp → lean_clear_debt
    expect(r!.verdict).toBe('lean_clear_debt');
  });

  it('sorts by effective rate, highest first', () => {
    const out = compareDebtsVsInvest([lowMortgage, cc, midLoan], { assumedInvestReturnPct: 0.05 });
    expect(out.map((r) => r.name)).toEqual(['Credit card', 'Personal loan', 'Mortgage']);
  });

  it('lowers effective rate for tax-deductible debt', () => {
    const deductible: DebtLike = { ...midLoan, taxDeductible: true };
    const [withTax] = compareDebtsVsInvest([deductible], { assumedInvestReturnPct: 0.05, marginalTaxRatePct: 0.40 });
    // 5.9% * (1 - 0.40) = 3.54% effective → 1.46pp below 5% → lean_invest
    expect(withTax!.effectiveRatePct).toBeCloseTo(0.0354, 4);
    expect(withTax!.verdict).toBe('lean_invest');
  });

  it('is deterministic', () => {
    const first = compareDebtsVsInvest([lowMortgage, cc, midLoan]);
    for (let i = 0; i < 20; i++) {
      expect(compareDebtsVsInvest([lowMortgage, cc, midLoan])).toEqual(first);
    }
  });
});
