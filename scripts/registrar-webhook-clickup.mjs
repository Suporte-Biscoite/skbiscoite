// Registra o webhook no ClickUp (AÇÃO EXTERNA: só rode com autorização). Uso:
//   node --env-file=.env.local scripts/registrar-webhook-clickup.mjs <TEAM_ID> <URL_PUBLICA>/api/clickup-webhook
// O ClickUp devolve um "secret" UMA vez: copie para a variável CLICKUP_WEBHOOK_SECRET (Vercel e .env.local).
import { listaMonitorada } from '../api/_lib/clickup.js';

const [teamId, endpoint] = process.argv.slice(2);
if (!teamId || !endpoint || !process.env.CLICKUP_API_TOKEN) { console.error('Uso: <TEAM_ID> <URL do webhook>; CLICKUP_API_TOKEN precisa estar definido.'); process.exit(1); }
const r = await fetch(`https://api.clickup.com/api/v2/team/${teamId}/webhook`, {
  method: 'POST',
  headers: { Authorization: process.env.CLICKUP_API_TOKEN, 'Content-Type': 'application/json' },
  body: JSON.stringify({ endpoint, events: ['taskCreated', 'taskUpdated'], list_id: Number(listaMonitorada()) }),
});
const d = await r.json();
if (!r.ok) { console.error('Falhou:', d.err || d); process.exit(1); }
console.log('Webhook criado, id:', d.id, '\nSecret (guarde agora, só aparece uma vez):', d.webhook?.secret);
