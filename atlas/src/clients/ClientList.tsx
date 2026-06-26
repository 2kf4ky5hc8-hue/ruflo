import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { canCreateJobs } from '../lib/permissions';
import { Icon } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import type { Client } from '../lib/types';
import { ClientForm } from './ClientForm';

export function ClientList({ onOpenClient }: { onOpenClient: (id: string) => void }) {
  const { profile } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('archived', showArchived)
      .order('name', { ascending: true });
    setClients((data as Client[]) ?? []);
    setLoading(false);
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="panel-page">
      <div className="page-head">
        <h1>Clients</h1>
        <div className="page-actions">
          <div className="seg">
            <button
              className={'seg-btn' + (!showArchived ? ' active' : '')}
              onClick={() => setShowArchived(false)}
            >
              Active
            </button>
            <button
              className={'seg-btn' + (showArchived ? ' active' : '')}
              onClick={() => setShowArchived(true)}
            >
              Archived
            </button>
          </div>
          {canCreateJobs(profile?.role) && !showArchived && (
            <button
              className="btn primary"
              data-testid="new-client-btn"
              onClick={() => setCreating(true)}
            >
              <Icon name="plus" size={16} /> New client
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading…</div>
      ) : clients.length === 0 ? (
        <div className="empty-state">
          <span className="e-icon">
            <Icon name="inbox" size={22} />
          </span>
          <strong>{showArchived ? 'No archived clients' : 'No clients yet'}</strong>
          {!showArchived && <span>Add a client to start grouping jobs by who and where.</span>}
        </div>
      ) : (
        <ul className="row-list">
          {clients.map((c) => (
            <li
              key={c.id}
              className="row-item"
              data-testid="client-row"
              onClick={() => onOpenClient(c.id)}
            >
              <Avatar name={c.name} id={c.id} size={32} />
              <div className="row-main">
                <div className="row-title">{c.name}</div>
                <div className="row-sub muted">
                  {[c.email, c.phone].filter(Boolean).join(' · ') || 'No contact details'}
                </div>
              </div>
              <span className="chev">›</span>
            </li>
          ))}
        </ul>
      )}

      {creating && (
        <ClientForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
    </div>
  );
}
