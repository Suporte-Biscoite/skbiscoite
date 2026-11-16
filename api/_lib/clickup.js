// api/_lib/clickup.js — cliente da API do ClickUp (v2). Só roda no servidor.
// O token vem de CLICKUP_API_TOKEN (nunca no código). Respeita o limite de ~100 chamadas/min do plano
// (espaçamento mínimo entre chamadas e espera quando a API responde 429).
import crypto from 'node:crypto';

const BASE = 'https://api.clickup.com/api/v2';
const ESPACO_MINIMO_MS = 700; // ~85 chamadas por minuto, abaixo do limite de 100
let ultimaChamada = 0;
let fila = Promise.resolve();

export class ErroClickUp extends Error {
  constructor(mensagem, status) { super(mensagem); this.name = 'ErroClickUp'; this.status = status; }
}

export const clickupConfigurado = () => !!process.env.CLICKUP_API_TOKEN;
export const listaMonitorada = () => process.env.CLICKUP_LIST_ID || '901107247151'; // Biscoitech > Painel > Tarefas Gerais

async function chamar(metodo, caminho, corpo, tentativa = 1) {
  const token = process.env.CLICKUP_API_TOKEN;
  if (!token) throw new ErroClickUp('CLICKUP_API_TOKEN não configurado no servidor.', 0);
  // Uma chamada por vez, com espaço entre elas.
  const minha = fila.then(async () => {
    const espera = ultimaChamada + ESPACO_MINIMO_MS - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimaChamada = Date.now();
  });
  fila = minha.catch(() => {});
  await minha;

  const resposta = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (resposta.status === 429 && tentativa <= 3) {
    const reset = Number(resposta.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(Math.max(reset, 2000), 15000)));
    return chamar(metodo, caminho, corpo, tentativa + 1);
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new ErroClickUp(dados.err || dados.error || `ClickUp respondeu HTTP ${resposta.status}`, resposta.status);
  return dados;
}

export const buscarTarefa = (id) => chamar('GET', `/task/${encodeURIComponent(id)}?include_markdown_description=true`);

// Tarefas da lista alteradas depois de `desdeMs` (mais antigas primeiro), uma página por chamada.
export const listarTarefasDaLista = (listaId, { desdeMs = 0, pagina = 0 } = {}) =>
  chamar('GET', `/list/${listaId}/task?page=${pagina}&order_by=updated&reverse=true&include_markdown_description=true&subtasks=false${desdeMs ? `&date_updated_gt=${desdeMs}` : ''}`);

export const comentarTarefa = (id, texto) => chamar('POST', `/task/${encodeURIComponent(id)}/comment`, { comment_text: texto, notify_all: false });

// ---- Webhook ----
// O ClickUp assina o corpo cru com HMAC-SHA256 (cabeçalho X-Signature, em hexadecimal).
export function assinaturaValida(corpoCru, assinatura, segredo = process.env.CLICKUP_WEBHOOK_SECRET) {
  if (!segredo || !assinatura) return false;
  const esperada = Buffer.from(crypto.createHmac('sha256', segredo).update(corpoCru).digest('hex'));
  const recebida = Buffer.from(String(assinatura));
  return esperada.length === recebida.length && crypto.timingSafeEqual(esperada, recebida);
}

// Chave única do evento: o mesmo evento reenviado nunca é processado duas vezes.
export function chaveDoEvento(evento) {
  const historico = (evento.history_items || []).map((h) => h.id).join(',');
  const base = historico ? `${evento.event}|${evento.task_id}|${historico}` : JSON.stringify(evento);
  return crypto.createHash('sha256').update(base).digest('hex');
}

// Eventos feitos pelo próprio sistema (usuário do robô) não disparam nada: evita loop.
export function eventoDoRobo(evento) {
  const id = process.env.CLICKUP_BOT_USER_ID;
  return !!id && (evento.history_items || []).some((h) => String(h.user?.id) === String(id));
}
