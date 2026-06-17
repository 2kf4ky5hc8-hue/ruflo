import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Avatar } from '../components/Avatar';
import { dateLabel } from '../lib/format';
import { contributionLabel, type JobContribution, type Profile } from '../lib/types';
import { AddContribution } from './AddContribution';

export function ContributionList({
  jobId,
  profiles,
  profileName,
  canAdd,
}: {
  jobId: string;
  profiles: Profile[];
  profileName: (id: string | null) => string;
  canAdd: boolean;
}) {
  const [rows, setRows] = useState<JobContribution[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('job_contributions')
      .select('*')
      .eq('job_id', jobId)
      .order('occurred_at', { ascending: false });
    setRows((data as JobContribution[]) ?? []);
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="panel">
      <h3>Contributions</h3>
      <p className="panel-hint">
        Who had a hand in this job — used later to work out commission fairly.
      </p>

      {rows.length === 0 && <p className="muted small">No contributions logged yet.</p>}
      <ul className="contrib-list">
        {rows.map((c) => (
          <li key={c.id}>
            <Avatar name={profileName(c.user_id)} id={c.user_id} size={28} />
            <div className="contrib-body">
              <div className="contrib-main">
                <strong>{profileName(c.user_id)}</strong>
                <span className="badge soft">{contributionLabel(c.contribution_type)}</span>
                {c.weight != null && <span className="weight">{c.weight} pts</span>}
              </div>
              {c.description && <div className="contrib-desc">{c.description}</div>}
              <div className="contrib-foot muted">
                {dateLabel(c.occurred_at)} · added by {profileName(c.added_by)}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {canAdd && <AddContribution jobId={jobId} profiles={profiles} onAdded={load} />}
    </section>
  );
}
