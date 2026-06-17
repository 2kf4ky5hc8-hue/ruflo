import { useState } from 'react';
import { TopBar, type AppView } from '../components/TopBar';
import { ClientList } from './ClientList';
import { ClientDetail } from './ClientDetail';
import { PropertyDetail } from './PropertyDetail';

export function ClientsView({ onNav }: { onNav: (v: AppView) => void }) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);

  let content;
  if (propertyId) {
    content = (
      <PropertyDetail propertyId={propertyId} onBack={() => setPropertyId(null)} />
    );
  } else if (clientId) {
    content = (
      <ClientDetail
        clientId={clientId}
        onBack={() => setClientId(null)}
        onOpenProperty={setPropertyId}
      />
    );
  } else {
    content = <ClientList onOpenClient={setClientId} />;
  }

  return (
    <div className="app">
      <TopBar current="clients" onNav={onNav} />
      <div className="page">{content}</div>
    </div>
  );
}
