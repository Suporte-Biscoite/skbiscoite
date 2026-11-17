// api/solicitacoes.js — tela "Solicitações" (só time autorizado): analisa, edita, aprova (cria os códigos) ou recusa.
//   GET                      lista (filtros: status, busca, sugestao)
//   GET ?id=<n>              detalhe (itens, motivos, histórico)
//   GET ?config=1            configuração (modo, pausa, limites)
//   POST { acao: 'editar', id, itens, prefixoCodigo } | 'aprovar' (cria) | 'avancar' (continua a criação) | 'tentar-de-novo' (etapa) | 'recusar' (motivo) | 'reanalisar'
//   POST { acao: 'conferir' }              busca no ClickUp o que o webhook perdeu
//   POST { acao: 'config', ... }           pausa, modo (analisar|simulacao), limite de itens, intervalo
import { sql } from './_lib/db.js';
import { exigirUsuario } from './_lib/sessao.js';
import { garantirEsquema } from './_lib/schema.js';
import { clickupConfigurado } from './_lib/clickup.js';
import { lerNotaDaSolicitacao } from './_lib/nota.js';
import { gravarNcmPadrao, lerNcmPadrao, listarParaRevisarNcm, revisarNcm } from './_lib/ncm.js';
import { aprovarECriar, avancar, tentarDeNovo } from './_lib/criacao.js';
import { conferirLista, decidir, detalharSolicitacao, editarItens, gravarConfig, lerConfig, listarSolicitacoes, reanalisar } from './_lib/solicitacoes.js';

const SETORES = (process.env.SOLICITACOES_SETORES || 'TI').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

export default async function handler(req, res) {
  try {
    const usuario = await exigirUsuario(req, res);
    if (!usuario) return;
    if (!SETORES.includes(String(usuario.setor || '').toUpperCase())) return res.status(403).json({ error: 'Seu setor não tem acesso às solicitações.' });
    await garantirEsquema();

    if (req.method === 'GET') {
      if (req.query.ncm) return res.status(200).json({ padrao: await lerNcmPadrao(sql), revisar: await listarParaRevisarNcm(sql) });
      if (req.query.config) return res.status(200).json({ ...(await lerConfig(sql)), clickupConfigurado: clickupConfigurado() });
      if (req.query.id) {
        const id = Number(req.query.id);
        const s = Number.isInteger(id) ? await detalharSolicitacao(sql, id) : null;
        return s ? res.status(200).json(s) : res.status(404).json({ error: 'Solicitação não encontrada.' });
      }
      return res.status(200).json(await listarSolicitacoes(sql, { status: String(req.query.status || ''), busca: String(req.query.busca || ''), sugestao: String(req.query.sugestao || '') }));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

    const { acao, id, itens, prefixoCodigo, motivo, ...mudancas } = req.body || {};
    if (acao === 'config') return res.status(200).json(await gravarConfig(sql, usuario, mudancas));
    if (acao === 'ncm-padrao') return res.status(200).json(await gravarNcmPadrao(sql, usuario, req.body.padrao));
    if (acao === 'ncm-revisar') return res.status(200).json(await revisarNcm(sql, usuario, Number(req.body.itemId), req.body.ncm));
    if (acao === 'conferir') {
      if (!clickupConfigurado()) return res.status(409).json({ error: 'O token do ClickUp ainda não foi configurado no servidor (CLICKUP_API_TOKEN).' });
      return res.status(200).json(await conferirLista(sql));
    }
    const n = Number(id);
    if (!Number.isInteger(n)) return res.status(400).json({ error: 'Solicitação inválida.' });
    if (acao === 'ler-nota') {
      if (!clickupConfigurado()) return res.status(409).json({ error: 'O token do ClickUp ainda não foi configurado no servidor (CLICKUP_API_TOKEN).' });
      const leitura = await lerNotaDaSolicitacao(sql, usuario, n);
      return res.status(200).json({ ...(await detalharSolicitacao(sql, n)), leitura });
    }
    if (acao === 'editar') { await editarItens(sql, usuario, n, { itens, prefixoCodigo }); return res.status(200).json(await detalharSolicitacao(sql, n)); }
    // Aprovar = autorizar a criação desta solicitação (vale mesmo no modo 'Só analisar'); cria na mesma fila do gerador individual.
    if (acao === 'aprovar') return res.status(200).json(await aprovarECriar(sql, usuario, n));
    if (acao === 'avancar') return res.status(200).json(await avancar(sql, usuario, n));
    if (acao === 'tentar-de-novo') return res.status(200).json(await tentarDeNovo(sql, usuario, n, String(req.body.etapa || 'criacao')));
    if (acao === 'recusar') { await decidir(sql, usuario, n, { aprovar: false, motivo }); return res.status(200).json(await detalharSolicitacao(sql, n)); }
    if (acao === 'reanalisar') {
      if (!clickupConfigurado()) return res.status(409).json({ error: 'O token do ClickUp ainda não foi configurado no servidor (CLICKUP_API_TOKEN).' });
      await reanalisar(sql, usuario, n);
      return res.status(200).json(await detalharSolicitacao(sql, n));
    }
    return res.status(400).json({ error: 'Ação desconhecida.' });
  } catch (erro) {
    console.error('Erro em /api/solicitacoes:', erro.message);
    return res.status(400).json({ error: erro.message || 'Erro ao processar.' });
  }
}
