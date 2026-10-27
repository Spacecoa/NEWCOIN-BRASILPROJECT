import { Navigate, Route, Routes } from 'react-router';
import { useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Channel from './pages/Channel.jsx';
import Channels from './pages/Channels.jsx';
import Explore from './pages/Explore.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import Mentions from './pages/Mentions.jsx';
import Profile from './pages/Profile.jsx';
import Register from './pages/Register.jsx';
import Thread from './pages/Thread.jsx';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Register />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="explorar" element={<Explore />} />
        <Route path="mencoes" element={<Mentions />} />
        <Route path="u/:username" element={<Profile />} />
        <Route path="post/:id" element={<Thread />} />
        <Route path="canais" element={<Channels />} />
        <Route path="canais/:slug" element={<Channel />} />
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/cadastro" element={<Navigate to="/" replace />} />
      <Route path="*" element={<p className="p-8 text-center">Página não encontrada.</p>} />
    </Routes>
  );
}
