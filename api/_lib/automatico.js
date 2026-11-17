// api/_lib/automatico.js — criação automática de solicitações "pequenas e limpas".
// Nada aqui cria sozinho sem o modo "Automático" ligado na tela (o padrão é "Só analisar"; "Simulação" só avalia e registra).
// Uma solicitação só é criada se: (1) passar em TODAS as regras objetivas (sem alerta, poucos itens, NCM confiável) E
// (2) a IA, como segunda opinião, concordar. A IA só pode BARRAR (mandar para análise): nunca libera o que as regras barraram.
// Falha da IA, falta de chave, dúvida: vai para análise de uma pessoa.
import { sql as sqlPadrao } from './db.js';
import { gravarEstado, lerEstado } from './catalogo.js';
import { aprovarECriar, avancar } from './criacao.js';
import { lerNcmPadrao } from './ncm.js';
import { lerNotaDaSolicitacao } from './nota.js';
import { detalharSolicitacao, lerConfig } from './solicitacoes.js';

export const ROBO = Object.freeze({ email: 'automatico@skbiscoite' });
const FAMILIAS_COM_NCM_DA_NOTA = ['700', '800'];

// Segunda opinião da IA: o pedido faz sentido? Devolve { ok, motivo }.
export async function opiniaoDaIA(solicitacao, itens, { chave = process.env.OPENAI_API_KEY, modelo = process.env.OPENAI_MODELO || 'gpt-4o-mini', buscar = fetch } = {}) {
  if (!chave) throw new Error('OPENAI_API_KEY não configurada.');
  const resposta = await buscar('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: modelo,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Você confere pedidos de cadastro de produto de uma fábrica/loja de biscoitos e itens de operação. O pedido será criado AUTOMATICAMENTE no ERP se você aprovar, então seja rigoroso: aprove (ok=true) só se cada linha for claramente UM nome de produto real, a família escolhida for coerente com o tipo de produto (INTERNO/EXTERNO = comida pronta; EMBALAGEM = embalagens; SUPRIMENTOS = material de escritório, limpeza, uso geral; ATIVO = equipamentos/móveis; ENVASE = insumos de envase), não for pedido de alteração, dúvida, comentário ou lista de várias coisas na mesma linha. Na dúvida, ok=false e explique em uma frase.' },
        { role: 'user', content: JSON.stringify({ titulo: solicitacao.titulo, familia_escolhida: solicitacao.familia_campo, produtos: itens.map((i) => i.descricao) }) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'parecer', strict: true, schema: { type: 'object', additionalProperties: false, required: ['ok', 'motivo'], properties: { ok: { type: 'boolean' }, motivo: { type: 'string' } } } },
      },
    }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(`OpenAI respondeu ${resposta.status}: ${dados.error?.message ?? 'erro'}`.slice(0, 200));
  const parecer = JSON.parse(dados.choices?.[0]?.message?.content ?? '{}');
  return { ok: parecer.ok === true, motivo: String(parecer.motivo ?? '').slice(0, 300) };
}

// Avalia uma solicitação. Devolve { elegivel, motivo }. Não cria nada.
export async function avaliarParaAutomatico(sql, id, { ia = opiniaoDaIA, lerNota = lerNotaDaSolicitacao, limiteItens } = {}) {
  const s = await detalharSolicitacao(sql, id);
  if (!s) return { elegivel: false, motivo: 'Solicitação não encontrada.' };
  const config = await lerConfig(sql);
  const itens = s.itens.filter((i) => i.incluido);
  if (s.sugestao !== 'automatica') return { elegivel: false, motivo: 'A leitura tem alertas: precisa de análise.' };
  if (s.rota !== 'criar') return { elegivel: false, motivo: 'Não é pedido de código novo.' };
  if (!['clickup', 'teste'].includes(s.origem)) return { elegivel: false, motivo: 'Origem não automática.' };
  if (itens.length === 0) return { elegivel: false, motivo: 'Sem produtos.' };
  if (itens.length > (limiteItens ?? config.limiteItensAuto)) return { elegivel: false, motivo: `Mais de ${limiteItens ?? config.limiteItensAuto} itens.` };
  const prefixo = s.prefixo_codigo || s.familia_prefixo;
  if (!prefixo) return { elegivel: false, motivo: 'Família não reconhecida.' };

  // NCM só de fonte confiável: padrão da família (200/300/400/500/1010) ou leitura DIRETA da nota (700/800). NCM sugerido só pela IA nunca vale.
  if (FAMILIAS_COM_NCM_DA_NOTA.includes(String(prefixo))) {
    try { await lerNota(sql, ROBO, id); } catch (erro) { return { elegivel: false, motivo: `NCM da nota: ${erro.message}` }; }
    const lidos = await sql`SELECT id, descricao, ncm_sugerido, ncm_fonte FROM solicitacao_itens WHERE solicitacao_id = ${id} AND incluido ORDER BY ordem`;
    const sem = lidos.filter((i) => !i.ncm_sugerido || !String(i.ncm_fonte).startsWith('Nota, linha'));
    if (sem.length) return { elegivel: false, motivo: `NCM não confirmado direto na nota para: ${sem.map((i) => i.descricao).join('; ')}.` };
  } else if (!(await lerNcmPadrao(sql))[prefixo]) {
    return { elegivel: false, motivo: `Não há NCM padrão para a família ${prefixo}.` };
  }

  try {
    const parecer = await ia(s, itens);
    if (!parecer.ok) return { elegivel: false, motivo: `IA: ${parecer.motivo || 'não aprovou.'}` };
  } catch (erro) {
    return { elegivel: false, motivo: `IA indisponível (${String(erro.message).slice(0, 120)}): fica para análise.` };
  }
  return { elegivel: true, motivo: 'Aprovada pelas regras e pela IA.' };
}

