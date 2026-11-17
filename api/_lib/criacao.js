// api/_lib/criacao.js — da aprovação até o comentário no ClickUp.
//   aprovarECriar: valida (NCM, loja...), marca como aprovada e coloca os itens na MESMA fila do gerador individual (cadastros).
//   avancar:       roda o que falta, uma etapa por vez (Omie -> Nexaas -> comentário -> status). Pode ser repetida à vontade:
//                  cada etapa só age uma vez (o código já criado nunca é criado de novo; o comentário tem trava).
// A aprovação por uma pessoa é a autorização de criar aquela solicitação. O modo "Só analisar" e a pausa
// travam apenas a criação AUTOMÁTICA (sem aprovação), que é a Fase 2.
import { sql as sqlPadrao } from './db.js';
import { criarLote, estadoDoLote, processarLote, reprocessar, validarLote } from './cadastros.js';
import { atualizarStatusTarefa } from './clickup.js';
import { comentarCodigos, detalharSolicitacao, lerConfig } from './solicitacoes.js';
import { obterFamiliaPorPrefixo } from '../../src/lib/familias.js';
import { normalizarNcm } from '../../src/lib/skus.js';
import { lerNcmPadrao } from './ncm.js';
import { PREFIXOS_QUE_ENTRAM_NA_LOJA } from '../../src/lib/regras.js';

const ESTADOS_QUE_PODEM_APROVAR = ['aguardando_analise', 'recebida', 'aprovada'];

// Prefixo que gera o código: o da família (igual ao gerador individual). Faixas antigas gravadas como 7000 caem na família.
export function prefixoParaCriar(s) {
  return obterFamiliaPorPrefixo(s.prefixo_codigo) ? String(s.prefixo_codigo) : s.familia_prefixo;
}

