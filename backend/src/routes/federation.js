import { Router } from 'express';
import { config } from '../config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getProfile, getUserIdByUsername } from '../services/users.js';

// Camada de federação MÍNIMA e somente leitura. Ela demonstra como uma instância
// expõe identidades e conteúdo para outras instâncias, no espírito de WebFinger
// (RFC 7033) e ActivityPub. NÃO implementa assinatura HTTP, inbox nem entrega
// server-to-server — ver docs/03-arquitetura.md, seção "Caminho para federação".

const router = Router();
const base = () => `http://${config.instanceDomain}`;

router.get('/.well-known/webfinger', async (req, res) => {
  const resource = String(req.query.resource ?? '');
  const match = /^acct:([A-Za-z0-9_]{3,20})@(.+)$/.exec(resource);
  if (!match) throw badRequest('Use resource=acct:usuario@dominio');
  if (match[2] !== config.instanceDomain) throw notFound('Usuário não pertence a esta instância');
  await getUserIdByUsername(match[1]);
  res.type('application/jrd+json').json({
    subject: resource,
    links: [
      { rel: 'self', type: 'application/activity+json', href: `${base()}/federation/users/${match[1]}` },
      { rel: 'http://webfinger.net/rel/profile-page', href: `${base()}/u/${match[1]}` },
    ],
  });
});

router.get('/.well-known/nodeinfo', (_req, res) => {
  res.json({ software: { name: 'agora', version: '0.1.0' }, protocols: ['agora-outbox-v0'], openRegistrations: true });
});

router.get('/federation/users/:username', async (req, res) => {
  const profile = await getProfile(req.params.username, null);
  res.type('application/activity+json').json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Person',
    id: `${base()}/federation/users/${profile.username}`,
    preferredUsername: profile.username,
    name: profile.display_name,
    summary: profile.bio,
    outbox: `${base()}/federation/users/${profile.username}/outbox`,
  });
});

/**
 * Outbox: os posts desta instância só são lidos por quem tem conta e entrou nela.
 * Outra instância (ou alguém sem login) recebe a coleção vazia, com o motivo.
 */
router.get('/federation/users/:username/outbox', async (req, res) => {
  await getUserIdByUsername(req.params.username);
  const actor = `${base()}/federation/users/${req.params.username}`;
  res.type('application/activity+json').json({
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'OrderedCollection',
    id: `${actor}/outbox`,
    totalItems: 0,
    orderedItems: [],
    summary: 'Os posts desta instância só podem ser lidos por quem tem conta e entrou nela.',
  });
});

export default router;
