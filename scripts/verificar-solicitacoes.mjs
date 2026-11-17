// Verifica a Fase 1 das solicitações do ClickUp com tarefas FICTÍCIAS (origem "teste"): não toca no ClickUp,
// não cria nada no Omie nem no Nexaas. Grava e apaga linhas nas tabelas de solicitações do Neon.
// Uso: npm run verificar-solicitacoes
import assert from 'node:assert/strict';
import { sql } from '../api/_lib/db.js';
import { garantirEsquema } from '../api/_lib/schema.js';
import { chaveDoEvento } from '../api/_lib/clickup.js';
import { aprovarECriar, atualizarStatusDaTarefa, avancar, tentarDeNovo } from '../api/_lib/criacao.js';
import { decidir, detalharSolicitacao, editarItens, gravarConfig, lerConfig, listarSolicitacoes, receberTarefa, registrarCodigoGerado, tratarEvento } from '../api/_lib/solicitacoes.js';

await garantirEsquema();
const usuario = { email: 'teste-automatizado@skbiscoite' };
const campos = (familia) => [
  { id: 'a', name: 'Família de Produto', type: 'drop_down', value: { name: familia } },
  { id: 'b', name: 'Tipo de Identificação', type: 'drop_down', value: { name: 'Código' } },
];
const tarefa = (id, name, text, familia = 'SUPRIMENTOS') => ({ id, name, text_content: text, status: { status: 'kauã' }, custom_fields: campos(familia), date_updated: '1' });
const IDS = ['TESTE-5', 'TESTE-19', 'TESTE-DUP', 'TESTE-OUTRA', 'TESTE-ENC', 'TESTE-COD', 'TESTE-CRIA'];
const limpar = async () => { await sql`DELETE FROM cadastros WHERE descricao LIKE 'PRODUTO FICTICIO CRIACAO%'`; await sql`DELETE FROM solicitacoes WHERE clickup_task_id = ANY(${IDS})`; await sql`DELETE FROM clickup_eventos WHERE task_id = ANY(${IDS})`; await sql`DELETE FROM solicitacoes_log WHERE usuario = ${usuario.email}`; };
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
  assert.equal(s.itens[0].descricao, 'PRODUTO FICTÍCIO ALFA EDITADO'); assert.equal(s.editado, true);
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
  assert.equal((await lerConfig(sql)).pausado, true);
  await assert.rejects(() => gravarConfig(sql, usuario, { modo: 'automatico' }));
  await gravarConfig(sql, usuario, { pausado: antes.pausado, modo: antes.modo });
  ok('pausa liga/desliga; modo "automatico" é recusado nesta fase');
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
  console.log('\nTUDO OK');
} catch (erro) {
  console.error(`FALHOU: ${erro.message}`);
  process.exitCode = 1;
} finally {
  await limpar();
  console.log('(linhas de teste apagadas)');
  process.exit(process.exitCode ?? 0);
}
