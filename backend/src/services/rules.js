import { query, withTransaction } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { nextId } from '../lib/ids.js';

// Regras da instância: públicas, aceitas no cadastro e citadas em toda decisão da
// moderação que afeta alguém. Quem modera edita; regra retirada é arquivada (não apagada)
// para que decisões antigas continuem mostrando o texto que valia na época.

export const DEFAULT_RULES = [
  ['Respeite as pessoas', 'Sem assédio, ameaças, ataques pessoais ou perseguição. Discordar é bem-vindo; atacar quem discorda, não.'],
  ['Sem discurso de ódio', 'Nada que ataque ou desumanize pessoas por raça, etnia, religião, gênero, orientação sexual, deficiência, origem ou classe.'],
  ['Sem golpes nem se passar por outra pessoa', 'Nunca peça senha, códigos ou dados de acesso. Não finja ser outra pessoa, marca ou instituição.'],
  ['Sem spam', 'Nada de propaganda repetitiva, correntes, links em massa ou contas automáticas sem aviso.'],
  ['Proteja a privacidade', 'Não publique dados pessoais de outras pessoas (endereço, documentos, telefone) sem consentimento.'],
  ['O NWC não é dinheiro', 'Não prometa ganhos, não venda e não troque NWC por dinheiro, produtos ou favores. Ele serve só para recompensar posts.'],
  ['Nada ilegal', 'Não use a rede para combinar, divulgar ou incentivar crimes.'],
];

const COLS = 'id, position, title, description, updated_at';

/** Cria as regras padrão se a instância ainda não tem nenhuma. */
export async function ensureDefaultRules() {
  const { rows } = await query('SELECT 1 FROM instance_rules LIMIT 1');
  if (rows.length) return;
  await withTransaction(async (c) => {
    for (const [i, [title, description]] of DEFAULT_RULES.entries()) {
      await c.query('INSERT INTO instance_rules (id, position, title, description) VALUES ($1, $2, $3, $4)', [nextId(), i + 1, title, description]);
    }
  });
}

export async function listRules() {
  const { rows } = await query(`SELECT ${COLS} FROM instance_rules WHERE archived_at IS NULL ORDER BY position, id`);
  const { rows: mods } = await query("SELECT username, display_name FROM users WHERE is_moderator AND suspended_at IS NULL ORDER BY username");
  const updatedAt = rows.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), rows[0]?.updated_at ?? null);
  return { rules: rows.map(({ updated_at: _u, ...r }) => r), updated_at: updatedAt, moderators: mods };
}

/** Regra ativa (para citar numa decisão). */
export async function getActiveRule(id, db = { query }) {
  const { rows } = await db.query(`SELECT ${COLS} FROM instance_rules WHERE id = $1 AND archived_at IS NULL`, [id]);
  if (!rows[0]) throw badRequest('Escolha uma das regras em vigor');
  return rows[0];
}

/**
 * Substitui a lista inteira (a ordem enviada vira a numeração). Itens com id atualizam,
 * sem id são criados, e os que sumiram da lista ficam arquivados.
 */
export async function replaceRules(list) {
  await withTransaction(async (c) => {
    const { rows: current } = await c.query('SELECT id, title, description FROM instance_rules WHERE archived_at IS NULL');
    const byId = new Map(current.map((r) => [r.id, r]));
    const keep = new Set();
    for (const [i, r] of list.entries()) {
      if (r.id) {
        const old = byId.get(r.id);
        if (!old) throw badRequest('Regra não encontrada (atualize a página)');
        keep.add(r.id);
        const changed = old.title !== r.title || old.description !== r.description;
        await c.query(
          `UPDATE instance_rules SET position = $2, title = $3, description = $4${changed ? ', updated_at = now()' : ''} WHERE id = $1`,
          [r.id, i + 1, r.title, r.description],
        );
      } else {
        await c.query('INSERT INTO instance_rules (id, position, title, description) VALUES ($1, $2, $3, $4)', [nextId(), i + 1, r.title, r.description]);
      }
    }
    const gone = current.filter((r) => !keep.has(r.id)).map((r) => r.id);
    if (gone.length) await c.query('UPDATE instance_rules SET archived_at = now(), updated_at = now() WHERE id = ANY($1::bigint[])', [gone]);
  });
  return listRules();
}
