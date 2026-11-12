// api/importar.js — traz para o Nexaas produtos que já existem no Omie.
//   POST { acao: 'analisar', codigos }   só confere (Omie + Nexaas) e mostra o que seria feito
//   POST { acao: 'importar', codigos }   cria no Nexaas os que ainda não existem lá
// A tela manda poucos códigos por vez (LIMITE_CODIGOS_POR_CHAMADA) para mostrar o progresso.
import { sql } from './_lib/db.js';
import { exigirUsuario } from './_lib/sessao.js';
import { garantirEsquema } from './_lib/schema.js';
import { analisarCodigos, importarCodigos, LIMITE_CODIGOS_POR_CHAMADA, normalizarCodigos } from './_lib/importacao.js';

export default async function handler(req, res) {
  try {
    const usuario = await exigirUsuario(req, res);
    if (!usuario) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
    const { acao, codigos } = req.body || {};
    const lista = normalizarCodigos(codigos);
    if (lista.length === 0) return res.status(400).json({ error: 'Informe ao menos um código.' });
    if (lista.length > LIMITE_CODIGOS_POR_CHAMADA) return res.status(400).json({ error: `Máximo de ${LIMITE_CODIGOS_POR_CHAMADA} códigos por chamada.` });
    await garantirEsquema();
    if (acao === 'analisar') return res.status(200).json({ itens: await analisarCodigos(sql, lista) });
    if (acao === 'importar') return res.status(200).json({ itens: await importarCodigos(sql, usuario, lista) });
    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (error) {
    console.error('Erro em /api/importar:', error.message);
    return res.status(500).json({ error: error.message || 'Erro ao importar.' });
  }
}
