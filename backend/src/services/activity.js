import { config } from '../config.js';
import { query } from '../db.js';

// Tempo ativo no app, para a missão "tempo no app".
// O cliente envia um sinal por minuto SÓ quando a aba está visível e houve interação recente.
// O servidor aceita no máximo 1 minuto a cada 55 s e no máximo 120 min por dia.
// Guardamos só o total de minutos do dia: nada sobre o que foi visto. Nunca entra no ranking.

export const MAX_MINUTES_PER_DAY = 120;

export async function recordBeat(userId) {
  const { rows } = await query(
    `INSERT INTO activity_days (user_id, day, minutes, last_beat_at)
     VALUES ($1, (now() AT TIME ZONE $2)::date, 1, now())
     ON CONFLICT (user_id, day) DO UPDATE SET
       minutes = CASE
         WHEN activity_days.last_beat_at > now() - interval '55 seconds' OR activity_days.minutes >= $3
           THEN activity_days.minutes ELSE activity_days.minutes + 1 END,
       last_beat_at = CASE
         WHEN activity_days.last_beat_at > now() - interval '55 seconds' THEN activity_days.last_beat_at ELSE now() END
     RETURNING minutes`,
    [userId, config.missionTimezone, MAX_MINUTES_PER_DAY],
  );
  return { minutes: rows[0].minutes };
}

export async function minutesToday(userId) {
  const { rows } = await query(
    'SELECT minutes FROM activity_days WHERE user_id = $1 AND day = (now() AT TIME ZONE $2)::date',
    [userId, config.missionTimezone],
  );
  return rows[0]?.minutes ?? 0;
}
