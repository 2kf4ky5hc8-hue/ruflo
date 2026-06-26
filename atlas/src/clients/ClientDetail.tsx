import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { canCreateJobs, canEdit } from '../lib/permissions';
import { Icon } from '../components/Icon';
import { propertyLabel, type Client, type Property } from '../lib/types';
import { ClientForm } from './ClientForm';
import { PropertyForm } from './PropertyForm';

export function ClientDetail({
  clientId,
  onBack,
  onOpenProperty,
}: {
  clientId: string;
  onBack: () => void;
  onOpenProperty: (id: string) => void;
}) {
  const { profile } = useAuth();
  const editable = canEdit(profile?.role);
  const [client, setClient] = useState<Client | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [editing, setEditing] = useState(false);
  const [addingProp, setAddingProp] = useState(false);

  const load = useCallback(async () => {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase
        .from('properties')
        .select('*')
        .eq('client_id', clientId)
        .eq('archived', false)
        .order('created_at', { ascending: true }),
    ]);
    setClient((c as Client) ?? null);
    setProperties((p as Property[]) ?? []);
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  async function archiveClient() {
    if (!confirm('Archive this client? It will be hidden but not deleted.')) return;
    const { error } = await supabase.from('clients').update({ archived: true }).eq('id', clientId);
    if (error) alert(error.message);
    else onBack();
  }

  return (
    <div className="panel-page">
      <button className="btn link back" onClick={onBack}>
        ← Clients
      </button>

      {!client ? (
        <div className="muted">Loading…</div>
      ) : (
        <>
          <div className="page-head">
            <h1>{client.name}</h1>
            {editable && (
              <div className="page-actions">
                <button className="btn" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button className="btn warn" onClick={archiveClient}>
                  <Icon name="archive" size={15} /> Archive
                </button>
              </div>
            )}
          </div>

          <div className="detail-meta muted">
            {[client.email, client.phone].filter(Boolean).join(' · ') || 'No contact details'}
          </div>
          {client.notes && <p className="detail-notes">{client.notes}</p>}

          <section className="panel">
            <div className="panel-head-row">
              <h3>Properties</h3>
              {canCreateJobs(profile?.role) && (
                <button
                  className="btn small"
                  data-testid="add-property-btn"
                  onClick={() => setAddingProp(true)}
                >
                  <Icon name="plus" size={14} /> Add property
                </button>
              )}
            </div>
            {properties.length === 0 ? (
              <p className="muted small">No properties yet.</p>
            ) : (
              <ul className="row-list">
                {properties.map((p) => (
                  <li key={p.id} className="row-item" onClick={() => onOpenProperty(p.id)}>
                    <span className="row-icon">
                      <Icon name="pin" size={16} />
                    </span>
                    <div className="row-main">
                      <div className="row-title">{propertyLabel(p)}</div>
                      {p.postcode && <div className="row-sub muted">{p.postcode}</div>}
                    </div>
                    <span className="chev">›</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {editing && (
            <ClientForm
              client={client}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                load();
              }}
            />
          )}
          {addingProp && (
            <PropertyForm
              clientId={clientId}
              onClose={() => setAddingProp(false)}
              onSaved={() => {
                setAddingProp(false);
                load();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
