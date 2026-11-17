// api/_lib/solicitacoes.js — solicitações vindas do ClickUp (Fase 1: SÓ ANALISAR, nada é criado no Omie).
// Fluxo: evento/tarefa -> lerTarefaClickUp -> analisarSolicitacao -> grava solicitação + itens (idempotente).
import crypto from 'node:crypto';
import { sql as sqlPadrao } from './db.js';
import { lerEstado, gravarEstado } from './catalogo.js';
import { CONFIG_PADRAO, analisarSolicitacao, lerTarefaClickUp, prepararCatalogo } from '../../src/lib/solicitacoes.js';
import { obterFamiliaPorPrefixo } from '../../src/lib/familias.js';
import { lerNcmPadrao } from './ncm.js';
import { padronizarNome } from '../../src/lib/regras.js';
import { buscarTarefa, comentarTarefa, listarComentarios, listasMonitoradas, listarTarefasDaLista } from './clickup.js';

// ---------- Configuração (guardada no banco; botão de pausa e modo) ----------
export async function lerConfig(sql = sqlPadrao) {
  const guardado = (await lerEstado(sql, 'automacao_clickup')) || {};
  const { _atualizado_em: _ignorado, ...resto } = guardado;
  return { ...CONFIG_PADRAO, ...resto, comentarNoClickUp: process.env.CLICKUP_COMENTAR === '1' };
}

