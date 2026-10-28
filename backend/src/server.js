import { createServer } from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';
import { promoteModerators } from './services/moderation.js';
import { attachRealtime } from './realtime/socket.js';

await migrate();
const promoted = await promoteModerators(config.moderators);
if (promoted) console.log(`[moderação] ${promoted} conta(s) promovida(s) a moderação: ${config.moderators.join(', ')}`);
const httpServer = createServer(createApp());
attachRealtime(httpServer);
httpServer.listen(config.port, () => {
  console.log(`Ágora backend em http://localhost:${config.port} (instância ${config.instanceDomain})`);
});
