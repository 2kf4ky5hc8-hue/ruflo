import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import {
  CONTRIBUTION_TYPES,
  type ContributionType,
  type Profile,
} from '../lib/types';

// A contribution is a plain "who did what" log entry: person + type + note + date.
// No points, no score, no weighting, no commission maths.
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
      added_by: session?.user.id ?? null,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDescription('');
    setOpen(false);
    onAdded();
  }

  if (!open) {
    return (
      <button
        className="btn small"
        data-testid="log-contribution-btn"
        onClick={() => setOpen(true)}
      >
        + Log a contribution
      </button>
    );
  }

  return (
    <div className="contrib-form" data-testid="contrib-form">
      <div className="form-grid">
        <label>
          Person
          <select
            data-testid="contrib-person"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          >
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
            data-testid="contrib-type"
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
        <label className="full">
          Notes
          <input
            data-testid="contrib-notes"
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
        <button
          className="btn primary"
          data-testid="contrib-add-btn"
          onClick={add}
          disabled={busy}
        >
          {busy ? 'Saving…' : 'Add'}
        </button>
      </div>
    </div>
  );
}
