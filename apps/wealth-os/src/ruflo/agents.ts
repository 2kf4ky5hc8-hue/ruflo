// Agent registry — names match the yaml definitions under
// v3/@claude-flow/agents/wealth-*.yaml. The registry is consulted whenever
// wealth-os spawns an agent run, ensuring runtime behaviour matches the
// declared capabilities and restrictions.

export type WealthAgentName =
  | 'wealth-cashflow'
  | 'wealth-isa'
  | 'wealth-portfolio-research'
  | 'wealth-risk-manager'
  | 'wealth-opportunity-scanner'
  | 'wealth-tax-wrapper'
  | 'wealth-business-cashflow'
  | 'wealth-trade-drafting'
  | 'wealth-compliance-guardrail'
  | 'wealth-coach';

export interface AgentMeta {
  name: WealthAgentName;
  yamlPath: string;
  model: 'haiku' | 'sonnet' | 'opus';   // 3-tier routing (CLAUDE.md ADR-026)
  maxBudgetUsd: number;
  requiresGuardrail: boolean;           // run output through guardrail before persist
  emitsProposedActions: boolean;
}

export const wealthAgents: Record<WealthAgentName, AgentMeta> = {
  'wealth-cashflow':            { name: 'wealth-cashflow',            yamlPath: 'v3/@claude-flow/agents/wealth-cashflow.yaml',            model: 'haiku',  maxBudgetUsd: 0.10, requiresGuardrail: true,  emitsProposedActions: true  },
  'wealth-isa':                 { name: 'wealth-isa',                 yamlPath: 'v3/@claude-flow/agents/wealth-isa.yaml',                 model: 'haiku',  maxBudgetUsd: 0.05, requiresGuardrail: true,  emitsProposedActions: true  },
  'wealth-portfolio-research':  { name: 'wealth-portfolio-research',  yamlPath: 'v3/@claude-flow/agents/wealth-portfolio-research.yaml',  model: 'sonnet', maxBudgetUsd: 0.50, requiresGuardrail: true,  emitsProposedActions: false },
  'wealth-risk-manager':        { name: 'wealth-risk-manager',        yamlPath: 'v3/@claude-flow/agents/wealth-risk-manager.yaml',        model: 'haiku',  maxBudgetUsd: 0.02, requiresGuardrail: false, emitsProposedActions: false },
  'wealth-opportunity-scanner': { name: 'wealth-opportunity-scanner', yamlPath: 'v3/@claude-flow/agents/wealth-opportunity-scanner.yaml', model: 'sonnet', maxBudgetUsd: 0.20, requiresGuardrail: true,  emitsProposedActions: true  },
  'wealth-tax-wrapper':         { name: 'wealth-tax-wrapper',         yamlPath: 'v3/@claude-flow/agents/wealth-tax-wrapper.yaml',         model: 'sonnet', maxBudgetUsd: 0.10, requiresGuardrail: true,  emitsProposedActions: true  },
  'wealth-business-cashflow':   { name: 'wealth-business-cashflow',   yamlPath: 'v3/@claude-flow/agents/wealth-business-cashflow.yaml',   model: 'haiku',  maxBudgetUsd: 0.10, requiresGuardrail: true,  emitsProposedActions: true  },
  'wealth-trade-drafting':      { name: 'wealth-trade-drafting',      yamlPath: 'v3/@claude-flow/agents/wealth-trade-drafting.yaml',      model: 'sonnet', maxBudgetUsd: 0.05, requiresGuardrail: true,  emitsProposedActions: true  },
  'wealth-compliance-guardrail':{ name: 'wealth-compliance-guardrail',yamlPath: 'v3/@claude-flow/agents/wealth-compliance-guardrail.yaml',model: 'haiku',  maxBudgetUsd: 0.01, requiresGuardrail: false, emitsProposedActions: false },
  'wealth-coach':               { name: 'wealth-coach',               yamlPath: 'v3/@claude-flow/agents/wealth-coach.yaml',               model: 'sonnet', maxBudgetUsd: 1.00, requiresGuardrail: true,  emitsProposedActions: false },
};

export interface AgentRunRequest {
  agent: WealthAgentName;
  userId: string;
  input: Record<string, unknown>;
}

export interface AgentRunResult {
  ok: boolean;
  output?: unknown;
  error?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

// Coordinator: bridges to ruflo's Task tool / swarm orchestrator at runtime.
// Until the orchestrator is wired in, this returns a structured stub so call
// sites compile and integration tests can be written against the contract.
export async function runWealthAgent(req: AgentRunRequest): Promise<AgentRunResult> {
  const meta = wealthAgents[req.agent];
  if (!meta) {
    return { ok: false, error: `unknown agent ${req.agent}` };
  }
  // Real implementation:
  //   1. Look up @claude-flow/agents handler for `meta.name`
  //   2. Apply 3-tier routing (Agent Booster? Haiku? Sonnet?) per ADR-026
  //   3. Spawn via Task tool with budget cap = meta.maxBudgetUsd
  //   4. If meta.requiresGuardrail, pipe output through wealth-compliance-guardrail
  //   5. If meta.emitsProposedActions, validate via security.ProposedActionInput
  //   6. Persist agent_runs row, plus any downstream rows
  return {
    ok: true,
    output: { stub: true, agent: req.agent, note: 'wire to @claude-flow agent runner' },
    costUsd: 0,
  };
}
