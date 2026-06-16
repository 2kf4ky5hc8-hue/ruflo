import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { dateTimeLabel } from '../lib/format';
import { stageLabel, type JobActivity } from '../lib/types';

function describe(a: JobActivity): string {
  const d = a.detail ?? {};
  switch (a.action) {
    case 'created':
      return `Created in ${stageLabel(d.stage as string)}`;
    case 'stage_changed':
      return `Stage: ${stageLabel(d.from as string)} → ${stageLabel(d.to as string)}`;
    case 'archived':
      return 'Archived';
    case 'unarchived':
      return 'Unarchived';
    default:
      return a.action;
  }
}

export function ActivityLog({
  jobId,
  profileName,
}: {
  jobId: string;
  profileName: (id: string | null) => string;
}) {
  const [rows, setRows] = useState<JobActivity[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('job_activity')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(50);
    setRows((data as JobActivity[]) ?? []);
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section className="panel">
      <h3>Activity</h3>
      {rows.length === 0 && <p className="muted">No activity yet.</p>}
      <ul className="timeline">
        {rows.map((a) => (
          <li key={a.id}>
            <span className="t-when muted">{dateTimeLabel(a.created_at)}</span>
            <span className="t-what">{describe(a)}</span>
            <span className="t-who muted">{profileName(a.actor)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
