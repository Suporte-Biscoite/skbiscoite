// Verifica a Fase 1 das solicitações do ClickUp com tarefas FICTÍCIAS (origem "teste"): não toca no ClickUp,
// não cria nada no Omie nem no Nexaas. Grava e apaga linhas nas tabelas de solicitações do Neon.
// Uso: npm run verificar-solicitacoes
import assert from 'node:assert/strict';
import { sql } from '../api/_lib/db.js';
import { garantirEsquema } from '../api/_lib/schema.js';
import { chaveDoEvento } from '../api/_lib/clickup.js';
import { aprovarECriar, atualizarStatusDaTarefa, avancar, tentarDeNovo } from '../api/_lib/criacao.js';
import { gravarNcmPadrao, listarParaRevisarNcm, revisarNcm } from '../api/_lib/ncm.js';
import { lerNotaDaSolicitacao } from '../api/_lib/nota.js';
import { conferirFamilia } from '../api/_lib/familia-ia.js';
import { processarFilaAutomatica, ROBO } from '../api/_lib/automatico.js';
import { decidir, detalharSolicitacao, editarItens, gravarConfig, lerConfig, listarSolicitacoes, receberTarefa, registrarCodigoGerado, tratarEvento } from '../api/_lib/solicitacoes.js';

await garantirEsquema();
const usuario = { email: 'teste-automatizado@skbiscoite' };
const campos = (familia) => [
  { id: 'a', name: 'Família de Produto', type: 'drop_down', value: { name: familia } },
  { id: 'b', name: 'Tipo de Identificação', type: 'drop_down', value: { name: 'Código' } },
];
const tarefa = (id, name, text, familia = 'SUPRIMENTOS') => ({ id, name, text_content: text, status: { status: 'kauã' }, custom_fields: campos(familia), date_updated: '1' });
const IDS = ['TESTE-5', 'TESTE-19', 'TESTE-DUP', 'TESTE-OUTRA', 'TESTE-ENC', 'TESTE-COD', 'TESTE-CRIA', 'TESTE-NCM', 'TESTE-NOTA', 'TESTE-AUTO1', 'TESTE-AUTO2', 'TESTE-AUTO3', 'TESTE-AUTO4', 'TESTE-AUTO5', 'TESTE-ALT', 'TESTE-FAM', 'TESTE-REUSO'];
const limpar = async () => { await sql`DELETE FROM sync_meta WHERE chave = 'auto_ultima_criacao_teste'`; await sql`DELETE FROM cadastros WHERE descricao LIKE 'PRODUTO FICTICIO CRIACAO%' OR descricao LIKE 'PRODUTO FICTICIO REUSO%' OR codigo = '7009901'`; await sql`DELETE FROM omie_produtos WHERE codigo IN ('7009901', '99998', '7009902')`; await sql`DELETE FROM solicitacoes WHERE clickup_task_id = ANY(${IDS})`; await sql`DELETE FROM clickup_eventos WHERE task_id = ANY(${IDS})`; await sql`DELETE FROM solicitacoes_log WHERE usuario = ${usuario.email}`; };
await limpar();
const ok = (m) => console.log('  ✓', m);

