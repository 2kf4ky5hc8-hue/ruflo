import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import {
  CONTRIBUTION_TYPES,
  type ContributionType,
  type Profile,
} from '../lib/types';

export function AddContribution({
  jobId,
  profiles,
  onAdded,
}: {
  jobId: string;
  profiles: Profile[];
  onAdded: () => void;
}) {
  const { session } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState(session?.user.id ?? '');
  const [type, setType] = useState<ContributionType>('lead_in');
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('');

  async function add() {
    if (!userId) {
      setError('Choose a person.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('job_contributions').insert({
      job_id: jobId,
      user_id: userId,
      contribution_type: type,
      description: description.trim() || null,
      weight: weight ? Number(weight) : null,
      added_by: session?.user.id ?? null,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDescription('');
    setWeight('');
    setOpen(false);
    onAdded();
  }

  if (!open) {
    return (
      <button className="btn small" onClick={() => setOpen(true)}>
        + Log a contribution
      </button>
    );
  }

  return (
    <div className="contrib-form">
      <div className="form-grid">
        <label>
          Person
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— choose —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          Contribution
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ContributionType)}
          >
            {CONTRIBUTION_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Weight / points (optional)
          <input
            type="number"
            step="0.01"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>
        <label className="full">
          Notes
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="inline-actions">
        <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
        <button className="btn primary" onClick={add} disabled={busy}>
          {busy ? 'Saving…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
