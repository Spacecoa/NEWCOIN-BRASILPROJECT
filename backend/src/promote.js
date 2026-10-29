// Promoção manual a moderação: `npm run moderacao:promover -- <usuario>`.
// Serve para a conta certa quando o nome foi criado depois de configurado em MODERATORS.
import { pool } from './db.js';
import { migrate } from './migrate.js';
import { promoteModeratorManually } from './services/moderation.js';

const username = process.argv[2];
if (!username) {
  console.error('Uso: npm run moderacao:promover -- <usuario>');
  process.exit(1);
}
migrate()
  .then(() => promoteModeratorManually(username))
  .then((u) => console.log(`@${u} agora modera a instância.`))
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
