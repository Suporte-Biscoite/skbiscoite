// api/clickup-webhook.js — recebe os eventos do ClickUp. Confere a assinatura, grava o evento (uma vez só)
// e analisa a tarefa. Não cria nada no Omie. Responde rápido; o que falhar é recuperado pela conferência.
import { sql } from './_lib/db.js';
import { garantirEsquema } from './_lib/schema.js';
import { assinaturaValida, chaveDoEvento, eventoDoRobo } from './_lib/clickup.js';
import { tratarEvento } from './_lib/solicitacoes.js';

// Precisamos do corpo cru para conferir a assinatura (o ClickUp assina os bytes exatos).
export const config = { api: { bodyParser: false } };

async function corpoCru(req) {
  const partes = [];
  for await (const parte of req) partes.push(Buffer.from(parte));
  return Buffer.concat(partes);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  try {
    const cru = await corpoCru(req);
    if (!assinaturaValida(cru, req.headers['x-signature'])) return res.status(401).json({ error: 'Assinatura inválida.' });
    const evento = JSON.parse(cru.toString('utf8'));
    if (eventoDoRobo(evento)) return res.status(200).json({ ok: true, ignorado: 'evento do próprio sistema' });
    await garantirEsquema();
    const r = await tratarEvento(sql, evento, chaveDoEvento(evento));
    return res.status(200).json({ ok: true, ...r });
  } catch (erro) {
    console.error('Erro no webhook do ClickUp:', erro.message);
    return res.status(500).json({ error: 'Erro ao processar o evento.' });
  }
}
