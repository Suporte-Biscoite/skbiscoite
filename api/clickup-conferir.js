// api/clickup-conferir.js — conferência periódica (reforço do webhook). Pensada para um cron/agendador externo
// que chame GET com "Authorization: Bearer <CRON_SECRET>". Não cria nada no Omie.
import crypto from 'node:crypto';
import { sql } from './_lib/db.js';
import { garantirEsquema } from './_lib/schema.js';
import { clickupConfigurado } from './_lib/clickup.js';
import { conferirLista } from './_lib/solicitacoes.js';

export default async function handler(req, res) {
  const segredo = process.env.CRON_SECRET;
  const enviado = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
  const esperado = Buffer.from(segredo || '');
  if (!segredo || enviado.length !== esperado.length || !crypto.timingSafeEqual(enviado, esperado)) return res.status(401).json({ error: 'Não autorizado.' });
  if (!clickupConfigurado()) return res.status(409).json({ error: 'CLICKUP_API_TOKEN não configurado.' });
  try {
    await garantirEsquema();
    return res.status(200).json(await conferirLista(sql));
  } catch (erro) {
    console.error('Erro na conferência do ClickUp:', erro.message);
    return res.status(500).json({ error: 'Erro na conferência.' });
  }
}
