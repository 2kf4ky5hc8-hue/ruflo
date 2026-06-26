import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Modal } from '../components/Modal';
import type { Property } from '../lib/types';

export function PropertyForm({
  clientId,
  property,
  onClose,
  onSaved,
}: {
  clientId: string;
  property?: Property;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    label: property?.label ?? '',
    address_line1: property?.address_line1 ?? '',
    address_line2: property?.address_line2 ?? '',
    town: property?.town ?? '',
    postcode: property?.postcode ?? '',
    notes: property?.notes ?? '',
  });

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.label.trim() && !form.address_line1.trim()) {
      setError('Give the property a label or an address.');
      return;
    }
    setBusy(true);
    setError(null);
    const payload = {
      label: form.label.trim() || null,
      address_line1: form.address_line1.trim() || null,
      address_line2: form.address_line2.trim() || null,
      town: form.town.trim() || null,
      postcode: form.postcode.trim() || null,
      notes: form.notes.trim() || null,
    };
    const { error } = property
      ? await supabase.from('properties').update(payload).eq('id', property.id)
      : await supabase.from('properties').insert({
          ...payload,
          client_id: clientId,
          created_by: session?.user.id ?? null,
        });
    setBusy(false);
    if (error) setError(error.message);
    else onSaved();
  }

  return (
    <Modal
      title={property ? 'Edit property' : 'New property'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn primary"
            data-testid="property-save-btn"
            form="property-form"
            type="submit"
            disabled={busy}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="property-form" className="form-grid" onSubmit={submit}>
        <label className="full">
          Label
          <input
            data-testid="property-label-input"
            value={form.label}
            placeholder="e.g. Elgin Avenue flat"
            onChange={(e) => set('label', e.target.value)}
          />
        </label>
        <label className="full">
          Address line 1
          <input value={form.address_line1} onChange={(e) => set('address_line1', e.target.value)} />
        </label>
        <label className="full">
          Address line 2
          <input value={form.address_line2} onChange={(e) => set('address_line2', e.target.value)} />
        </label>
        <label>
          Town / city
          <input value={form.town} onChange={(e) => set('town', e.target.value)} />
        </label>
        <label>
          Postcode
          <input value={form.postcode} onChange={(e) => set('postcode', e.target.value)} />
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