// Uma rodada do robô (chamada pelo agendador e pela tela). Respeita pausa, modo, limite por dia e intervalo entre solicitações.
// `ids` e `configExtra` existem para os testes (nunca mexem na fila real nem na configuração gravada).
export async function processarFilaAutomatica(sql = sqlPadrao, { ia, lerNota, avancarOpcoes = {}, agora = Date.now(), ids = null, configExtra = {}, chaveUltima = 'auto_ultima_criacao' } = {}) {
  const config = { ...(await lerConfig(sql)), ...configExtra };
  const resumo = { modo: config.modo, pausado: config.pausado, avaliadas: 0, criadas: 0, simuladas: 0, paraAnalise: 0, continuadas: 0, aguardandoIntervalo: false };
  if (config.pausado || !['automatico', 'simulacao'].includes(config.modo)) return resumo;
  const opcoesAvaliacao = { ia, lerNota };
  if (!ia) delete opcoesAvaliacao.ia;
  if (!lerNota) delete opcoesAvaliacao.lerNota;

  if (config.modo === 'automatico') {
    // Termina o que o robô já aprovou (Omie -> Nexaas -> comentário -> status).
    const andamento = await sql`SELECT id FROM solicitacoes WHERE decidido_por = ${ROBO.email} AND status IN ('na_fila', 'processando') AND (${ids}::bigint[] IS NULL OR id = ANY(${ids}::bigint[])) ORDER BY id LIMIT 3`;
    for (const a of andamento) { await avancar(sql, ROBO, a.id, avancarOpcoes); resumo.continuadas++; }
  }

  const candidatas = await sql`SELECT id, hash_conteudo FROM solicitacoes WHERE status = 'aguardando_analise' AND sugestao = 'automatica' AND rota = 'criar' AND editado = false
    AND origem IN ('clickup', 'teste') AND auto_hash IS DISTINCT FROM hash_conteudo AND (${config.modo === 'automatico'} OR auto_hash IS DISTINCT FROM ('sim:' || hash_conteudo)) AND (${ids}::bigint[] IS NULL OR id = ANY(${ids}::bigint[])) ORDER BY recebido_em LIMIT 5`;
  for (const c of candidatas) {
    if (config.modo === 'automatico') {
      const ultima = (await lerEstado(sql, chaveUltima))?.em ?? 0;
      if (agora - ultima < config.intervaloMinutos * 60000) { resumo.aguardandoIntervalo = true; break; }
      const [{ hoje }] = await sql`SELECT count(*)::int AS hoje FROM solicitacoes WHERE decidido_por = ${ROBO.email} AND decidido_em::date = current_date`;
      if (hoje >= config.limiteAutoPorDia) { resumo.aguardandoIntervalo = true; break; }
    }
    const aval = await avaliarParaAutomatico(sql, c.id, opcoesAvaliacao);
    resumo.avaliadas++;
    await sql`UPDATE solicitacoes SET auto_hash = ${aval.elegivel && config.modo === 'simulacao' ? 'sim:' + c.hash_conteudo : c.hash_conteudo}, auto_avaliada_em = now(), auto_motivo = ${aval.elegivel ? (config.modo === 'simulacao' ? 'Simulação: seria criada automaticamente.' : null) : aval.motivo} WHERE id = ${c.id}`;
    await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${c.id}, 'automatico', ${aval.elegivel ? (config.modo === 'simulacao' ? 'auto-simulou' : 'auto-aprovou') : 'auto-enviou-para-analise'}, ${JSON.stringify({ motivo: aval.motivo })}::jsonb)`;
    if (!aval.elegivel) { resumo.paraAnalise++; continue; }
    if (config.modo === 'simulacao') { resumo.simuladas++; continue; }
    // Itens do 700/800 usam o NCM lido direto da nota.
    await sql`UPDATE solicitacao_itens SET ncm = ncm_sugerido WHERE solicitacao_id = ${c.id} AND incluido AND ncm_sugerido IS NOT NULL AND ncm_fonte LIKE 'Nota, linha%'`;
    await gravarEstado(sql, chaveUltima, { em: agora });
    try {
      await aprovarECriar(sql, ROBO, c.id, avancarOpcoes);
      resumo.criadas++;
    } catch (erro) {
      await sql`UPDATE solicitacoes SET auto_motivo = ${`Não foi criada: ${String(erro.message).slice(0, 250)}`} WHERE id = ${c.id}`;
      resumo.paraAnalise++;
    }
    break; // uma solicitação nova por rodada: o intervalo entre solicitações vale daqui para frente
  }
  return resumo;
}
