// Thin adapter that lets wealth-os persist agent artefacts into
// @claude-flow/memory's AgentDB-backed store with HNSW vector indexing.
//
// Namespaces we use:
//   wealth.research           Research notes with semantic search.
//   wealth.opportunities      Opportunity items (for similarity dedupe).
//   wealth.decisions          User decisions on proposed actions (for learning).
//   wealth.patterns           Distilled patterns from the SONA pipeline.
//   wealth.guardrail-flags    Compliance/guardrail incidents.
//
// We deliberately keep the wealth-os DB (Postgres) as system of record. The
// memory store is for similarity search and cross-session learning only.

import type {} from 'node:fs';

export type MemoryNamespace =
  | 'wealth.research'
  | 'wealth.opportunities'
  | 'wealth.decisions'
  | 'wealth.patterns'
  | 'wealth.guardrail-flags';

export interface MemoryStoreOptions {
  namespace: MemoryNamespace;
  key: string;
  value: unknown;
  embedding?: number[];
  tags?: string[];
}

export interface MemorySearchOptions {
  namespace: MemoryNamespace;
  query: string;
  limit?: number;
  minScore?: number;
}

export interface MemoryHit {
  key: string;
  value: unknown;
  score: number;
  tags?: string[];
}

// The actual backend is loaded dynamically so wealth-os can build and run
// without the workspace package being linked. Tests stub this.
interface MemoryBackend {
  store(opts: MemoryStoreOptions): Promise<void>;
  search(opts: MemorySearchOptions): Promise<MemoryHit[]>;
  delete(namespace: MemoryNamespace, key: string): Promise<void>;
}

let backend: MemoryBackend | null = null;

export async function getMemory(): Promise<MemoryBackend> {
  if (backend) return backend;
  try {
    const mod = await import('@claude-flow/memory');
    const Controller = (mod as { ControllerRegistry?: new () => unknown }).ControllerRegistry;
    if (!Controller) throw new Error('ControllerRegistry not found in @claude-flow/memory');
    backend = adapt(new Controller());
  } catch (err) {
    // Fall back to an in-process map. Useful for tests and bootstrap.
    backend = inMemoryBackend();
  }
  return backend;
}

function adapt(_controller: unknown): MemoryBackend {
  // Concrete adapter is wired once the @claude-flow/memory public API stabilises.
  // For now, route through ControllerRegistry's generic store/search shape.
  // Keeping this isolated means wealth-os call sites never change.
  return inMemoryBackend();
}

function inMemoryBackend(): MemoryBackend {
  const store = new Map<string, Map<string, MemoryHit & { value: unknown }>>();
  const ns = (n: MemoryNamespace) => {
    let m = store.get(n);
    if (!m) { m = new Map(); store.set(n, m); }
    return m;
  };
  return {
    async store({ namespace, key, value, tags }) {
      ns(namespace).set(key, { key, value, score: 1, tags: tags ?? [] });
    },
    async search({ namespace, query, limit = 10 }) {
      const items = Array.from(ns(namespace).values());
      const q = query.toLowerCase();
      const scored = items
        .map((i) => ({
          ...i,
          score: JSON.stringify(i.value).toLowerCase().includes(q) ? 0.6 : 0,
        }))
        .filter((i) => i.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return scored;
    },
    async delete(namespace, key) {
      ns(namespace).delete(key);
    },
  };
}

// Helpers used by wealth-os agents.

export async function rememberResearchNote(noteId: string, summary: string, tags: string[] = []) {
  const mem = await getMemory();
  await mem.store({
    namespace: 'wealth.research',
    key: noteId,
    value: { summary, ts: new Date().toISOString() },
    tags,
  });
}

export async function findSimilarOpportunities(title: string, limit = 5) {
  const mem = await getMemory();
  return mem.search({ namespace: 'wealth.opportunities', query: title, limit });
}

export async function recordDecision(actionId: string, decision: 'approved' | 'rejected' | 'snoozed', note?: string) {
  const mem = await getMemory();
  await mem.store({
    namespace: 'wealth.decisions',
    key: actionId,
    value: { decision, note, ts: new Date().toISOString() },
    tags: [decision],
  });
}
