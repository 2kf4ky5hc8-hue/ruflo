import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import type { JobAssignment, Profile } from '../lib/types';

export function Assignments({
  jobId,
  profiles,
  canManage,
  profileName,
}: {
  jobId: string;
  profiles: Profile[];
  canManage: boolean;
  profileName: (id: string | null) => string;
}) {
  const { session } = useAuth();
  const [rows, setRows] = useState<JobAssignment[]>([]);
  const [pick, setPick] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('job_assignments')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true });
    setRows((data as JobAssignment[]) ?? []);
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    if (!pick) return;
    setError(null);
    const { error } = await supabase.from('job_assignments').insert({
      job_id: jobId,
      user_id: pick,
      role: 'team_member',
      assigned_by: session?.user.id ?? null,
    });
    if (error) setError(error.message);
    else {
      setPick('');
      load();
    }
  }

  async function remove(id: string) {
    setError(null);
    const { error } = await supabase.from('job_assignments').delete().eq('id', id);
    if (error) setError(error.message);
    else load();
  }

  const assignedIds = new Set(rows.map((r) => r.user_id));
  const available = profiles.filter((p) => !assignedIds.has(p.id));

  return (
    <section className="panel">
      <h3>Team members</h3>
      {rows.length === 0 && <p className="muted">No team members assigned yet.</p>}
      <ul className="chip-list">
        {rows.map((r) => (
          <li key={r.id} className="chip">
            {profileName(r.user_id)}
            {canManage && (
              <button
                className="chip-x"
                onClick={() => remove(r.id)}
                aria-label="Remove"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <div className="inline-add">
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— add team member —</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
          <button className="btn" onClick={add} disabled={!pick}>
            Add
          </button>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
    </section>
  );
}
