import Feed from '../components/Feed.jsx';
import PageHeader from '../components/PageHeader.jsx';

export default function Mentions() {
  return (
    <>
      <PageHeader title="Menções" subtitle="Posts que citam você" />
      <Feed endpoint="/api/mentions" emptyText="Ninguém mencionou você ainda." />
    </>
  );
}
