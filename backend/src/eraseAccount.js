// Exclusão de conta pela linha de comando: `npm run conta:excluir -- <usuario>`.
// Para quem administra o servidor atender um pedido que não passa pelo app
// (ex.: conta suspensa, que não consegue entrar). Faz o mesmo que o botão do app (docs/16).
import { closeRedis } from './cache.js';
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { eraseAccount } from './services/account.js';
import { getUserIdByUsername } from './services/users.js';

const username = process.argv[2];
if (!username || process.argv[3] !== '--confirmo') {
  console.error('Uso: npm run conta:excluir -- <usuario> --confirmo   (apaga a conta de vez; não dá para desfazer)');
  process.exit(1);
}
migrate()
  .then(() => getUserIdByUsername(username))
  .then((id) => eraseAccount(id))
  .then((r) => console.log(`@${r.username} excluída. Canais passados: ${r.channels_passed}; canais apagados: ${r.channels_removed}.`))
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => Promise.all([pool.end(), closeRedis()]));
