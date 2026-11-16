// Verifica a Fase 1 das solicitações do ClickUp com tarefas FICTÍCIAS (origem "teste"): não toca no ClickUp,
// não cria nada no Omie nem no Nexaas. Grava e apaga linhas nas tabelas de solicitações do Neon.
// Uso: npm run verificar-solicitacoes
import assert from 'node:assert/strict';
import { sql } from '../api/_lib/db.js';
import { garantirEsquema } from '../api/_lib/schema.js';
import { chaveDoEvento } from '../api/_lib/clickup.js';
import { decidir, detalharSolicitacao, editarItens, gravarConfig, lerConfig, listarSolicitacoes, receberTarefa, tratarEvento } from '../api/_lib/solicitacoes.js';

await garantirEsquema();
const usuario = { email: 'teste-automatizado@skbiscoite' };
const campos = (familia) => [
  { id: 'a', name: 'Família de Produto', type: 'drop_down', value: { name: familia } },
  { id: 'b', name: 'Tipo de Identificação', type: 'drop_down', value: { name: 'Código' } },
];
const tarefa = (id, name, text, familia = 'SUPRIMENTOS') => ({ id, name, text_content: text, status: { status: 'kauã' }, custom_fields: campos(familia), date_updated: '1' });
const IDS = ['TESTE-5', 'TESTE-19', 'TESTE-DUP', 'TESTE-OUTRA'];
const limpar = async () => { await sql`DELETE FROM solicitacoes WHERE clickup_task_id = ANY(${IDS})`; await sql`DELETE FROM clickup_eventos WHERE task_id = ANY(${IDS})`; await sql`DELETE FROM solicitacoes_log WHERE usuario = ${usuario.email}`; };
await limpar();
const ok = (m) => console.log('  ✓', m);

try {
  console.log('Critério 1: 5 produtos na descrição -> 5 itens, prévia editável');
  const cinco = ['PRODUTO FICTICIO ALFA 1 UN', 'PRODUTO FICTICIO BETA 2 UN', 'PRODUTO FICTICIO GAMA 3 UN', 'PRODUTO FICTICIO DELTA 4 UN', 'PRODUTO FICTICIO EPSILON 5 UN'].join('\n');
  const r1 = await receberTarefa(sql, tarefa('TESTE-5', 'Cód 7000 (teste fictício)', cinco), { origem: 'teste' });
  assert.equal(r1.resultado, 'nova');
  let s = await detalharSolicitacao(sql, r1.id);
  assert.equal(s.itens.length, 5); assert.equal(s.status, 'aguardando_analise'); assert.equal(s.sugestao, 'automatica'); assert.equal(s.prefixo_codigo, '7000');
  ok('5 itens lidos, faixa 7000, sugestão "automática" (mas nada é criado: status aguardando análise)');
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
  console.log('\nTUDO OK');
} catch (erro) {
  console.error(`FALHOU: ${erro.message}`);
  process.exitCode = 1;
} finally {
  await limpar();
  console.log('(linhas de teste apagadas)');
  process.exit(process.exitCode ?? 0);
}
