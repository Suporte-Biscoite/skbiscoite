// api/lotes.js — cadastro de produtos em lote (1 ou vários): Omie -> Nexaas.
//   GET  ?id=<lote>                  estado de cada item (para o progresso na tela)
//   GET                              últimos cadastros (histórico/auditoria)
//   POST { acao: 'validar', itens }  confere sem gravar nada (pré-visualização linha a linha)
//   POST { acao: 'criar', itens }    grava os itens válidos como pendentes e devolve o lote
//   POST { acao: 'processar', id }   processa pendentes por ~25 s; a tela repete até concluir
//   POST { acao: 'tentar-novamente', id, itemId? }  recoloca só o que falhou (só a etapa que falhou)
import { sql } from './_lib/db.js';
import { exigirUsuario } from './_lib/sessao.js';
import { garantirEsquema } from './_lib/schema.js';
import { garantirCatalogo } from './_lib/catalogo.js';
import { criarLote, estadoDoLote, processarLote, reprocessar, ultimosCadastros, validarLote } from './_lib/cadastros.js';

const LIMITE_ITENS = 500;
const ehUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v));

export default async function handler(req, res) {
  try {
    const usuario = await exigirUsuario(req, res);
    if (!usuario) return;
    await garantirEsquema();

    if (req.method === 'GET') {
      if (!req.query.id) return res.status(200).json(await ultimosCadastros(sql));
      if (!ehUuid(req.query.id)) return res.status(400).json({ error: 'Lote inválido.' });
      return res.status(200).json(await estadoDoLote(sql, req.query.id));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

    const { acao, itens, id, itemId } = req.body || {};

    if (acao === 'validar' || acao === 'criar') {
      if (!Array.isArray(itens) || itens.length === 0) return res.status(400).json({ error: 'Envie ao menos um produto.' });
      if (itens.length > LIMITE_ITENS) return res.status(400).json({ error: `Máximo de ${LIMITE_ITENS} produtos por vez.` });

      // Sem o espelho do catálogo não dá para escolher código nem checar duplicidade.
      const catalogo = await garantirCatalogo(sql);
      if (!catalogo.completo) return res.status(409).json({ precisaSincronizar: true, ...catalogo, error: 'O catálogo do Omie ainda não foi carregado.' });

      if (acao === 'validar') {
        const resultados = await validarLote(sql, itens);
        return res.status(200).json({ itens: resultados.map(({ linha, descricao, erros }) => ({ linha, descricao, erros })) });
      }
      return res.status(201).json(await criarLote(sql, usuario, itens));
    }

    if (!ehUuid(id)) return res.status(400).json({ error: 'Lote inválido.' });
    if (acao === 'processar') return res.status(200).json(await processarLote(sql, id));
    if (acao === 'tentar-novamente') {
      await reprocessar(sql, id, { id: itemId ?? null });
      return res.status(200).json(await estadoDoLote(sql, id));
    }
    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (error) {
    console.error('Erro em /api/lotes:', error.message);
    return res.status(500).json({ error: error.message || 'Erro ao processar o cadastro.' });
  }
}
