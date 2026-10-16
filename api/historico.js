// api/historico.js — auditoria dos SKUs gerados.
// GET lista os 100 mais recentes; POST registra um SKU em nome do usuário logado.
import { sql } from './_lib/db.js';
import { exigirUsuario } from './_lib/sessao.js';

export default async function handler(req, res) {
  try {
    const usuario = await exigirUsuario(req, res);
    if (!usuario) return;

    if (req.method === 'GET') {
      const historico = await sql`SELECT * FROM historico_skus ORDER BY criado_em DESC LIMIT 100`;
      return res.status(200).json(historico);
    }

    if (req.method === 'POST') {
      const { sku, descricao } = req.body || {};
      if (!sku) return res.status(400).json({ error: 'SKU obrigatório.' });
      await sql`INSERT INTO historico_skus (email_usuario, sku, descricao) VALUES (${usuario.email}, ${String(sku)}, ${descricao ?? null})`;
      return res.status(201).json({ success: true });
    }

    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error('Erro no histórico:', error);
    return res.status(500).json({ error: 'Erro ao comunicar com o banco de dados.' });
  }
}
