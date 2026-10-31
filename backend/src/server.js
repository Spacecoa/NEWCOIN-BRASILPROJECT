import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { promoteModerators } from './services/moderation.js';
import { loadRegistro, startRefreshLoop } from './official/service.js';
import { startEvaporationLoop } from './services/evaporation.js';
import { startFanoutWorker } from './services/fanout.js';
import { attachRealtime } from './realtime/socket.js';

await migrate();
const mods = await promoteModerators(config.moderators);
if (mods.promoted) console.log(`[moderação] ${mods.promoted} conta(s) promovida(s) a moderação.`);
if (mods.missing.length) console.warn(`[moderação] MODERATORS cita conta(s) que não existem: ${mods.missing.join(', ')}. Elas não serão promovidas sozinhas quando forem criadas.`);
if (mods.refused.length) {
  console.warn(
    `[moderação] Não promovidas: ${mods.refused.join(', ')} (criadas depois que o nome apareceu em MODERATORS). Se for a pessoa certa: npm run moderacao:promover -- <usuario>`,
  );
}
if (!process.env.RESEARCH_CONTACT) {
  console.warn('[termo] RESEARCH_CONTACT vazio: o termo de consentimento manda as dúvidas para a moderação. Num piloto, defina o contato da equipe (docs/16).');
}
const httpServer = createServer(createApp());
attachRealtime(httpServer);
// Aba "Brasil em dados": números conferidos à mão; a busca automática só roda se configurada.
const reg = await loadRegistro();
console.log(`[dados] registro conferido carregado (${reg.filter((r) => !r.unchanged).length} fonte(s) novas ou alteradas de ${reg.length})`);
startRefreshLoop({ minutes: config.officialDataRefreshMin });
startEvaporationLoop();
// Distribui os posts para as timelines dos seguidores fora do pedido de postar.
await startFanoutWorker();
httpServer.listen(config.port, () => {
  console.log(`Ágora backend em http://localhost:${config.port} (instância ${config.instanceDomain})`);
});