export async function aprovarECriar(sql = sqlPadrao, usuario, id, opcoes = {}) {
  const [s] = await sql`SELECT * FROM solicitacoes WHERE id = ${id}`;
  if (!s) throw new Error('Solicitação não encontrada.');
  if (s.rota === 'alteracao') throw new Error('Este pedido é uma alteração (nome, ativar códigos), não um produto novo: não cria código.');
  if (s.lote_id) return avancar(sql, usuario, id, opcoes); // já foi para a fila: só continua (nunca cria de novo)
  if (!ESTADOS_QUE_PODEM_APROVAR.includes(s.status)) throw new Error('Esta solicitação já foi decidida.');
  const prefixo = prefixoParaCriar(s);
  if (!obterFamiliaPorPrefixo(prefixo)) throw new Error('A família da solicitação não foi reconhecida. Corrija a faixa de código antes de aprovar.');

  const itens = await sql`SELECT id, ordem, descricao, ncm, entra_na_loja FROM solicitacao_itens WHERE solicitacao_id = ${id} AND incluido ORDER BY ordem`;
  if (itens.length === 0) throw new Error('Não há itens para aprovar.');
  // NCM padrão da família (200, 300, 400, 500, 1010): preenche o que está vazio. 700 e 800 não têm padrão: vem da nota.
  const padrao = (await lerNcmPadrao(sql))[prefixo] ?? null;
  for (const i of itens) {
    if (!normalizarNcm(i.ncm) && padrao) i.ncm = padrao;
    i.ncmPadrao = !!padrao && normalizarNcm(i.ncm) === padrao;
  }
  const brutos = itens.map((i) => ({
    linha: i.ordem, descricao: i.descricao, prefixo, ncm: i.ncm,
    entraNaLoja: i.entra_na_loja ?? PREFIXOS_QUE_ENTRAM_NA_LOJA.includes(prefixo), sazonal: false,
  }));
  // Valida ANTES de aprovar: sem NCM, nome repetido no Omie etc. a solicitação continua em análise.
  const resultados = await validarLote(sql, brutos);
  const problemas = resultados.filter((r) => r.erros.length).map((r) => `${r.descricao || `item ${r.linha}`}: ${r.erros.join(' ')}`);
  if (problemas.length) throw new Error(`Não dá para criar ainda. ${problemas.join(' | ')}`);

  for (const [k, i] of itens.entries()) await sql`UPDATE solicitacao_itens SET ncm = ${i.ncm}, ncm_padrao = ${i.ncmPadrao}, descricao = ${resultados[k].item.descricao} WHERE id = ${i.id}`;

  // Trava atômica: duas aprovações ao mesmo tempo nunca criam dois lotes.
  const [trava] = await sql`UPDATE solicitacoes SET status = 'na_fila', na_fila_em = now(), decidido_por = COALESCE(decidido_por, ${usuario.email}), decidido_em = COALESCE(decidido_em, now()), atualizado_em = now()
    WHERE id = ${id} AND lote_id IS NULL AND status = ANY(${ESTADOS_QUE_PODEM_APROVAR}) AND na_fila_em IS NULL RETURNING id`;
  if (!trava) return avancar(sql, usuario, id, opcoes);
  try {
    const lote = await criarLote(sql, usuario, brutos);
    if (!lote.lote_id || lote.criados !== itens.length) throw new Error('Nem todos os itens entraram na fila.');
    await sql`UPDATE solicitacoes SET lote_id = ${lote.lote_id}::uuid WHERE id = ${id}`;
    const cadastros = await sql`SELECT id, linha FROM cadastros WHERE lote_id = ${lote.lote_id}::uuid`;
    for (const c of cadastros) await sql`UPDATE solicitacao_itens SET cadastro_id = ${c.id}, status = 'na_fila' WHERE solicitacao_id = ${id} AND ordem = ${c.linha}`;
    await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, ${usuario.email}, 'aprovada', ${JSON.stringify({ itens: itens.length, prefixo })}::jsonb)`;
  } catch (erro) {
    await sql`UPDATE solicitacoes SET status = ${s.status}, na_fila_em = NULL WHERE id = ${id} AND lote_id IS NULL`;
    throw erro;
  }
  return avancar(sql, usuario, id, opcoes);
}

// Uma rodada. A tela chama de novo enquanto houver trabalho e nenhum erro.
export async function avancar(sql = sqlPadrao, usuario, id, { orcamentoMs = 20000, enviarComentario, atualizarStatus = atualizarStatusTarefa } = {}) {
  const [s] = await sql`SELECT * FROM solicitacoes WHERE id = ${id}`;
  if (!s) throw new Error('Solicitação não encontrada.');
  if (!s.lote_id) throw new Error('Esta solicitação ainda não foi aprovada para criação.');

  const config = await lerConfig(sql);
  let estado = await estadoDoLote(sql, s.lote_id);
  if (!estado.concluido) {
    await sql`UPDATE solicitacoes SET status = 'processando', atualizado_em = now() WHERE id = ${id} AND status = 'na_fila'`;
    estado = await processarLote(sql, s.lote_id, { orcamentoMs, concorrencia: 1, esperaEntreRodadasMs: Math.max(0, Number(config.espacoEntreItensSeg) || 0) * 1000 });
  }
  // Guarda o código em cada item assim que o Omie confirma.
  const cadastros = await sql`SELECT id, codigo, omie_status, nexaas_status FROM cadastros WHERE lote_id = ${s.lote_id}`;
  for (const c of cadastros.filter((x) => x.omie_status === 'ok' && x.codigo)) {
    await sql`UPDATE solicitacao_itens SET codigo_gerado = ${c.codigo}, status = 'codigo_gerado' WHERE cadastro_id = ${c.id} AND codigo_gerado IS DISTINCT FROM ${c.codigo}`;
  }
  const todosOk = cadastros.length > 0 && cadastros.every((c) => c.omie_status === 'ok' && c.nexaas_status === 'ok');
  if (todosOk) {
    await sql`UPDATE solicitacoes SET codigos_em = COALESCE(codigos_em, now()) WHERE id = ${id}`;
    const opcoesComentario = enviarComentario ? { enviar: enviarComentario } : {};
    const [atual] = await sql`SELECT comentado_em, comentario_erro, status_atualizado_em, status_erro FROM solicitacoes WHERE id = ${id}`;
    if (!atual.comentado_em && !atual.comentario_erro) await comentarCodigos(sql, id, opcoesComentario);
    await atualizarStatusDaTarefa(sql, id, { atualizarStatus });
  }
  await fecharSeCompleta(sql, id);
  return detalharSolicitacao(sql, id);
}

// Atualiza o status da tarefa no ClickUp (só se CLICKUP_STATUS_CONCLUIDO estiver definido). Uma vez só.
export async function atualizarStatusDaTarefa(sql, id, { atualizarStatus = atualizarStatusTarefa } = {}) {
  const status = process.env.CLICKUP_STATUS_CONCLUIDO;
  const [s] = await sql`SELECT clickup_task_id, comentado_em, status_atualizado_em, origem FROM solicitacoes WHERE id = ${id}`;
  if (!status || !s?.comentado_em || s.status_atualizado_em || (s.origem === 'teste' && atualizarStatus === atualizarStatusTarefa)) return { atualizado: false };
  const [trava] = await sql`UPDATE solicitacoes SET status_atualizado_em = now(), status_erro = NULL WHERE id = ${id} AND status_atualizado_em IS NULL RETURNING id`;
  if (!trava) return { atualizado: true };
  try {
    await atualizarStatus(s.clickup_task_id, status);
    await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, 'sistema', 'status-atualizado', ${JSON.stringify({ status })}::jsonb)`;
    return { atualizado: true };
  } catch (erro) {
    const msg = String(erro.message).slice(0, 300);
    await sql`UPDATE solicitacoes SET status_atualizado_em = NULL, status_erro = ${msg} WHERE id = ${id}`;
    await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, 'sistema', 'status-falhou', ${JSON.stringify({ erro: msg })}::jsonb)`;
    return { atualizado: false, erro: msg };
  }
}

// Concluída = códigos criados + comentário enviado (+ status atualizado, quando configurado).
async function fecharSeCompleta(sql, id) {
  await sql`UPDATE solicitacoes SET status = 'concluida', atualizado_em = now()
    WHERE id = ${id} AND status IN ('na_fila', 'processando') AND comentado_em IS NOT NULL
      AND (status_atualizado_em IS NOT NULL OR ${!process.env.CLICKUP_STATUS_CONCLUIDO})`;
}

// "Tentar de novo" numa etapa. Repetir nunca duplica: criação só refaz o que falhou; comentário confere antes; status é uma vez.
export async function tentarDeNovo(sql = sqlPadrao, usuario, id, etapa, opcoes = {}) {
  const [s] = await sql`SELECT lote_id FROM solicitacoes WHERE id = ${id}`;
  if (!s?.lote_id) throw new Error('Esta solicitação ainda não foi aprovada para criação.');
  if (etapa === 'omie' || etapa === 'nexaas' || etapa === 'criacao') await reprocessar(sql, s.lote_id);
  if (etapa === 'comentario') {
    // Só reenvia se ainda não foi enviado; conferindo antes os comentários da tarefa (comentarCodigos faz isso quando há erro anterior).
    await sql`UPDATE solicitacoes SET comentado_em = NULL, comentario_erro = COALESCE(comentario_erro, 'Nova tentativa.') WHERE id = ${id} AND comentado_em IS NULL`;
    await comentarCodigos(sql, id, opcoes.enviarComentario ? { enviar: opcoes.enviarComentario } : {});
  }
  if (etapa === 'status') await sql`UPDATE solicitacoes SET status_erro = NULL WHERE id = ${id}`;
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, ${usuario.email}, 'tentar-de-novo', ${JSON.stringify({ etapa })}::jsonb)`;
  return avancar(sql, usuario, id, opcoes);
}
