import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Modal } from '../components/Modal';
import type { Client } from '../lib/types';

export function ClientForm({
  client,
  onClose,
  onSaved,
}: {
  client?: Client;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: client?.name ?? '',
    email: client?.email ?? '',
    phone: client?.phone ?? '',
    notes: client?.notes ?? '',
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Client name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
    };
    const { error } = client
      ? await supabase.from('clients').update(payload).eq('id', client.id)
      : await supabase
          .from('clients')
          .insert({ ...payload, created_by: session?.user.id ?? null });
    setBusy(false);
    if (error) setError(error.message);
    else onSaved();
  }

  return (
    <Modal
      title={client ? 'Edit client' : 'New client'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            data-testid="client-save-btn"
            form="client-form"
            type="submit"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="client-form" className="form-grid" onSubmit={submit}>
        <label className="full">
          Client name *
          <input
            data-testid="client-name-input"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            required
          />
        </label>
        <label>
          Email
          <input value={form.email} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label>
          Phone
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label className="full">
          Notes
          <textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
        </label>
        {error && <div className="alert error full">{error}</div>}
      </form>
    </Modal>
  );
}
