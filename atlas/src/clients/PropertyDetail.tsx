import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { canCreateJobs, canEdit } from '../lib/permissions';
import { Icon } from '../components/Icon';
import { stageLabel, propertyLabel, type Job, type Property } from '../lib/types';
import { money } from '../lib/format';
import { PropertyForm } from './PropertyForm';
import { NewJobForm } from '../board/NewJobForm';

export function PropertyDetail({
  propertyId,
  onBack,
}: {
  propertyId: string;
  onBack: () => void;
}) {
  const { profile } = useAuth();
  const editable = canEdit(profile?.role);
  const [property, setProperty] = useState<Property | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [editing, setEditing] = useState(false);
  const [addingJob, setAddingJob] = useState(false);

  const load = useCallback(async () => {
    const [{ data: p }, { data: j }] = await Promise.all([
      supabase.from('properties').select('*').eq('id', propertyId).single(),
      supabase
        .from('jobs')
        .select('*')
        .eq('property_id', propertyId)
        .eq('archived', false)
        .order('created_at', { ascending: true }),
    ]);
    setProperty((p as Property) ?? null);
    setJobs((j as Job[]) ?? []);
  }, [propertyId]);

  useEffect(() => {
    load();
  }, [load]);

  async function archiveProperty() {
    if (!confirm('Archive this property? It will be hidden but not deleted.')) return;
    const { error } = await supabase
      .from('properties')
      .update({ archived: true })
      .eq('id', propertyId);
    if (error) alert(error.message);
    else onBack();
  }

  const addressParts = property
    ? [property.address_line1, property.address_line2, property.town, property.postcode].filter(
        Boolean,
      )
    : [];

  return (
    <div className="panel-page">
      <button className="btn link back" onClick={onBack}>
        ← Client
      </button>

      {!property ? (
        <div className="muted">Loading…</div>
      ) : (
        <>
          <div className="page-head">
            <h1>{propertyLabel(property)}</h1>
            {editable && (
              <div className="page-actions">
                <button className="btn" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button className="btn warn" onClick={archiveProperty}>
                  <Icon name="archive" size={15} /> Archive
                </button>
              </div>
            )}
          </div>

          <div className="detail-meta muted">
            {addressParts.length ? addressParts.join(', ') : 'No address on file'}
          </div>
          {property.notes && <p className="detail-notes">{property.notes}</p>}

          <section className="panel">
            <div className="panel-head-row">
              <h3>Jobs at this property</h3>
              {canCreateJobs(profile?.role) && (
                <button className="btn small" onClick={() => setAddingJob(true)}>
                  <Icon name="plus" size={14} /> Add job here
                </button>
              )}
            </div>
            {jobs.length === 0 ? (
              <p className="muted small">No jobs yet.</p>
            ) : (
              <ul className="row-list">
                {jobs.map((job) => (
                  <li key={job.id} className="row-item static">
                    <div className="row-main">
                      <div className="row-title">{job.job_name}</div>
                      {job.estimated_value != null && (
                        <div className="row-sub muted">{money(job.estimated_value)}</div>
                      )}
                    </div>
                    <span className="stage-badge">
                      <span className="dot" style={{ background: `var(--st-${job.stage})` }} />
                      {stageLabel(job.stage)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">Open the board to manage a job in detail.</p>
          </section>

          {editing && (
            <PropertyForm
              clientId={property.client_id}
              property={property}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                load();
              }}
            />
          )}
          {addingJob && (
            <NewJobForm
              profiles={[]}
              initialClientId={property.client_id}
              initialPropertyId={property.id}
              onClose={() => setAddingJob(false)}
              onCreated={() => {
                setAddingJob(false);
                load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