export async function gravarConfig(sql, usuario, mudancas) {
  const atual = await lerConfig(sql);
  const novo = { ...atual };
  if ('pausado' in mudancas) novo.pausado = !!mudancas.pausado;
  if ('modo' in mudancas) {
    if (!['analisar', 'simulacao', 'automatico'].includes(mudancas.modo)) throw new Error('Modo inválido.');
    novo.modo = mudancas.modo;
  }
  const inteiro = (v, min, max, nome) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nome} deve ser um número inteiro entre ${min} e ${max}.`); return n; };
  if ('limiteItensAuto' in mudancas) novo.limiteItensAuto = inteiro(mudancas.limiteItensAuto, 1, 100, 'Limite de itens');
  if ('limiteAutoPorDia' in mudancas) novo.limiteAutoPorDia = inteiro(mudancas.limiteAutoPorDia, 1, 500, 'Limite por dia');
  if ('intervaloMinutos' in mudancas) novo.intervaloMinutos = inteiro(mudancas.intervaloMinutos, 1, 240, 'Intervalo');
  const { comentarNoClickUp: _c, ...gravar } = novo;
  await gravarEstado(sql, 'automacao_clickup', gravar);
  await sql`INSERT INTO solicitacoes_log (usuario, acao, detalhe) VALUES (${usuario.email}, 'config', ${JSON.stringify(mudancas)}::jsonb)`;
  return novo;
}

async function catalogoDoOmie(sql) {
  const linhas = await sql`SELECT codigo, descricao FROM omie_produtos WHERE inativo = false AND length(descricao) > 0`;
  return prepararCatalogo(linhas);
}

const hashDoConteudo = (t) => crypto.createHash('sha256').update(JSON.stringify([t.titulo, t.descricao, t.familiaCampo, t.tipoIdentificacao])).digest('hex');

// Mudança de status no ClickUp: finalizada/cancelada tira a solicitação da fila; reaberta volta para análise.
async function sincronizarStatus(sql, existente, t) {
  const editavel = ['recebida', 'aguardando_analise'].includes(existente.status);
  if (existente.status_clickup !== t.statusClickUp) await sql`UPDATE solicitacoes SET status_clickup = ${t.statusClickUp}, atualizado_clickup = ${t.atualizadoEm}, atualizado_em = now() WHERE id = ${existente.id}`;
  if (t.encerramento && editavel) {
    const novo = t.encerramento === 'cancelada' ? 'cancelada_clickup' : 'finalizada_clickup';
    await sql`UPDATE solicitacoes SET status = ${novo}, encerrada_em = now(), atualizado_em = now() WHERE id = ${existente.id}`;
    await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${existente.id}, 'sistema', ${novo}, ${JSON.stringify({ statusClickUp: t.statusClickUp })}::jsonb)`;
    return { resultado: 'encerrada', id: existente.id };
  }
  if (!t.encerramento && ['finalizada_clickup', 'cancelada_clickup'].includes(existente.status)) {
    await sql`UPDATE solicitacoes SET status = 'aguardando_analise', hash_conteudo = NULL, encerrada_em = NULL WHERE id = ${existente.id}`;
    await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${existente.id}, 'sistema', 'reaberta', ${JSON.stringify({ statusClickUp: t.statusClickUp })}::jsonb)`;
    existente.status = 'aguardando_analise';
    existente.hash_conteudo = null;
  }
  return null;
}

// ---------- Entrada de uma tarefa (idempotente) ----------
// Devolve { resultado: 'nova'|'atualizada'|'sem-mudanca'|'ignorada'|'travada', id }.
export async function receberTarefa(sql, tarefaApi, { origem = 'clickup', catalogo = null } = {}) {
  const t = lerTarefaClickUp(tarefaApi);
  if (!t.ehCadastro) return { resultado: 'ignorada', motivo: 'Não é do formulário de cadastro.' };

  const hash = hashDoConteudo(t);
  const [existente] = await sql`SELECT id, status, hash_conteudo, editado, status_clickup FROM solicitacoes WHERE clickup_task_id = ${t.taskId}`;
  if (!existente && t.encerramento) return { resultado: 'ignorada', motivo: 'Tarefa já encerrada no ClickUp.' };
  if (existente) {
    const r = await sincronizarStatus(sql, existente, t);
    if (r) return r;
  }
  if (existente && existente.hash_conteudo === hash) return { resultado: 'sem-mudanca', id: existente.id };
  // Depois de aprovada/recusada/processada, mudar o texto no ClickUp não mexe mais na solicitação.
  if (existente && !['recebida', 'aguardando_analise'].includes(existente.status)) return { resultado: 'travada', id: existente.id };

  const config = await lerConfig(sql);
  const analise = analisarSolicitacao(t, catalogo ?? (await catalogoDoOmie(sql)), config);

  // Mesmo produto pedido em OUTRA solicitação ainda viva (não recusada): avisa, para nunca criar duas vezes.
  const nomes = analise.itens.map((i) => i.descricao);
  if (nomes.length) {
    const outras = await sql`SELECT DISTINCT i.descricao, s.id FROM solicitacao_itens i JOIN solicitacoes s ON s.id = i.solicitacao_id
      WHERE s.clickup_task_id <> ${t.taskId} AND s.status <> 'recusada' AND i.incluido AND i.descricao = ANY(${nomes})`;
    for (const item of analise.itens) {
      const outra = outras.find((o) => o.descricao === item.descricao);
      if (outra) item.avisos.push(`Também está na solicitação #${outra.id}.`);
    }
    if (outras.length && !analise.motivos.some((m) => m.startsWith('Produto repetido'))) { analise.motivos.push('Produto repetido em outra solicitação em aberto.'); analise.sugestao = 'analise'; }
  }

  let id = existente?.id;
  if (existente?.editado) {
    // Alguém do time já editou os itens: não apagamos o trabalho dele; só registramos que o texto mudou.
    await sql`UPDATE solicitacoes SET hash_conteudo = ${hash}, atualizado_clickup = ${t.atualizadoEm}, motivos = motivos || ${JSON.stringify(['O texto da tarefa mudou no ClickUp depois da edição. Confira os itens.'])}::jsonb, atualizado_em = now() WHERE id = ${id}`;
    return { resultado: 'atualizada', id };
  }
  const motivos = JSON.stringify(analise.motivos);
  if (existente) {
    await sql`UPDATE solicitacoes SET titulo = ${t.titulo}, url = ${t.url}, status = 'aguardando_analise', sugestao = ${analise.sugestao}, rota = ${analise.rota}, motivos = ${motivos}::jsonb,
      familia_campo = ${t.familiaCampo}, tipo_identificacao = ${t.tipoIdentificacao}, solicitante = ${t.solicitante}, faixa = ${analise.faixa}, familia_prefixo = ${analise.familiaPrefixo}, prefixo_codigo = ${analise.prefixoCodigo},
      status_clickup = ${t.statusClickUp}, atualizado_clickup = ${t.atualizadoEm}, hash_conteudo = ${hash}, atualizado_em = now() WHERE id = ${id}`;
    await sql`DELETE FROM solicitacao_itens WHERE solicitacao_id = ${id}`;
  } else {
    const [nova] = await sql`INSERT INTO solicitacoes (clickup_task_id, titulo, url, status, sugestao, rota, motivos, familia_campo, tipo_identificacao, solicitante, faixa, familia_prefixo, prefixo_codigo, status_clickup, atualizado_clickup, hash_conteudo, origem)
      VALUES (${t.taskId}, ${t.titulo}, ${t.url}, 'aguardando_analise', ${analise.sugestao}, ${analise.rota}, ${motivos}::jsonb, ${t.familiaCampo}, ${t.tipoIdentificacao}, ${t.solicitante}, ${analise.faixa}, ${analise.familiaPrefixo}, ${analise.prefixoCodigo}, ${t.statusClickUp}, ${t.atualizadoEm}, ${hash}, ${origem})
      ON CONFLICT (clickup_task_id) DO NOTHING RETURNING id`;
    if (!nova) return { resultado: 'sem-mudanca' }; // outra chamada ao mesmo tempo já gravou
    id = nova.id;
  }
  for (const [ordem, item] of analise.itens.entries()) {
    await sql`INSERT INTO solicitacao_itens (solicitacao_id, ordem, linha, original, descricao, avisos, parecidos, codigo_existente)
      VALUES (${id}, ${ordem + 1}, ${item.linha}, ${item.original}, ${item.descricao}, ${JSON.stringify(item.avisos)}::jsonb, ${JSON.stringify(item.parecidos || [])}::jsonb, ${item.codigoExistente})`;
  }
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, 'sistema', ${existente ? 'reanalisada' : 'recebida'}, ${JSON.stringify({ itens: analise.itens.length, sugestao: analise.sugestao })}::jsonb)`;
  return { resultado: existente ? 'atualizada' : 'nova', id };
}

// ---------- Webhook: grava o evento (uma vez) e analisa a tarefa ----------
export async function tratarEvento(sql, evento, chave) {
  const [novo] = await sql`INSERT INTO clickup_eventos (chave, task_id, evento) VALUES (${chave}, ${evento.task_id ?? null}, ${evento.event ?? null}) ON CONFLICT (chave) DO NOTHING RETURNING id`;
  if (!novo) return { resultado: 'duplicado' }; // o mesmo evento chegou de novo: nada a fazer
  let resultado;
  try {
    if (!evento.task_id) resultado = 'sem-tarefa';
    else {
      const r = await receberTarefa(sql, await buscarTarefa(evento.task_id));
      resultado = r.resultado;
    }
  } catch (erro) {
    resultado = `erro: ${erro.message}`.slice(0, 200); // a conferência periódica tenta de novo
  }
  await sql`UPDATE clickup_eventos SET resultado = ${resultado} WHERE id = ${novo.id}`;
  return { resultado };
}

// ---------- Conferência periódica: recupera o que o webhook perdeu ----------
export async function conferirLista(sql, { maximoPaginas = 3 } = {}) {
  const catalogo = await catalogoDoOmie(sql);
  const resumo = { lidas: 0, novas: 0, atualizadas: 0, ignoradas: 0, encerradas: 0 };
  for (const listaId of listasMonitoradas()) {
    // Cada lista tem o seu cursor (a mais recente já lida).
    const chaveCursor = `clickup_cursor_${listaId}`;
    const cursor = (await lerEstado(sql, chaveCursor))?.ate ?? 0;
    let maiorData = cursor;
    for (let pagina = 0; pagina < maximoPaginas; pagina++) {
      const r = await listarTarefasDaLista(listaId, { desdeMs: cursor, pagina });
      for (const tarefa of r.tasks || []) {
        resumo.lidas++;
        maiorData = Math.max(maiorData, Number(tarefa.date_updated) || 0);
        const x = await receberTarefa(sql, tarefa, { catalogo });
        if (x.resultado === 'nova') resumo.novas++;
        else if (x.resultado === 'atualizada') resumo.atualizadas++;
        else if (x.resultado === 'ignorada') resumo.ignoradas++;
        else if (x.resultado === 'encerrada') resumo.encerradas++;
      }
      if (r.last_page !== false) break;
    }
    // Recua 1 minuto no cursor para nunca perder tarefa alterada na virada.
    if (maiorData > cursor) await gravarEstado(sql, chaveCursor, { ate: maiorData - 60000 });
  }
  return resumo;
}

// ---------- Tela: listar, detalhar, editar, aprovar, recusar ----------
export async function listarSolicitacoes(sql, { status = '', busca = '', sugestao = '' } = {}) {
  const b = `%${busca.trim()}%`;
  return sql`SELECT s.id, s.clickup_task_id, s.titulo, s.url, s.status, s.sugestao, s.rota, s.motivos, s.solicitante, s.familia_campo, s.prefixo_codigo, s.origem, s.status_clickup, s.comentado_em, s.auto_motivo, s.recebido_em, s.decidido_em, s.decidido_por,
      (SELECT count(*) FROM solicitacao_itens i WHERE i.solicitacao_id = s.id AND i.incluido) AS itens
    FROM solicitacoes s
    WHERE (CASE WHEN ${status} = '' THEN s.status NOT IN ('finalizada_clickup', 'cancelada_clickup', 'concluida')
        WHEN ${status} = 'encerradas' THEN s.status IN ('finalizada_clickup', 'cancelada_clickup', 'concluida') ELSE s.status = ${status} END) AND (${sugestao} = '' OR s.sugestao = ${sugestao}) AND (${busca.trim()} = '' OR s.titulo ILIKE ${b} OR s.solicitante ILIKE ${b})
    ORDER BY s.recebido_em DESC LIMIT 200`;
}

export async function detalharSolicitacao(sql, id) {
  const [s] = await sql`SELECT * FROM solicitacoes WHERE id = ${id}`;
  if (!s) return null;
  const itens = await sql`SELECT id, ordem, linha, original, descricao, avisos, parecidos, codigo_existente, incluido, codigo_gerado, status, ncm, entra_na_loja, ncm_padrao, ncm_revisado_em, ncm_sugerido, ncm_fonte FROM solicitacao_itens WHERE solicitacao_id = ${id} ORDER BY ordem`;
  const historico = await sql`SELECT usuario, acao, detalhe, em FROM solicitacoes_log WHERE solicitacao_id = ${id} ORDER BY em DESC LIMIT 50`;
  const cadastros = s.lote_id ? await sql`SELECT id, linha, descricao, codigo, omie_status, omie_erro, nexaas_status, nexaas_erro, atualizado_em FROM cadastros WHERE lote_id = ${s.lote_id} ORDER BY id` : [];
  const padroes = await lerNcmPadrao(sql);
  return { ...s, itens, historico, cadastros, etapas: montarEtapas(s, cadastros), ncmPadraoDaFamilia: padroes[s.prefixo_codigo] ?? padroes[s.familia_prefixo] ?? null, statusConcluido: process.env.CLICKUP_STATUS_CONCLUIDO || null };
}

const ESTADOS_EDITAVEIS = ['aguardando_analise', 'recebida'];
const HONRAR_PREFIXO = (p) => (obterFamiliaPorPrefixo(p) ? String(p) : null);

export async function editarItens(sql, usuario, id, { itens, prefixoCodigo }) {
  const [s] = await sql`SELECT status, lote_id FROM solicitacoes WHERE id = ${id}`;
  if (!s) throw new Error('Solicitação não encontrada.');
  // Aprovada que ainda não foi para a fila (nada criado) também pode ser ajustada (ex.: preencher o NCM).
  if (!ESTADOS_EDITAVEIS.includes(s.status) && !(s.status === 'aprovada' && !s.lote_id)) throw new Error('Esta solicitação já foi decidida e não pode mais ser editada.');
  if (!Array.isArray(itens) || itens.length > 200) throw new Error('Lista de itens inválida.');
  await sql`DELETE FROM solicitacao_itens WHERE solicitacao_id = ${id}`;
  let ordem = 0;
  for (const item of itens) {
    const descricao = padronizarNome(item.descricao);
    if (!descricao) continue;
    if (descricao.length > 120) throw new Error(`"${descricao.slice(0, 30)}…" passa de 120 caracteres.`);
    ordem += 1;
    const ncm = String(item.ncm ?? '').replace(/\D/g, '') || null;
    const entra = typeof item.entra_na_loja === 'boolean' ? item.entra_na_loja : null;
    await sql`INSERT INTO solicitacao_itens (solicitacao_id, ordem, linha, original, descricao, avisos, parecidos, codigo_existente, incluido, ncm, entra_na_loja, codigo_gerado, cadastro_id)
      VALUES (${id}, ${ordem}, ${item.linha ?? null}, ${item.original ?? null}, ${descricao}, ${JSON.stringify(item.avisos || [])}::jsonb, ${JSON.stringify(item.parecidos || [])}::jsonb, ${item.codigo_existente ?? null}, ${item.incluido !== false}, ${ncm}, ${entra}, NULL, NULL)`;
  }
  if (prefixoCodigo !== undefined && !/^\d{3,4}$/.test(String(prefixoCodigo))) throw new Error('Faixa de código inválida (use 3 ou 4 números, ex.: 7000).');
  await sql`UPDATE solicitacoes SET editado = true, prefixo_codigo = COALESCE(${prefixoCodigo ?? null}, prefixo_codigo), atualizado_em = now() WHERE id = ${id}`;
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, ${usuario.email}, 'editou', ${JSON.stringify({ itens: ordem, prefixoCodigo: prefixoCodigo ?? null })}::jsonb)`;
}