try {
  console.log('Critério 1: 5 produtos na descrição -> 5 itens, prévia editável');
  const cinco = ['PRODUTO FICTICIO ALFA 1 UN', 'PRODUTO FICTICIO BETA 2 UN', 'PRODUTO FICTICIO GAMA 3 UN', 'PRODUTO FICTICIO DELTA 4 UN', 'PRODUTO FICTICIO EPSILON 5 UN'].join('\n');
  const r1 = await receberTarefa(sql, tarefa('TESTE-5', 'Cód 7000 (teste fictício)', cinco), { origem: 'teste' });
  assert.equal(r1.resultado, 'nova');
  let s = await detalharSolicitacao(sql, r1.id);
  assert.equal(s.itens.length, 5); assert.equal(s.status, 'aguardando_analise'); assert.equal(s.sugestao, 'automatica'); assert.equal(s.prefixo_codigo, '700');
  ok('5 itens lidos, prefixo 700, sugestão "automática" (mas nada é criado: status aguardando análise)');
  await editarItens(sql, usuario, r1.id, { itens: s.itens.map((i, k) => (k === 0 ? { ...i, descricao: 'produto fictício alfa editado' } : i)) });
  s = await detalharSolicitacao(sql, r1.id);
  assert.equal(s.itens[0].descricao, 'PRODUTO FICTICIO ALFA EDITADO'); assert.equal(s.editado, true);
  ok('item editado na prévia');

  console.log('Critério 2: mais de 10 itens -> fila de análise, nada criado');
  const dezenove = Array.from({ length: 19 }, (_, i) => `PRODUTO FICTICIO LOTE ${i + 1} UN`).join('\n');
  const r2 = await receberTarefa(sql, tarefa('TESTE-19', 'Cód 7000 (teste fictício)', dezenove), { origem: 'teste' });
  const s2 = await detalharSolicitacao(sql, r2.id);
  assert.equal(s2.itens.length, 19); assert.equal(s2.sugestao, 'analise'); assert.ok(s2.motivos.some((m) => m.includes('19 itens')));
  const [{ n }] = await sql`SELECT count(*)::int n FROM cadastros WHERE codigo IS NOT NULL AND usuario_email = 'clickup'`;
  assert.equal(n, 0);
  ok('19 itens -> análise; nenhuma linha criada na fila de cadastros');

  console.log('Critério 3: o mesmo evento / a mesma tarefa duas vezes não duplica');
  const again = await receberTarefa(sql, tarefa('TESTE-5', 'Cód 7000 (teste fictício)', cinco), { origem: 'teste' });
  assert.ok(['travada', 'sem-mudanca'].includes(again.resultado) || again.resultado === 'atualizada');
  const [{ c }] = await sql`SELECT count(*)::int c FROM solicitacoes WHERE clickup_task_id = 'TESTE-5'`;
  assert.equal(c, 1);
  s = await detalharSolicitacao(sql, r1.id); assert.equal(s.itens.length, 5);
  ok('tarefa repetida: 1 solicitação, 5 itens (sem duplicar)');
  const ev = { event: 'taskCreated', task_id: 'TESTE-DUP', history_items: [{ id: 'h1' }] };
  const e1 = await tratarEvento(sql, ev, chaveDoEvento(ev));
  const e2 = await tratarEvento(sql, ev, chaveDoEvento(ev));
  assert.notEqual(e1.resultado, 'duplicado'); assert.equal(e2.resultado, 'duplicado');
  const [{ ne }] = await sql`SELECT count(*)::int ne FROM clickup_eventos WHERE task_id = 'TESTE-DUP'`;
  assert.equal(ne, 1);
  ok(`evento repetido ignorado (1ª vez: ${e1.resultado}; 2ª: duplicado)`);
  const [i1, i2] = await Promise.all([receberTarefa(sql, tarefa('TESTE-DUP', 'Cód 7000 (x)', 'PRODUTO FICTICIO CORRIDA 1 UN'), { origem: 'teste' }), receberTarefa(sql, tarefa('TESTE-DUP', 'Cód 7000 (x)', 'PRODUTO FICTICIO CORRIDA 1 UN'), { origem: 'teste' })]);
  const [{ c2 }] = await sql`SELECT count(*)::int c2 FROM solicitacoes WHERE clickup_task_id = 'TESTE-DUP'`;
  assert.equal(c2, 1);
  const [{ it }] = await sql`SELECT count(*)::int it FROM solicitacao_itens WHERE solicitacao_id = (SELECT id FROM solicitacoes WHERE clickup_task_id = 'TESTE-DUP')`;
  assert.equal(it, 1);
  ok(`duas chegadas simultâneas: 1 solicitação e 1 item (${i1.resultado} / ${i2.resultado})`);

  console.log('Mesmo produto em duas solicitações');
  const rx = await receberTarefa(sql, tarefa('TESTE-OUTRA', 'Cód 7000 (outra)', 'PRODUTO FICTICIO BETA 2 UN'), { origem: 'teste' });
  const sx = await detalharSolicitacao(sql, rx.id);
  assert.equal(sx.sugestao, 'analise'); assert.ok(sx.itens[0].avisos[0].includes('Também está na solicitação'));
  ok('item repetido em outra solicitação vai para análise com aviso');

  console.log('Aprovar / recusar / pausa / modo');
  await decidir(sql, usuario, r1.id, { aprovar: true });
  s = await detalharSolicitacao(sql, r1.id); assert.equal(s.status, 'aprovada'); assert.equal(s.decidido_por, usuario.email);
  await assert.rejects(() => decidir(sql, usuario, r1.id, { aprovar: false, motivo: 'x' }));
  await assert.rejects(() => decidir(sql, usuario, r2.id, { aprovar: false, motivo: '  ' }));
  await decidir(sql, usuario, r2.id, { aprovar: false, motivo: 'Lista grande: separar por tipo' });
  ok('aprovada (sem criar nada), recusa exige motivo, decisão não se repete, tudo auditado');
  const antes = await lerConfig(sql);
  await gravarConfig(sql, usuario, { pausado: true });
  await assert.rejects(() => gravarConfig(sql, usuario, { modo: 'qualquer-coisa' }));
  assert.equal((await lerConfig(sql)).pausado, true);
  await gravarConfig(sql, usuario, { pausado: antes.pausado, modo: antes.modo }); // a configuração real nunca fica alterada pelo teste
  ok('pausa liga/desliga; modo inválido é recusado');
  const lista = await listarSolicitacoes(sql, { busca: 'teste fictício' });
  assert.ok(lista.length >= 2);
  ok('listagem com busca');
  console.log('Finalizada no ClickUp / códigos gerados');
  const enc = await receberTarefa(sql, tarefa('TESTE-ENC', 'Cód 7000 (encerrar)', 'PRODUTO FICTICIO GAMA 1 UN'), { origem: 'teste' });
  assert.equal(enc.resultado, 'nova');
  const movida = { ...tarefa('TESTE-ENC', 'Cód 7000 (encerrar)', 'PRODUTO FICTICIO GAMA 1 UN'), status: { status: 'finalizado', type: 'closed' }, date_updated: '2' };
  assert.equal((await receberTarefa(sql, movida, { origem: 'teste' })).resultado, 'encerrada');
  s = await detalharSolicitacao(sql, enc.id); assert.equal(s.status, 'finalizada_clickup'); assert.equal(s.status_clickup, 'finalizado');
  assert.equal((await receberTarefa(sql, movida, { origem: 'teste' })).resultado, 'sem-mudanca');
  const reaberta = { ...movida, status: { status: 'em progresso', type: 'custom' }, date_updated: '3' };
  await receberTarefa(sql, reaberta, { origem: 'teste' });
  s = await detalharSolicitacao(sql, enc.id); assert.equal(s.status, 'aguardando_analise');
  const jaFechada = { ...tarefa('TESTE-COD', 'Cód 7000 (x)', 'PRODUTO FICTICIO DELTA 1 UN'), status: { status: 'finalizado', type: 'closed' } };
  assert.equal((await receberTarefa(sql, jaFechada, { origem: 'teste' })).resultado, 'ignorada');
  ok('finalizada tira da fila, reaberta volta, tarefa já fechada ao chegar é ignorada');

  const cod = await receberTarefa(sql, tarefa('TESTE-COD', 'Cód 7000 (códigos)', 'PRODUTO FICTICIO EPSILON 1 UN\nPRODUTO FICTICIO ZETA 2 UN'), { origem: 'teste' });
  assert.equal((await registrarCodigoGerado(sql, { id: 900001, codigo: '7999001', descricao: 'PRODUTO FICTICIO EPSILON 1 UN' })).completa, false);
  assert.equal((await registrarCodigoGerado(sql, { id: 900002, codigo: '7999002', descricao: 'produto ficticio zeta 2 un' })).completa, true);
  assert.equal((await registrarCodigoGerado(sql, { id: 900003, codigo: '7999003', descricao: 'PRODUTO QUE NAO ESTA EM SOLICITACAO' })).vinculado, false);
  s = await detalharSolicitacao(sql, cod.id);
  assert.equal(s.status, 'concluida'); assert.deepEqual(s.itens.map((i) => i.codigo_gerado), ['7999001', '7999002']);
  assert.ok(s.historico.some((h) => h.acao === 'comentario-nao-enviado')); // teste nunca comenta no ClickUp
  ok('código gerado liga ao item pelo nome; ao completar, conclui e tenta comentar (teste não envia)');
  console.log('Aprovar -> fila -> comentário -> status (sem criar nada de verdade)');
  const SEM_PROCESSAR = { orcamentoMs: 0 }; // nunca chama Omie/Nexaas nos testes
  const cr = await receberTarefa(sql, tarefa('TESTE-CRIA', 'Pedido de cadastro', 'PRODUTO FICTICIO CRIACAO UM', 'SUPRIMENTOS(700)'), { origem: 'teste' });
  s = await detalharSolicitacao(sql, cr.id);
  assert.equal(s.sugestao, 'automatica'); assert.deepEqual(s.motivos, []); assert.equal(s.prefixo_codigo, '700');
  ok('SUPRIMENTOS(700) sem faixa no título: sem alerta, prefixo 700');
  await assert.rejects(() => aprovarECriar(sql, usuario, cr.id, SEM_PROCESSAR), /NCM/);
  s = await detalharSolicitacao(sql, cr.id); assert.equal(s.status, 'aguardando_analise'); assert.equal(s.lote_id, null);
  ok('sem NCM: não aprova e não cria nada (continua em análise)');
  await editarItens(sql, usuario, cr.id, { itens: s.itens.map((i) => ({ ...i, ncm: '49019900', entra_na_loja: false })) });
  s = await aprovarECriar(sql, usuario, cr.id, SEM_PROCESSAR);
  assert.ok(s.lote_id); assert.equal(s.cadastros.length, 1); assert.equal(s.cadastros[0].omie_status, 'pendente');
  const idLote = s.lote_id;
  s = await aprovarECriar(sql, usuario, cr.id, SEM_PROCESSAR);
  assert.equal(s.lote_id, idLote);
  const [{ qtd }] = await sql`SELECT count(*)::int AS qtd FROM cadastros WHERE descricao = 'PRODUTO FICTICIO CRIACAO UM'`;
  assert.equal(qtd, 1);
  ok('aprovar entra na fila (modo "Só analisar" não impede); aprovar de novo não duplica');
  assert.ok(s.etapas.find((e) => e.chave === 'omie').estado === 'pendente');
  // Simula o Omie e o Nexaas (o código vem da faixa 700, em sequência)
  await sql`UPDATE cadastros SET codigo = '7999801', omie_status = 'ok', nexaas_status = 'ok' WHERE lote_id = ${idLote}::uuid`;
  let chamadas = 0, falhar = true;
  const enviarComentario = async () => { chamadas++; if (falhar) throw new Error('ClickUp fora do ar'); return { enviado: true }; };
  s = await avancar(sql, usuario, cr.id, { ...SEM_PROCESSAR, enviarComentario });
  assert.equal(s.itens[0].codigo_gerado, '7999801');
  assert.equal(s.etapas.find((e) => e.chave === 'comentario').estado, 'erro');
  assert.ok(s.etapas.find((e) => e.chave === 'comentario').erro.includes('fora do ar'));
  s = await avancar(sql, usuario, cr.id, { ...SEM_PROCESSAR, enviarComentario });
  assert.equal(chamadas, 1); // não fica insistindo sozinho
  ok('falha no comentário aparece na etapa, com o motivo; não repete sozinha');
  falhar = false;
  s = await tentarDeNovo(sql, usuario, cr.id, 'comentario', { ...SEM_PROCESSAR, enviarComentario, existentes: undefined });
  assert.equal(chamadas, 2); assert.equal(s.etapas.find((e) => e.chave === 'comentario').estado, 'ok'); assert.equal(s.status, 'concluida');
  s = await avancar(sql, usuario, cr.id, { ...SEM_PROCESSAR, enviarComentario });
  s = await tentarDeNovo(sql, usuario, cr.id, 'comentario', { ...SEM_PROCESSAR, enviarComentario });
  assert.equal(chamadas, 2);
  ok('tentar de novo envia 1 comentário; repetir etapa/avançar não duplica');
  process.env.CLICKUP_STATUS_CONCLUIDO = 'finalizado';
  let trocas = 0, quebrar = true;
  const trocarStatus = async (_tarefa, novo) => { trocas++; if (quebrar) throw new Error('sem permissão'); assert.equal(novo, 'finalizado'); };
  await atualizarStatusDaTarefa(sql, cr.id, { atualizarStatus: trocarStatus });
  s = await detalharSolicitacao(sql, cr.id);
  assert.equal(s.etapas.find((e) => e.chave === 'status').estado, 'erro');
  quebrar = false;
  await atualizarStatusDaTarefa(sql, cr.id, { atualizarStatus: trocarStatus });
  await atualizarStatusDaTarefa(sql, cr.id, { atualizarStatus: trocarStatus });
  s = await detalharSolicitacao(sql, cr.id);
  assert.equal(trocas, 2); assert.equal(s.etapas.find((e) => e.chave === 'status').estado, 'ok');
  delete process.env.CLICKUP_STATUS_CONCLUIDO;
  ok('status da tarefa: falha aparece, nova tentativa funciona e só atualiza uma vez');
  console.log('NCM padrão por família e revisão');
  const nc = await receberTarefa(sql, tarefa('TESTE-NCM', 'Pedido de cadastro', 'PRODUTO FICTICIO CRIACAO DOIS\nPRODUTO FICTICIO CRIACAO TRES', 'EXTERNO(300)'), { origem: 'teste' });
  s = await aprovarECriar(sql, usuario, nc.id, SEM_PROCESSAR);
  assert.deepEqual(s.itens.map((i) => i.ncm), ['19059020', '19059020']);
  assert.ok(s.itens.every((i) => i.ncm_padrao));
  assert.ok(s.cadastros.every((c) => c.omie_status === 'pendente'));
  ok('300 sem NCM: usa o padrão 19059020 e marca para revisão');
  await assert.rejects(() => gravarNcmPadrao(sql, usuario, { 400: '123' }), /8 números/);
  await assert.rejects(() => gravarNcmPadrao(sql, usuario, { 999: '19059020' }), /desconhecida/);
  await sql`UPDATE cadastros SET codigo = '3999801', omie_id = 990001, omie_status = 'ok', nexaas_status = 'ok' WHERE lote_id = ${s.lote_id}::uuid AND linha = 1`;
  await sql`UPDATE cadastros SET codigo = '3999802', omie_id = 990002, omie_status = 'ok', nexaas_status = 'ok' WHERE lote_id = ${s.lote_id}::uuid AND linha = 2`;
  let textoComentario = '';
  s = await avancar(sql, usuario, nc.id, { ...SEM_PROCESSAR, enviarComentario: async (_sql, _id, texto) => { textoComentario = texto; return { enviado: true }; } });
  assert.ok(textoComentario.includes('3999801 - PRODUTO FICTICIO CRIACAO DOIS') && textoComentario.includes('NCM padrão aplicado (19059020)'));
  ok('comentário avisa que o NCM padrão foi aplicado');
  let fila = (await listarParaRevisarNcm(sql)).filter((i) => i.solicitacao_id === nc.id);
  assert.equal(fila.length, 2);
  const [primeiro, segundo] = fila;
  assert.equal((await revisarNcm(sql, usuario, primeiro.id, undefined, { consultar: async () => assert.fail('não deve consultar o Omie'), alterar: async () => assert.fail('não deve alterar') })).mudou, false);
  let enviado = null;
  const rev2 = await revisarNcm(sql, usuario, segundo.id, '4819.20.00', { consultar: async () => ({ descricao: 'X', valor_unitario: 12.5, unidade: 'UN' }), alterar: async (p) => { enviado = p; } });
  assert.equal(rev2.mudou, true); assert.ok(rev2.avisoNexaas === null || rev2.avisoNexaas.includes('Nexaas'));
  assert.equal(enviado.ncm, '4819.20.00'); assert.equal(enviado.valor_unitario, 12.5); assert.equal(enviado.codigo_produto, 990002);
  assert.equal((await revisarNcm(sql, usuario, segundo.id, '1', { alterar: async () => assert.fail('repetiu') })).jaRevisado, true);
  assert.equal((await listarParaRevisarNcm(sql)).filter((i) => i.solicitacao_id === nc.id).length, 0);
  ok('revisão: conferido não mexe no Omie; correção altera o Omie preservando preço; repetir não faz nada');
  console.log('Ler NCM da nota (PDF)');
  const TEXTO_NOTA = 'DADOS DOS PRODUTOS / SERVIÇOS\nCÓDIGO DESCRIÇÃO NCM/SH CST CFOP UN QUANT\n01 PAPEL HIGIENICO FICTICIO FOLHA DUPLA CAIXA COM 6.000 48181000 000 5102 un 2 167,63 335,26\n02 ITEM COM NOME DIFERENTE NA NOTA 94013000 000 5102 un 1 10,00 10,00\nDADOS ADICIONAIS\n';
  const nt = await receberTarefa(sql, tarefa('TESTE-NOTA', 'Pedido de cadastro', 'PAPEL HIGIENICO FICTICIO FOLHA DUPLA CAIXA COM 6.000\nCADEIRA FICTICIA PRETA\nPRODUTO FICTICIO SEM NOTA', 'SUPRIMENTOS(700)'), { origem: 'teste' });
  const tarefaComPdf = { attachments: [{ title: 'nota.pdf', extension: 'pdf', url: 'https://exemplo.invalido/nota.pdf' }] };
  const prender = { buscarDaTarefa: async () => tarefaComPdf, baixar: async () => Buffer.from('x'), lerPdf: async () => TEXTO_NOTA };
  process.env.OPENAI_API_KEY = 'chave-de-teste';
  let perguntas = 0;
  const iaInventa = async (produtos) => { perguntas++; return produtos.map((p) => ({ produto: p, ncm: p.startsWith('CADEIRA') ? '94013000' : '11112222' })); };
  const leitura = await lerNotaDaSolicitacao(sql, usuario, nt.id, { ...prender, ia: iaInventa });
  s = await detalharSolicitacao(sql, nt.id);
  assert.equal(perguntas, 1); assert.equal(leitura.achados, 2);
  assert.deepEqual(s.itens.map((i) => i.ncm_sugerido), ['48181000', '94013000', null]); // 11112222 foi inventado: descartado
  assert.ok(s.itens[0].ncm_fonte.startsWith('Nota, linha 1') && s.itens[1].ncm_fonte.includes('IA'));
  assert.equal(s.nota_info.itensNota.length, 2);
  ok('lê a nota: liga pelo nome, usa a IA só no que sobrou e descarta NCM que não existe na nota');
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(() => lerNotaDaSolicitacao(sql, usuario, nt.id, { ...prender, buscarDaTarefa: async () => ({ attachments: [] }) }), /PDF anexada/);
  const semChave = await lerNotaDaSolicitacao(sql, usuario, nt.id, { ...prender, ia: async () => assert.fail('sem chave não chama a IA') });
  assert.equal(semChave.achados, 1);
  ok('sem PDF avisa; sem chave da IA a leitura direta continua funcionando');
  console.log('Criação automática (sempre restrita às tarefas de teste, nunca à fila real)');
  const novaAuto = (id, titulo, nome, familia) => receberTarefa(sql, tarefa(id, titulo, nome, familia), { origem: 'teste' });
  const a1 = await novaAuto('TESTE-AUTO1', 'Pedido ok', 'PRODUTO FICTICIO CRIACAO AUTO UM', 'EXTERNO(300)');
  const a2 = await novaAuto('TESTE-AUTO2', 'Pedido VETO da IA', 'PRODUTO FICTICIO CRIACAO AUTO DOIS', 'INTERNO(400)');
  const a3 = await novaAuto('TESTE-AUTO3', 'Pedido sem nota', 'PRODUTO FICTICIO CRIACAO AUTO TRES', 'SUPRIMENTOS(700)');
  const todosIds = [a1.id, a2.id, a3.id];
  const iaFalsa = async (sol) => (sol.titulo.includes('VETO') ? { ok: false, motivo: 'parece comentário' } : { ok: true, motivo: '' });
  const semNota = async () => { throw new Error('A tarefa não tem nota em PDF anexada.'); };
  const base = { ia: iaFalsa, lerNota: semNota, ids: todosIds, avancarOpcoes: SEM_PROCESSAR, chaveUltima: 'auto_ultima_criacao_teste' };
  const config = (modo, extra = {}) => ({ modo, pausado: false, intervaloMinutos: 10, limiteAutoPorDia: 500, ...extra });

  assert.equal((await processarFilaAutomatica(sql, { ...base, configExtra: config('analisar') })).avaliadas, 0);
  assert.equal((await processarFilaAutomatica(sql, { ...base, configExtra: config('automatico', { pausado: true }) })).avaliadas, 0);
  ok('modo "Só analisar" e pausa: o robô não faz nada');

  const sim = await processarFilaAutomatica(sql, { ...base, configExtra: config('simulacao') });
  assert.equal(sim.avaliadas, 3); assert.equal(sim.simuladas, 1); assert.equal(sim.paraAnalise, 2); assert.equal(sim.criadas, 0);
  s = await detalharSolicitacao(sql, a1.id); assert.equal(s.lote_id, null); assert.ok(s.auto_motivo.startsWith('Simulação'));
  s = await detalharSolicitacao(sql, a2.id); assert.ok(s.auto_motivo.startsWith('IA:') && s.auto_motivo.includes('comentário'));
  s = await detalharSolicitacao(sql, a3.id); assert.ok(s.auto_motivo.includes('NCM da nota'));
  assert.equal((await processarFilaAutomatica(sql, { ...base, configExtra: config('simulacao') })).avaliadas, 0); // não reavalia igual
  ok('simulação: avalia, registra o motivo de cada uma e não cria nada');

  const agora = Date.now();
  const rodada = await processarFilaAutomatica(sql, { ...base, agora, configExtra: config('automatico') });
  assert.equal(rodada.criadas, 1); assert.equal(rodada.paraAnalise, 0);
  s = await detalharSolicitacao(sql, a1.id);
  assert.ok(['na_fila', 'processando'].includes(s.status)); assert.equal(s.decidido_por, ROBO.email); assert.deepEqual(s.itens.map((i) => i.ncm), ['19059020']); assert.ok(s.itens[0].ncm_padrao);
  s = await detalharSolicitacao(sql, a2.id); assert.equal(s.status, 'aguardando_analise'); // a IA barrou: fica para uma pessoa
  ok('automático: cria só a que passou nas regras e na IA (NCM padrão marcado para revisão); a barrada fica para análise');

  const a4 = await novaAuto('TESTE-AUTO4', 'Pedido ok 2', 'PRODUTO FICTICIO CRIACAO AUTO QUATRO', 'INTERNO(400)');
  const a5 = await novaAuto('TESTE-AUTO5', 'Pedido ok 3', 'PRODUTO FICTICIO CRIACAO AUTO CINCO', 'EMBALAGEM(200)');
  const base2 = { ...base, ids: [a4.id, a5.id] };
  const cedo = await processarFilaAutomatica(sql, { ...base2, agora: agora + 60000, configExtra: config('automatico') });
  assert.equal(cedo.criadas, 0); assert.equal(cedo.aguardandoIntervalo, true);
  const capado = await processarFilaAutomatica(sql, { ...base2, agora: agora + 11 * 60000, configExtra: config('automatico', { limiteAutoPorDia: 1 }) });
  assert.equal(capado.criadas, 0); assert.equal(capado.aguardandoIntervalo, true);
  const depois = await processarFilaAutomatica(sql, { ...base2, agora: agora + 11 * 60000, configExtra: config('automatico') });
  assert.equal(depois.criadas, 1);
  s = await detalharSolicitacao(sql, a4.id); assert.ok(['na_fila', 'processando'].includes(s.status));
  ok('intervalo entre solicitações e limite por dia são respeitados (uma por rodada)');
  await sql`DELETE FROM sync_meta WHERE chave = 'auto_ultima_criacao_teste'`;
  console.log('Alteração de nome / ativar códigos ficam em "Outras tarefas"');
  const alt = await receberTarefa(sql, tarefa('TESTE-ALT', 'Alteração de nome Mães 2027 TESTE', 'PRODUTO ANTIGO A\nPRODUTO ANTIGO B', 'INTERNO(400)'), { origem: 'teste' });
  s = await detalharSolicitacao(sql, alt.id); assert.equal(s.rota, 'alteracao'); assert.equal(s.sugestao, 'analise');
  assert.ok((await listarSolicitacoes(sql, { tipo: 'tarefas', busca: 'Mães 2027 TESTE' })).some((x) => x.id === alt.id));
  assert.ok(!(await listarSolicitacoes(sql, { tipo: 'cadastro', busca: 'Mães 2027 TESTE' })).some((x) => x.id === alt.id));
  await assert.rejects(() => aprovarECriar(sql, usuario, alt.id, SEM_PROCESSAR), /alteração/);
  s = await detalharSolicitacao(sql, alt.id); assert.equal(s.lote_id, null); assert.equal(s.status, 'aguardando_analise');
  ok('pedido de alteração vai para "Outras tarefas", não aparece em produtos novos e não pode criar código');
  console.log('IA confere a família (GAVETEIRO pedido como SUPRIMENTOS)');
  const fam = await receberTarefa(sql, tarefa('TESTE-FAM', 'Pedido família TESTE', 'GAVETEIRO ORGANIZADOR TESTE\nPAPEL HIGIENICO TESTE', 'SUPRIMENTOS(700)'), { origem: 'teste' });
  s = await detalharSolicitacao(sql, fam.id); assert.equal(s.sugestao, 'automatica');
  const iaFam = async (_t, _f, nomes) => nomes.map((d) => (d.includes('GAVETEIRO') ? { descricao: d, prefixo: '800', confianca: 'alta', motivo: 'móvel' } : { descricao: d, prefixo: '700', confianca: 'alta', motivo: '' }));
  const rf = await conferirFamilia(sql, fam.id, { ia: iaFam });
  assert.equal(rf.divergencias, 1);
  s = await detalharSolicitacao(sql, fam.id);
  assert.equal(s.sugestao, 'analise'); assert.ok(s.motivos.some((m) => m.startsWith('IA:') && m.includes('ATIVO')));
  assert.ok(s.itens.find((i) => i.descricao.includes('GAVETEIRO')).avisos.some((a) => a.startsWith('IA: ')));
  assert.equal(s.itens.find((i) => i.descricao.includes('PAPEL')).avisos.length, 0);
  assert.equal(s.ia_familia.itens.filter((x) => x.diverge).length, 1);
  await conferirFamilia(sql, fam.id, { ia: iaFam }); // repetir não acumula avisos
  s = await detalharSolicitacao(sql, fam.id); assert.equal(s.motivos.filter((m) => m.startsWith('IA:')).length, 1);
  await conferirFamilia(sql, fam.id, { ia: async (_t, _f, nomes) => nomes.map((d) => ({ descricao: d, prefixo: '700', confianca: 'alta', motivo: '' })) });
  s = await detalharSolicitacao(sql, fam.id); assert.equal(s.sugestao, 'automatica'); assert.equal(s.motivos.length, 0);
  ok('a IA aponta item de outra família, vira alerta (sem alertas só quando some), e repetir não duplica');
  console.log('Dúvida da IA comentada na tarefa (uma vez por dúvida)');
  const duvidas = [];
  const comentarOk = async (_s, _id, texto) => { duvidas.push(texto); return { enviado: true }; };
  const iaMescla = async (_t, _f, nomes) => nomes.map((d) => ({ descricao: d, prefixo: '1010', confianca: 'alta', motivo: 'é um insumo de produção' }));
  const f1 = await receberTarefa(sql, tarefa('TESTE-FAM', 'Mesclado', 'MESCLADO CHOCOLATE AVELA TESTE', 'SUPRIMENTOS(700)'), { origem: 'teste', familiaIA: async () => { throw new Error('IA fora'); } });
  const d1 = await conferirFamilia(sql, f1.id, { ia: iaMescla, comentar: comentarOk });
  assert.equal(d1.comentario.enviado, true); assert.equal(duvidas.length, 1);
  assert.ok(duvidas[0].includes('MESCLADO CHOCOLATE AVELA') && duvidas[0].includes('1010') && duvidas[0].includes(`#${f1.id}`) && duvidas[0].includes('Suprimentos (700)'));
  const d2 = await conferirFamilia(sql, f1.id, { ia: iaMescla, comentar: comentarOk });
  assert.equal(d2.comentario.enviado, false); assert.equal(duvidas.length, 1); // mesma dúvida: não repete
  await sql`UPDATE solicitacoes SET ia_comentado_hash = NULL WHERE id = ${f1.id}`;
  const desligado = await conferirFamilia(sql, f1.id, { ia: iaMescla, comentar: async () => ({ enviado: false, motivo: 'desligado' }) });
  assert.equal(desligado.comentario.enviado, false);
  const [{ ia_comentado_hash: h1 }] = await sql`SELECT ia_comentado_hash FROM solicitacoes WHERE id = ${f1.id}`; assert.equal(h1, null); // desligado não gasta a dúvida
  const falha = await conferirFamilia(sql, f1.id, { ia: iaMescla, comentar: async () => { throw new Error('ClickUp fora'); } });
  assert.equal(falha.comentario.enviado, false);
  const d3 = await conferirFamilia(sql, f1.id, { ia: iaMescla, comentar: comentarOk });
  assert.equal(d3.comentario.enviado, true); assert.equal(duvidas.length, 2); // ligou depois: agora comenta
  ok('a IA comenta uma vez por dúvida; desligado ou falha não consome a dúvida; ao ligar, comenta');

  console.log('Produto já cadastrado no Omie: reaproveita o código certo, bloqueia o errado');
  await sql`INSERT INTO omie_produtos (codigo, descricao, descricao_norm, codigo_produto, inativo) VALUES ('7009901', 'PRODUTO FICTICIO REUSO TESTE', 'PRODUTO FICTICIO REUSO TESTE', 1234, false), ('99998', 'PRODUTO FICTICIO ERRADO TESTE', 'PRODUTO FICTICIO ERRADO TESTE', 1235, false)`;
  const ru = await receberTarefa(sql, tarefa('TESTE-REUSO', 'Reuso', 'TESTE REUSO PRODUTO FICTICIO\nPRODUTO FICTICIO ERRADO TESTE', 'SUPRIMENTOS(700)'), { origem: 'teste', familiaIA: null });
  s = await detalharSolicitacao(sql, ru.id);
  assert.ok(s.itens[0].avisos.some((a) => a.includes('reaproveitado')) && s.itens[0].parecidos[0].situacao === 'correto');
  assert.ok(s.itens[1].avisos.some((a) => a.includes('fora do padrão')));
  await editarItens(sql, usuario, ru.id, { itens: s.itens.map((i) => ({ ...i, ncm: '84198190' })) });
  await assert.rejects(() => aprovarECriar(sql, usuario, ru.id, SEM_PROCESSAR), /fora do padrão/); // 99998 bloqueia tudo, nada é criado
  assert.equal((await sql`SELECT count(*)::int AS n FROM cadastros WHERE codigo = '7009901'`)[0].n, 0);
  s = await detalharSolicitacao(sql, ru.id); assert.equal(s.lote_id, null); assert.equal(s.status, 'aguardando_analise');
  await editarItens(sql, usuario, ru.id, { itens: s.itens.filter((i) => i.descricao.includes('REUSO')).map((i) => ({ ...i, ncm: '84198190' })) });
  await aprovarECriar(sql, usuario, ru.id, SEM_PROCESSAR);
  const [cad] = await sql`SELECT * FROM cadastros WHERE codigo = '7009901'`;
  assert.equal(cad.acao, 'JaCadastrado'); assert.equal(cad.omie_status, 'ok'); assert.equal(cad.nexaas_status, 'pendente'); assert.equal(cad.familia_prefixo, '700'); assert.equal(String(cad.omie_id), '1234');
  s = await detalharSolicitacao(sql, ru.id);
  assert.equal(s.itens[0].codigo_gerado, '7009901'); assert.equal(s.itens[0].cadastro_id, cad.id);
  const { linhaDoComentario } = await import('../api/_lib/solicitacoes.js');
  assert.ok(linhaDoComentario({ codigo_gerado: '7009901', descricao: 'X', acao: 'JaCadastrado', nexaas_origem: 'criado', descricao_omie: 'PRODUTO OMIE' }).includes('já estava cadastrado no Omie; cadastrado agora no Nexaas'));
  assert.ok(linhaDoComentario({ codigo_gerado: '4000001', descricao: 'Y', acao: null }).includes('criado agora'));
  ok('nome igual com código certo é reaproveitado (Omie não é recadastrado, só o Nexaas fica na fila); código fora do padrão bloqueia tudo sem criar nada');
  console.log('\nTUDO OK');
} catch (erro) {
  console.error(`FALHOU: ${erro.message}`);
  process.exitCode = 1;
} finally {
  await limpar();
  console.log('(linhas de teste apagadas)');
  process.exit(process.exitCode ?? 0);
}
