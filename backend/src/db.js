import pg from 'pg';
import { config } from './config.js';

// BIGINT (int8) volta como string do driver: é o que queremos, pois Snowflakes
// passam de 2^53 e perderiam precisão como Number (o X expõe "id_str" pelo mesmo motivo).
// Tempos-limite: uma consulta lenta (ou travada) é cancelada em vez de segurar uma das
// poucas conexões do pool e fazer todo mundo esperar na fila.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  statement_timeout: config.dbStatementTimeoutMs,
  idle_in_transaction_session_timeout: config.dbStatementTimeoutMs * 2,
  connectionTimeoutMillis: config.dbStatementTimeoutMs,
});

export const query = (text, params) => pool.query(text, params);

/** Executa fn(client) dentro de uma transação. */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