// Fase 1: aprovar só marca a decisão (nada é criado). A criação é a Fase 2, ligada só com autorização.
export async function decidir(sql, usuario, id, { aprovar, motivo = '' }) {
  const [s] = await sql`SELECT status FROM solicitacoes WHERE id = ${id}`;
  if (!s) throw new Error('Solicitação não encontrada.');
  if (!ESTADOS_EDITAVEIS.includes(s.status)) throw new Error('Esta solicitação já foi decidida.');
  if (!aprovar && !String(motivo).trim()) throw new Error('Explique o motivo da recusa.');
  if (aprovar) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM solicitacao_itens WHERE solicitacao_id = ${id} AND incluido`;
    if (n === 0) throw new Error('Não há itens para aprovar.');
  }
  const novo = aprovar ? 'aprovada' : 'recusada';
  await sql`UPDATE solicitacoes SET status = ${novo}, decidido_por = ${usuario.email}, decidido_em = now(), motivo_recusa = ${aprovar ? null : String(motivo).trim()}, atualizado_em = now() WHERE id = ${id}`;
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, ${usuario.email}, ${novo}, ${JSON.stringify({ motivo })}::jsonb)`;
  return novo;
}

export async function reanalisar(sql, usuario, id) {
  const [s] = await sql`SELECT clickup_task_id, status FROM solicitacoes WHERE id = ${id}`;
  if (!s) throw new Error('Solicitação não encontrada.');
  if (!ESTADOS_EDITAVEIS.includes(s.status)) throw new Error('Esta solicitação já foi decidida.');
  await sql`UPDATE solicitacoes SET hash_conteudo = NULL, editado = false WHERE id = ${id}`;
  const r = await receberTarefa(sql, await buscarTarefa(s.clickup_task_id));
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao) VALUES (${id}, ${usuario.email}, 'reanalisou')`;
  return r;
}

// Etapas mostradas na tela: Aprovada, Na fila, Omie, Nexaas, Comentário, Status. estado: ok | andando | erro | pendente | desligado
export function montarEtapas(s, cadastros) {
  const todos = (fn) => cadastros.length > 0 && cadastros.every(fn);
  const algum = (fn) => cadastros.some(fn);
  const ultima = (campo) => cadastros.map((c) => c[campo]).filter(Boolean).sort().pop() ?? null;
  const erroOmie = cadastros.find((c) => c.omie_status === 'erro');
  const erroNexaas = cadastros.find((c) => c.nexaas_status === 'erro');
  const aprovada = ['aprovada', 'na_fila', 'processando', 'concluida'].includes(s.status);
  const estadoOmie = erroOmie ? 'erro' : todos((c) => c.omie_status === 'ok') ? 'ok' : s.lote_id ? (algum((c) => c.omie_status === 'criando') ? 'andando' : 'pendente') : 'pendente';
  const estadoNexaas = erroNexaas ? 'erro' : todos((c) => c.nexaas_status === 'ok') ? 'ok' : estadoOmie === 'ok' ? 'andando' : 'pendente';
  const codigosOk = estadoOmie === 'ok' && estadoNexaas === 'ok';
  const statusConfigurado = !!process.env.CLICKUP_STATUS_CONCLUIDO;
  return [
    { chave: 'aprovada', rotulo: 'Aprovada', estado: aprovada ? 'ok' : 'pendente', quando: aprovada ? s.decidido_em : null, erro: null },
    { chave: 'fila', rotulo: 'Na fila', estado: s.na_fila_em ? 'ok' : 'pendente', quando: s.na_fila_em, erro: null },
    { chave: 'omie', rotulo: 'Criando no Omie (código)', estado: estadoOmie, quando: estadoOmie === 'ok' ? ultima('atualizado_em') : null, erro: erroOmie ? `${erroOmie.descricao}: ${erroOmie.omie_erro}` : null },
    { chave: 'nexaas', rotulo: 'Criando no Nexaas', estado: estadoNexaas, quando: estadoNexaas === 'ok' ? s.codigos_em : null, erro: erroNexaas ? `${erroNexaas.descricao}: ${erroNexaas.nexaas_erro}` : null },
    { chave: 'comentario', rotulo: 'Comentário enviado ao ClickUp', estado: s.comentado_em ? 'ok' : s.comentario_erro ? 'erro' : codigosOk ? 'andando' : 'pendente', quando: s.comentado_em, erro: s.comentario_erro },
    { chave: 'status', rotulo: 'Status da tarefa atualizado', estado: s.status_atualizado_em ? 'ok' : s.status_erro ? 'erro' : !statusConfigurado ? 'desligado' : s.comentado_em ? 'andando' : 'pendente', quando: s.status_atualizado_em, erro: s.status_erro || (!statusConfigurado ? 'Aguardando você confirmar qual status significa "concluído" (CLICKUP_STATUS_CONCLUIDO).' : null) },
  ];
}

// Comentário de retorno na tarefa. Só sai se CLICKUP_COMENTAR=1 (desligado por padrão na Fase 1).
export async function comentarResultado(sql, id, texto) {
  const config = await lerConfig(sql);
  if (!config.comentarNoClickUp) return { enviado: false, motivo: 'Comentários no ClickUp desligados (CLICKUP_COMENTAR).' };
  const [s] = await sql`SELECT clickup_task_id, origem FROM solicitacoes WHERE id = ${id}`;
  if (!s || s.origem === 'teste') return { enviado: false, motivo: 'Solicitação de teste.' };
  await comentarTarefa(s.clickup_task_id, texto);
  return { enviado: true };
}

// Chamado quando um cadastro ganha código. Se o nome bate com um produto de uma solicitação ainda viva, anota o código
// no item; quando todos os itens da solicitação têm código, marca como concluída e comenta na tarefa do ClickUp.
export async function registrarCodigoGerado(sql, cadastro) {
  if (!cadastro?.codigo || !cadastro.descricao) return { vinculado: false };
  // Cadastro que nasceu de uma aprovação já é acompanhado por avancar() (api/_lib/criacao.js): não vincula por nome.
  const [daFila] = await sql`SELECT 1 FROM solicitacao_itens WHERE cadastro_id = ${cadastro.id} LIMIT 1`;
  if (daFila) return { vinculado: true, completa: false };
  const [item] = await sql`SELECT i.id, i.solicitacao_id FROM solicitacao_itens i JOIN solicitacoes s ON s.id = i.solicitacao_id
    WHERE upper(trim(i.descricao)) = ${padronizarNome(cadastro.descricao)} AND i.incluido AND i.codigo_gerado IS NULL
      AND s.lote_id IS NULL AND s.status IN ('recebida', 'aguardando_analise', 'aprovada') ORDER BY s.recebido_em LIMIT 1`;
  if (!item) return { vinculado: false };
  await sql`UPDATE solicitacao_itens SET codigo_gerado = ${cadastro.codigo}, cadastro_id = ${cadastro.id}, status = 'codigo_gerado' WHERE id = ${item.id}`;
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${item.solicitacao_id}, 'sistema', 'codigo-gerado', ${JSON.stringify({ codigo: cadastro.codigo })}::jsonb)`;
  const [{ faltam }] = await sql`SELECT count(*)::int AS faltam FROM solicitacao_itens WHERE solicitacao_id = ${item.solicitacao_id} AND incluido AND codigo_gerado IS NULL`;
  if (faltam > 0) return { vinculado: true, completa: false };
  await sql`UPDATE solicitacoes SET status = 'concluida', atualizado_em = now() WHERE id = ${item.solicitacao_id}`;
  await comentarCodigos(sql, item.solicitacao_id);
  return { vinculado: true, completa: true };
}

