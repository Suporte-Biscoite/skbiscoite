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
import { processarFilaAutomatica } from './_lib/automatico.js';

import { aprovarECriar, avancar, tentarDeNovo } from './_lib/criacao.js';
import { aplicarCorrecao, correcaoAtiva, desfazerCorrecao, listarCorrecoes, listarSuspeitos, proporCorrecao } from './_lib/correcao.js';
import { sugerirNomesDaSolicitacao } from './_lib/nome-ia.js';
import { conferirFamiliaDaSolicitacao, conferirLista, contarEmAberto, decidir, detalharSolicitacao, editarItens, gravarConfig, lerConfig, listarSolicitacoes, reanalisar, resumoDeHoje, buscaGlobal } from './_lib/solicitacoes.js';

const SETORES = (process.env.SOLICITACOES_SETORES || 'TI').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

export default async function handler(req, res) {
  try {
    const usuario = await exigirUsuario(req, res);
    if (!usuario) return;
    if (!SETORES.includes(String(usuario.setor || '').toUpperCase())) return res.status(403).json({ error: 'Seu setor não tem acesso às solicitações.' });
    await garantirEsquema();

    if (req.method === 'GET') {
      if (req.query.ncm) return res.status(200).json({ padrao: await lerNcmPadrao(sql), revisar: await listarParaRevisarNcm(sql) });
      if (req.query.correcoes) return res.status(200).json({ ativa: correcaoAtiva(), lista: await listarCorrecoes(sql), suspeitos: await listarSuspeitos(sql, { busca: String(req.query.busca || '').trim() }) });
      if (req.query.busca_global !== undefined) return res.status(200).json(await buscaGlobal(sql, String(req.query.busca_global)));
      if (req.query.hoje) return res.status(200).json(await resumoDeHoje(sql));
      if (req.query.contagem) return res.status(200).json(await contarEmAberto(sql));
      if (req.query.config) return res.status(200).json({ ...(await lerConfig(sql)), clickupConfigurado: clickupConfigurado() });
      if (req.query.id) {
        const id = Number(req.query.id);
        const s = Number.isInteger(id) ? await detalharSolicitacao(sql, id) : null;
        return s ? res.status(200).json(s) : res.status(404).json({ error: 'Solicitação não encontrada.' });
      }
      return res.status(200).json(await listarSolicitacoes(sql, { status: String(req.query.status || ''), busca: String(req.query.busca || ''), sugestao: String(req.query.sugestao || ''), tipo: String(req.query.tipo || 'cadastro') }));
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });

    const { acao, id, itens, prefixoCodigo, motivo, ...mudancas } = req.body || {};
    if (acao === 'config') return res.status(200).json(await gravarConfig(sql, usuario, mudancas));
    if (acao === 'ncm-padrao') return res.status(200).json(await gravarNcmPadrao(sql, usuario, req.body.padrao));
    if (acao === 'ncm-revisar') return res.status(200).json(await revisarNcm(sql, usuario, Number(req.body.itemId), req.body.ncm));
    // Correção de cadastro antigo: NUNCA automática. Propor só lê; aplicar e desfazer exigem uma pessoa e OMIE_CORRECAO_ATIVA=1.
    if (acao === 'correcao-propor') return res.status(200).json(await proporCorrecao(sql, usuario, req.body.codigo, { solicitacaoId: Number(req.body.solicitacaoId) || null }));
    if (acao === 'correcao-aplicar') return res.status(200).json(await aplicarCorrecao(sql, usuario, Number(req.body.correcaoId), { confirmouConferencia: req.body.confirmouConferencia === true }));
    if (acao === 'correcao-desfazer') return res.status(200).json(await desfazerCorrecao(sql, usuario, Number(req.body.correcaoId)));
    if (acao === 'conferir') {
      if (!clickupConfigurado()) return res.status(409).json({ error: 'O token do ClickUp ainda não foi configurado no servidor (CLICKUP_API_TOKEN).' });
      const lista = await conferirLista(sql);
      const automatico = await processarFilaAutomatica(sql).catch((erro) => ({ erro: String(erro.message).slice(0, 200) }));
      return res.status(200).json({ ...lista, automatico });
    }
    const n = Number(id);
    if (!Number.isInteger(n)) return res.status(400).json({ error: 'Solicitação inválida.' });
    if (acao === 'ler-nota') {
      if (!clickupConfigurado()) return res.status(409).json({ error: 'O token do ClickUp ainda não foi configurado no servidor (CLICKUP_API_TOKEN).' });
      const leitura = await lerNotaDaSolicitacao(sql, usuario, n);
      return res.status(200).json({ ...(await detalharSolicitacao(sql, n)), leitura });
    }
    if (acao === 'sugerir-nomes') {
      if (!process.env.OPENAI_API_KEY) return res.status(409).json({ error: 'A chave da IA (OPENAI_API_KEY) não está configurada.' });
      const leitura = await sugerirNomesDaSolicitacao(sql, usuario, n);
      return res.status(200).json({ ...(await detalharSolicitacao(sql, n)), leituraNomes: leitura });
    }
    if (acao === 'conferir-familia') {
      if (!process.env.OPENAI_API_KEY) return res.status(409).json({ error: 'A chave da IA (OPENAI_API_KEY) não está configurada.' });
      await conferirFamiliaDaSolicitacao(sql, n);
      return res.status(200).json(await detalharSolicitacao(sql, n));
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
