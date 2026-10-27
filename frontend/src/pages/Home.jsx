import Composer from '../components/Composer.jsx';
import Feed from '../components/Feed.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function Home() {
  return (
    <>
      <PageHeader title="Seguindo" subtitle="Ordem cronológica reversa — sem algoritmo" />
      <Feed
        endpoint="/api/timeline"
        live
        header={(prepend) => <Composer onPosted={prepend} />}
        emptyText="Siga pessoas em Explorar para preencher sua timeline."
      />
    </>
  );
}