// Comenta na tarefa a lista "código - produto". Idempotente: só um comentário por solicitação (comentado_em é a trava).
// Se uma tentativa anterior falhou, confere os comentários da tarefa antes de reenviar (evita duplicar se a resposta se perdeu).
export async function comentarCodigos(sql, id, { enviar = comentarResultado, existentes = listarComentarios } = {}) {
  const [s] = await sql`SELECT clickup_task_id, comentario_erro, origem FROM solicitacoes WHERE id = ${id}`;
  if (!s) throw new Error('Solicitação não encontrada.');
  const trava = await sql`UPDATE solicitacoes SET comentado_em = now() WHERE id = ${id} AND comentado_em IS NULL RETURNING id`;
  if (!trava.length) return { enviado: true, jaEnviado: true };
  const itens = await sql`SELECT codigo_gerado, descricao, ncm, ncm_padrao FROM solicitacao_itens WHERE solicitacao_id = ${id} AND incluido AND codigo_gerado IS NOT NULL ORDER BY ordem`;
  const marca = `(solicitação #${id})`;
  const aRevisar = itens.filter((i) => i.ncm_padrao);
  const aviso = aRevisar.length ? `\n\nNCM padrão aplicado (${[...new Set(aRevisar.map((i) => i.ncm))].join(', ')}) em: ${aRevisar.map((i) => i.codigo_gerado).join(', ')}. Será revisado e ajustado no sistema se necessário.` : '';
  const texto = `Códigos gerados pelo SKBiscoitê ${marca}:\n\n${itens.map((i) => `${i.codigo_gerado} - ${i.descricao}`).join('\n')}${aviso}`;
  const registrar = (acao, detalhe) => sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, 'sistema', ${acao}, ${JSON.stringify(detalhe)}::jsonb)`;
  try {
    if (s.comentario_erro && s.origem !== 'teste') {
      const r = await existentes(s.clickup_task_id).catch(() => ({ comments: [] }));
      if ((r.comments || []).some((c) => String(c.comment_text ?? '').includes(marca))) {
        await sql`UPDATE solicitacoes SET comentario_erro = NULL WHERE id = ${id}`;
        await registrar('comentario-ja-existia', {});
        return { enviado: true, jaEnviado: true };
      }
    }
    const r = await enviar(sql, id, texto);
    if (!r.enviado) {
      await sql`UPDATE solicitacoes SET comentado_em = NULL, comentario_erro = ${r.motivo ?? 'Não enviado.'} WHERE id = ${id}`;
      await registrar('comentario-nao-enviado', { motivo: r.motivo ?? null });
      return { enviado: false, motivo: r.motivo };
    }
    await sql`UPDATE solicitacoes SET comentario_erro = NULL WHERE id = ${id}`;
    await registrar('comentou-no-clickup', {});
    return { enviado: true };
  } catch (erro) {
    const msg = String(erro.message).slice(0, 300);
    await sql`UPDATE solicitacoes SET comentado_em = NULL, comentario_erro = ${msg} WHERE id = ${id}`;
    await registrar('comentario-falhou', { erro: msg });
    return { enviado: false, motivo: msg };
  }
}
