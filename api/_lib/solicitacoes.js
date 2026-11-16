// api/_lib/solicitacoes.js — solicitações vindas do ClickUp (Fase 1: SÓ ANALISAR, nada é criado no Omie).
// Fluxo: evento/tarefa -> lerTarefaClickUp -> analisarSolicitacao -> grava solicitação + itens (idempotente).
import crypto from 'node:crypto';
import { sql as sqlPadrao } from './db.js';
import { lerEstado, gravarEstado } from './catalogo.js';
import { CONFIG_PADRAO, analisarSolicitacao, lerTarefaClickUp, prepararCatalogo } from '../../src/lib/solicitacoes.js';
import { buscarTarefa, comentarTarefa, listaMonitorada, listarTarefasDaLista } from './clickup.js';

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
    // Fase 1: o automático ainda não existe. Só liga na Fase 2, com autorização.
    if (!['analisar', 'simulacao'].includes(mudancas.modo)) throw new Error('Modo inválido. Nesta fase só existem "analisar" e "simulacao".');
    novo.modo = mudancas.modo;
  }
  const inteiro = (v, min, max, nome) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${nome} deve ser um número inteiro entre ${min} e ${max}.`); return n; };
  if ('limiteItensAuto' in mudancas) novo.limiteItensAuto = inteiro(mudancas.limiteItensAuto, 1, 100, 'Limite de itens');
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

// ---------- Entrada de uma tarefa (idempotente) ----------
// Devolve { resultado: 'nova'|'atualizada'|'sem-mudanca'|'ignorada'|'travada', id }.
export async function receberTarefa(sql, tarefaApi, { origem = 'clickup', catalogo = null } = {}) {
  const t = lerTarefaClickUp(tarefaApi);
  if (!t.ehCadastro) return { resultado: 'ignorada', motivo: 'Não é do formulário de cadastro.' };

  const hash = hashDoConteudo(t);
  const [existente] = await sql`SELECT id, status, hash_conteudo, editado FROM solicitacoes WHERE clickup_task_id = ${t.taskId}`;
  if (existente && existente.hash_conteudo === hash) return { resultado: 'sem-mudanca', id: existente.id };
  // Depois de aprovada/recusada/processada, mudar o texto no ClickUp não mexe mais na solicitação.
  if (existente && !['recebida', 'aguardando_analise'].includes(existente.status)) return { resultado: 'travada', id: existente.id };

  const config = await lerConfig(sql);
  const analise = analisarSolicitacao(t, catalogo ?? (await catalogoDoOmie(sql)), config);

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
  const cursor = (await lerEstado(sql, 'clickup_cursor'))?.ate ?? 0;
  const catalogo = await catalogoDoOmie(sql);
  const resumo = { lidas: 0, novas: 0, atualizadas: 0, ignoradas: 0 };
  let maiorData = cursor;
  for (let pagina = 0; pagina < maximoPaginas; pagina++) {
    const r = await listarTarefasDaLista(listaMonitorada(), { desdeMs: cursor, pagina });
    for (const tarefa of r.tasks || []) {
      resumo.lidas++;
      maiorData = Math.max(maiorData, Number(tarefa.date_updated) || 0);
      const x = await receberTarefa(sql, tarefa, { catalogo });
      if (x.resultado === 'nova') resumo.novas++;
      else if (x.resultado === 'atualizada') resumo.atualizadas++;
      else if (x.resultado === 'ignorada') resumo.ignoradas++;
    }
    if (r.last_page !== false) break;
  }
  // Recua 1 minuto no cursor para nunca perder tarefa alterada na virada.
  if (maiorData > cursor) await gravarEstado(sql, 'clickup_cursor', { ate: maiorData - 60000 });
  return resumo;
}

// ---------- Tela: listar, detalhar, editar, aprovar, recusar ----------
export async function listarSolicitacoes(sql, { status = '', busca = '', sugestao = '' } = {}) {
  const b = `%${busca.trim()}%`;
  return sql`SELECT s.id, s.clickup_task_id, s.titulo, s.url, s.status, s.sugestao, s.rota, s.motivos, s.solicitante, s.familia_campo, s.prefixo_codigo, s.origem, s.recebido_em, s.decidido_em, s.decidido_por,
      (SELECT count(*) FROM solicitacao_itens i WHERE i.solicitacao_id = s.id AND i.incluido) AS itens
    FROM solicitacoes s
    WHERE (${status} = '' OR s.status = ${status}) AND (${sugestao} = '' OR s.sugestao = ${sugestao}) AND (${busca.trim()} = '' OR s.titulo ILIKE ${b} OR s.solicitante ILIKE ${b})
    ORDER BY s.recebido_em DESC LIMIT 200`;
}

export async function detalharSolicitacao(sql, id) {
  const [s] = await sql`SELECT * FROM solicitacoes WHERE id = ${id}`;
  if (!s) return null;
  const itens = await sql`SELECT id, ordem, linha, original, descricao, avisos, parecidos, codigo_existente, incluido, codigo_gerado, status FROM solicitacao_itens WHERE solicitacao_id = ${id} ORDER BY ordem`;
  const historico = await sql`SELECT usuario, acao, detalhe, em FROM solicitacoes_log WHERE solicitacao_id = ${id} ORDER BY em DESC LIMIT 50`;
  return { ...s, itens, historico };
}

const ESTADOS_EDITAVEIS = ['aguardando_analise', 'recebida'];

export async function editarItens(sql, usuario, id, { itens, prefixoCodigo }) {
  const [s] = await sql`SELECT status FROM solicitacoes WHERE id = ${id}`;
  if (!s) throw new Error('Solicitação não encontrada.');
  if (!ESTADOS_EDITAVEIS.includes(s.status)) throw new Error('Esta solicitação já foi decidida e não pode mais ser editada.');
  if (!Array.isArray(itens) || itens.length > 200) throw new Error('Lista de itens inválida.');
  await sql`DELETE FROM solicitacao_itens WHERE solicitacao_id = ${id}`;
  let ordem = 0;
  for (const item of itens) {
    const descricao = String(item.descricao ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (!descricao) continue;
    if (descricao.length > 120) throw new Error(`"${descricao.slice(0, 30)}…" passa de 120 caracteres.`);
    ordem += 1;
    await sql`INSERT INTO solicitacao_itens (solicitacao_id, ordem, linha, original, descricao, avisos, parecidos, codigo_existente, incluido)
      VALUES (${id}, ${ordem}, ${item.linha ?? null}, ${item.original ?? null}, ${descricao}, ${JSON.stringify(item.avisos || [])}::jsonb, ${JSON.stringify(item.parecidos || [])}::jsonb, ${item.codigo_existente ?? null}, ${item.incluido !== false})`;
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

// Comentário de retorno na tarefa. Só sai se CLICKUP_COMENTAR=1 (desligado por padrão na Fase 1).
export async function comentarResultado(sql, id, texto) {
  const config = await lerConfig(sql);
  if (!config.comentarNoClickUp) return { enviado: false, motivo: 'Comentários no ClickUp desligados (CLICKUP_COMENTAR).' };
  const [s] = await sql`SELECT clickup_task_id, origem FROM solicitacoes WHERE id = ${id}`;
  if (!s || s.origem === 'teste') return { enviado: false, motivo: 'Solicitação de teste.' };
  await comentarTarefa(s.clickup_task_id, texto);
  return { enviado: true };
}
