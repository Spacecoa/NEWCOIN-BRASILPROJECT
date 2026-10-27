import { useState } from 'react';
import ComposeSheet from '../components/ComposeSheet.jsx';
import Composer from '../components/Composer.jsx';
import Feed from '../components/Feed.jsx';
import Icon from '../components/Icon.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function Home() {
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <>
      <PageHeader title="Início" subtitle="Quem você segue, do mais novo ao mais antigo" />
      <Feed
        endpoint="/api/timeline"
        live
        header={(prepend) => (
          <>
            {/* No celular, postar fica no botão flutuante; a partir de md, o campo fica no topo. */}
            <div className="hidden md:block">
              <Composer onPosted={prepend} />
            </div>
            <ComposeSheet open={sheetOpen} onClose={() => setSheetOpen(false)} onPosted={prepend} />
          </>
        )}
        emptyText="Siga pessoas em Explorar para preencher sua timeline."
      />
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label="Novo post"
        className="fixed right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30 md:hidden"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
      >
        <Icon name="plus" className="h-6 w-6" />
      </button>
    </>
  );
}
