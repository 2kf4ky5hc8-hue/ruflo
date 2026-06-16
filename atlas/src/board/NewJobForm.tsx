import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Modal } from '../components/Modal';
import {
  STAGES,
  PAYMENT_STATUSES,
  type JobStage,
  type PaymentStatus,
  type Profile,
} from '../lib/types';

export function NewJobForm({
  profiles,
  onClose,
  onCreated,
}: {
  profiles: Profile[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    job_name: '',
    client_name: '',
    site_address: '',
    stage: 'lead' as JobStage,
    assigned_manager: '',
    lead_source: '',
    estimated_value: '',
    amount_outstanding: '',
    payment_status: 'none' as PaymentStatus,
    next_action: '',
    next_action_due: '',
    notes: '',
  });

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.job_name.trim()) {
      setError('Job name is required.');
      return;
    }
    setBusy(true);
    setError(null);

    const payload = {
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
      created_by: session?.user.id ?? null,
    };

    const { error } = await supabase.from('jobs').insert(payload);
    setBusy(false);
    if (error) setError(error.message);
    else onCreated();
  }

  return (
    <Modal
      title="New job"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            form="new-job-form"
            type="submit"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Create job'}
          </button>
        </>
      }
    >
      <form id="new-job-form" className="form-grid" onSubmit={submit}>
        <label className="full">
          Job name *
          <input
            value={form.job_name}
            onChange={(e) => set('job_name', e.target.value)}
            required
          />
        </label>
        <label>
          Client name
          <input
            value={form.client_name}
            onChange={(e) => set('client_name', e.target.value)}
          />
        </label>
        <label>
          Lead source
          <input
            value={form.lead_source}
            onChange={(e) => set('lead_source', e.target.value)}
          />
        </label>
        <label className="full">
          Site address
          <input
            value={form.site_address}
            onChange={(e) => set('site_address', e.target.value)}
          />
        </label>
        <label>
          Stage
          <select
            value={form.stage}
            onChange={(e) => set('stage', e.target.value as JobStage)}
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
          >
            <option value="">— none —</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          Estimated value (£)
          <input
            type="number"
            step="0.01"
            value={form.estimated_value}
            onChange={(e) => set('estimated_value', e.target.value)}
          />
        </label>
        <label>
          Amount outstanding (£)
          <input
            type="number"
            step="0.01"
            value={form.amount_outstanding}
            onChange={(e) => set('amount_outstanding', e.target.value)}
          />
        </label>
        <label>
          Payment status
          <select
            value={form.payment_status}
            onChange={(e) => set('payment_status', e.target.value as PaymentStatus)}
          >
            {PAYMENT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Next action due
          <input
            type="date"
            value={form.next_action_due}
            onChange={(e) => set('next_action_due', e.target.value)}
          />
        </label>
        <label className="full">
          Next action
          <input
            value={form.next_action}
            onChange={(e) => set('next_action', e.target.value)}
          />
        </label>
        <label className="full">
          Notes
          <textarea
            rows={3}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
        {error && <div className="alert error full">{error}</div>}
      </form>
    </Modal>
  );
}
