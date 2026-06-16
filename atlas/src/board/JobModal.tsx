import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Modal } from '../components/Modal';
import { Icon } from '../components/Icon';
import { canEdit, canManageAll } from '../lib/permissions';
import { dateTimeLabel } from '../lib/format';
import {
  STAGES,
  PAYMENT_STATUSES,
  stageLabel,
  type Job,
  type JobStage,
  type PaymentStatus,
  type Profile,
} from '../lib/types';
import { Assignments } from './Assignments';
import { ActivityLog } from './ActivityLog';
import { ContributionList } from '../contributions/ContributionList';

export function JobModal({
  job,
  profiles,
  profileName,
  onClose,
  onChanged,
}: {
  job: Job;
  profiles: Profile[];
  profileName: (id: string | null) => string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const editable = canEdit(profile?.role);
  const isManager = canManageAll(profile?.role);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    job_name: job.job_name,
    client_name: job.client_name ?? '',
    site_address: job.site_address ?? '',
    stage: job.stage,
    assigned_manager: job.assigned_manager ?? '',
    lead_source: job.lead_source ?? '',
    estimated_value: job.estimated_value?.toString() ?? '',
    amount_outstanding: job.amount_outstanding?.toString() ?? '',
    payment_status: job.payment_status,
    next_action: job.next_action ?? '',
    next_action_due: job.next_action_due ?? '',
    notes: job.notes ?? '',
    xero_contact_ref: job.xero_contact_ref ?? '',
    xero_invoice_ref: job.xero_invoice_ref ?? '',
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase
      .from('jobs')
      .update({
        job_name: form.job_name.trim(),
        client_name: form.client_name.trim() || null,
        site_address: form.site_address.trim() || null,
        stage: form.stage,
        assigned_manager: form.assigned_manager || null,
        lead_source: form.lead_source.trim() || null,
        estimated_value: form.estimated_value ? Number(form.estimated_value) : null,
        amount_outstanding: form.amount_outstanding
          ? Number(form.amount_outstanding)
          : null,
        payment_status: form.payment_status,
        next_action: form.next_action.trim() || null,
        next_action_due: form.next_action_due || null,
        notes: form.notes.trim() || null,
        xero_contact_ref: form.xero_contact_ref.trim() || null,
        xero_invoice_ref: form.xero_invoice_ref.trim() || null,
      })
      .eq('id', job.id);
    setBusy(false);
    if (error) setError(error.message);
    else onChanged();
  }

  async function setArchived(archived: boolean) {
    setBusy(true);
    setError(null);
    const { error } = await supabase.from('jobs').update({ archived }).eq('id', job.id);
    setBusy(false);
    if (error) setError(error.message);
    else {
      onChanged();
      onClose();
    }
  }

  const subtitle = (
    <>
      <span className="stage-badge">
        <span className="dot" style={{ background: `var(--st-${form.stage})` }} />
        {stageLabel(form.stage)}
      </span>
      {job.client_name && <span>{job.client_name}</span>}
      {job.archived && <span className="badge">Archived</span>}
    </>
  );

  return (
    <Modal
      title={job.job_name}
      subtitle={subtitle}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {editable &&
            (job.archived ? (
              <button className="btn" onClick={() => setArchived(false)} disabled={busy}>
                <Icon name="archive" size={15} /> Unarchive
              </button>
            ) : (
              <button
                className="btn warn"
                onClick={() => setArchived(true)}
                disabled={busy}
              >
                <Icon name="archive" size={15} /> Archive
              </button>
            ))}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            Close
          </button>
          {editable && (
            <button className="btn primary" form="job-form" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          )}
        </>
      }
    >
      <form id="job-form" onSubmit={save}>
        <div className="form-section">
          <div className="section-label">Details</div>
          <div className="form-grid">
            <label className="full">
              Job name
              <input
                value={form.job_name}
                onChange={(e) => set('job_name', e.target.value)}
                disabled={!editable}
                required
              />
            </label>
            <label>
              Client name
              <input
                value={form.client_name}
                onChange={(e) => set('client_name', e.target.value)}
                disabled={!editable}
              />
            </label>
            <label>
              Lead source
              <input
                value={form.lead_source}
                onChange={(e) => set('lead_source', e.target.value)}
                disabled={!editable}
              />
            </label>
            <label className="full">
              Site address
              <input
                value={form.site_address}
                onChange={(e) => set('site_address', e.target.value)}
                disabled={!editable}
              />
            </label>
            <label>
              Stage
              <select
                value={form.stage}
                onChange={(e) => set('stage', e.target.value as JobStage)}
                disabled={!editable}
              >
                {STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assigned manager
              <select
                value={form.assigned_manager}
                onChange={(e) => set('assigned_manager', e.target.value)}
                disabled={!editable}
              >
                <option value="">— none —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-label">Money &amp; invoicing</div>
          <div className="form-grid">
            <label>
              Estimated value (£)
              <input
                type="number"
                step="0.01"
                value={form.estimated_value}
                onChange={(e) => set('estimated_value', e.target.value)}
                disabled={!editable}
              />
            </label>
            <label>
              Amount outstanding (£)
              <input
                type="number"
                step="0.01"
                value={form.amount_outstanding}
                onChange={(e) => set('amount_outstanding', e.target.value)}
                disabled={!editable}
              />
            </label>
            <label>
              Payment status
              <select
                value={form.payment_status}
                onChange={(e) => set('payment_status', e.target.value as PaymentStatus)}
                disabled={!editable}
              >
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Xero contact ref
              <input
                value={form.xero_contact_ref}
                onChange={(e) => set('xero_contact_ref', e.target.value)}
                disabled={!editable}
              />
            </label>
            <label>
              Xero invoice ref
              <input
                value={form.xero_invoice_ref}
                onChange={(e) => set('xero_invoice_ref', e.target.value)}
                disabled={!editable}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-label">Next action</div>
          <div className="form-grid">
            <label>
              Due date
              <input
                type="date"
                value={form.next_action_due}
                onChange={(e) => set('next_action_due', e.target.value)}
                disabled={!editable}
              />
            </label>
            <label className="full">
              What needs to happen next
              <input
                value={form.next_action}
                onChange={(e) => set('next_action', e.target.value)}
                disabled={!editable}
              />
            </label>
          </div>
        </div>

        <div className="form-section">
          <div className="section-label">Notes</div>
          <div className="form-grid">
            <label className="full">
              <textarea
                rows={3}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                disabled={!editable}
              />
            </label>
          </div>
        </div>

        {error && <div className="alert error">{error}</div>}
      </form>

      <div className="meta-line muted">
        Created by {profileName(job.created_by)} · {dateTimeLabel(job.created_at)} —
        last updated by {profileName(job.updated_by)} · {dateTimeLabel(job.updated_at)}
      </div>

      <Assignments
        jobId={job.id}
        profiles={profiles}
        canManage={isManager}
        profileName={profileName}
      />

      <ContributionList
        jobId={job.id}
        profiles={profiles}
        profileName={profileName}
        canAdd={editable}
        canManageAll={isManager}
      />

      <ActivityLog jobId={job.id} profileName={profileName} />
    </Modal>
  );
}
