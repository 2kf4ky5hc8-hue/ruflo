import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { propertyLabel, type Client, type Property } from '../lib/types';

// Two linked dropdowns: Client, then Property (filtered to that client).
// Only shows clients/properties the current user is allowed to see (RLS).
export function ClientPropertyPicker({
  clientId,
  propertyId,
  onClientChange,
  onPropertyChange,
  disabled,
}: {
  clientId: string;
  propertyId: string;
  onClientChange: (id: string) => void;
  onPropertyChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);

  useEffect(() => {
    supabase
      .from('clients')
      .select('*')
      .eq('archived', false)
      .order('name', { ascending: true })
      .then(({ data }) => setClients((data as Client[]) ?? []));
  }, []);

  const loadProperties = useCallback(async (cid: string) => {
    if (!cid) {
      setProperties([]);
      return;
    }
    const { data } = await supabase
      .from('properties')
      .select('*')
      .eq('client_id', cid)
      .eq('archived', false)
      .order('created_at', { ascending: true });
    setProperties((data as Property[]) ?? []);
  }, []);

  useEffect(() => {
    loadProperties(clientId);
  }, [clientId, loadProperties]);

  return (
    <>
      <label>
        Client
        <select
          value={clientId}
          disabled={disabled}
          onChange={(e) => {
            onClientChange(e.target.value);
            onPropertyChange('');
          }}
        >
          <option value="">— none —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Property
        <select
          value={propertyId}
          disabled={disabled || !clientId}
          onChange={(e) => onPropertyChange(e.target.value)}
        >
          <option value="">{clientId ? '— none —' : 'Choose a client first'}</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {propertyLabel(p)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
