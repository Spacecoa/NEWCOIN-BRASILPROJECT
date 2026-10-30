import { config } from '../config.js';

// E-mail do protótipo. Não há servidor de e-mail: com MAIL_TRANSPORT=log (o único transporte),
// a mensagem é escrita no log do servidor, para quem roda localmente copiar o link.
// Em produção, este é o ponto para ligar um serviço de e-mail de verdade.
const outbox = [];

export async function sendMail({ to, subject, text }) {
  if (config.mailTransport !== 'log') throw new Error(`MAIL_TRANSPORT "${config.mailTransport}" não existe neste protótipo`);
  outbox.push({ to, subject, text, at: new Date() });
  if (outbox.length > 50) outbox.shift();
  if (process.env.NODE_ENV !== 'test') console.log(`[e-mail] Para: ${to}\n[e-mail] Assunto: ${subject}\n${text.replace(/^/gm, '[e-mail] ')}`);
}

/** Últimos e-mails "enviados" (só para os testes). */
export const sentMail = () => [...outbox];
export const clearMail = () => outbox.splice(0);
