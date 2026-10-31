import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import VisitorLayout from './components/VisitorLayout.jsx';
import Channel from './pages/Channel.jsx';
import Channels from './pages/Channels.jsx';
import Consent from './pages/Consent.jsx';
import Explore from './pages/Explore.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import Home from './pages/Home.jsx';
import Interests from './pages/Interests.jsx';
import Login from './pages/Login.jsx';
import Missions from './pages/Missions.jsx';
import Moderation from './pages/Moderation.jsx';
import Notifications from './pages/Notifications.jsx';
import Privacy from './pages/Privacy.jsx';
import Profile from './pages/Profile.jsx';
import Register from './pages/Register.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Rules from './pages/Rules.jsx';
import Brasil from './pages/Brasil.jsx';
import Thread from './pages/Thread.jsx';
import Wallet from './pages/Wallet.jsx';

/** Depois de entrar, volta para a página de onde a pessoa veio (ex.: o post que ia curtir). */
function AfterLogin() {
  const { state } = useLocation();
  const from = typeof state?.from === 'string' && state.from.startsWith('/') && !state.from.startsWith('//') ? state.from : '/';
  return <Navigate to={from} replace />;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-center text-zinc-500">Carregando…</p>;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Register />} />
        <Route path="/esqueci-senha" element={<ForgotPassword />} />
        <Route path="/redefinir-senha" element={<ResetPassword />} />
        <Route path="/regras" element={<Rules />} />
        <Route path="/termo" element={<Consent />} />
        {/* Visitante: lê posts, threads, perfis e a aba Brasil. Interagir pede login. */}
        <Route element={<VisitorLayout />}>
          <Route index element={<Explore />} />
          <Route path="explorar" element={<Navigate to="/" replace />} />
          <Route path="u/:username" element={<Profile />} />
          <Route path="post/:id" element={<Thread />} />
          <Route path="brasil" element={<Brasil />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="explorar" element={<Explore />} />
        <Route path="notificacoes" element={<Notifications />} />
        <Route path="mencoes" element={<Navigate to="/notificacoes?aba=mencoes" replace />} />
        <Route path="interesses" element={<Interests />} />
        <Route path="missoes" element={<Missions />} />
        <Route path="carteira" element={<Wallet />} />
        <Route path="u/:username" element={<Profile />} />
        <Route path="post/:id" element={<Thread />} />
        <Route path="canais" element={<Channels />} />
        <Route path="canais/:slug" element={<Channel />} />
        <Route path="privacidade" element={<Privacy />} />
        <Route path="moderacao" element={<Moderation />} />
        <Route path="regras" element={<Rules />} />
        <Route path="termo" element={<Consent />} />
        <Route path="brasil" element={<Brasil />} />
      </Route>
      <Route path="/login" element={<AfterLogin />} />
      <Route path="/cadastro" element={<AfterLogin />} />
      <Route path="/esqueci-senha" element={<AfterLogin />} />
      <Route path="/redefinir-senha" element={<ResetPassword />} />
      <Route path="*" element={<p className="p-8 text-center">Página não encontrada.</p>} />
    </Routes>
  );
}
