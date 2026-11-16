import test from 'node:test';
import assert from 'node:assert/strict';
import { analisarSolicitacao, acharParecidos, lerFaixaDoTitulo, lerLinhasDaDescricao, lerTarefaClickUp, prefixoDaFamiliaDoCampo, prepararCatalogo } from './solicitacoes.js';

// Tarefas reais do formulário (nomes de produtos; sem dados pessoais), no formato da API do ClickUp.
const campos = (familia, ident = 'Código') => [
  { id: 'f1', name: 'Família de Produto', type: 'drop_down', value: { name: familia } },
  { id: 'f2', name: 'Tipo de Identificação', type: 'drop_down', value: { name: ident } },
  { id: 'f3', name: 'Quem está solicitando', type: 'users', value: [{ username: 'Fulano' }] },
];
const tarefa = (name, text, familia = 'SUPRIMENTOS', extra = {}) => lerTarefaClickUp({
  id: 't1', name, text_content: text, status: { status: 'kauã' }, custom_fields: campos(familia), date_updated: '1', ...extra,
});

const OITO = 'BACTER PEROXY FOOD GL 5 LTS\nGRILL MAX GL 5 LTS\nMELANGE -19 CX/3 RF 500ML\nNEUTRE CX/3 RF 500ML\nBACTER MAR VERDE GL 5 LTS\nDET WASH GL 5 LTS\nVIVACITE CX/3 RF 500ML\nECO BIONATIVE BD 3KGS';

test('faixa do título e família do campo', () => {
  for (const t of ['Cód 7000 (mat de escritório)', 'Item entra no Cód 7000 (Mat. de escritório)', 'CNEUTRE CX/3 RF 500ML (item entra no cód 7000)', 'Kit 5 Placas (Cód 7000)', 'Cód 7000 (Mat. de escritório )']) assert.equal(lerFaixaDoTitulo(t), '7000', t);
  assert.equal(lerFaixaDoTitulo('Alteração de nome Mães 2027'), null);
  assert.equal(prefixoDaFamiliaDoCampo('SUPRIMENTOS'), '700');
  assert.equal(prefixoDaFamiliaDoCampo('INTERNO'), '400');
  assert.equal(prefixoDaFamiliaDoCampo('ATIVO'), '800');
  assert.equal(prefixoDaFamiliaDoCampo('ENVASE'), '1010');
  assert.equal(prefixoDaFamiliaDoCampo(''), null);
});

test('critério 1: 5 produtos na descrição viram 5 itens lidos', () => {
  const a = analisarSolicitacao(tarefa('Cód 7000 (mat de escritório)', OITO.split('\n').slice(0, 5).join('\n')));
  assert.equal(a.itens.length, 5);
  assert.deepEqual(a.itens.map((i) => i.descricao).slice(0, 3), ['BACTER PEROXY FOOD GL 5 LTS', 'GRILL MAX GL 5 LTS', 'MELANGE -19 CX/3 RF 500ML']);
  assert.equal(a.prefixoCodigo, '7000');
  assert.equal(a.sugestao, 'automatica');
  assert.deepEqual(a.motivos, []);
});

test('lista com marcadores, numeração, vazias, cabeçalho e repetidas', () => {
  const { itens, ignoradas } = lerLinhasDaDescricao('Produtos:\n\n- GARRAFA TERMICA 1L\n2) COPO DESCARTAVEL 200ML  \n* garrafa termica 1l\n---\n');
  assert.deepEqual(itens.map((i) => i.descricao), ['GARRAFA TERMICA 1L', 'COPO DESCARTAVEL 200ML']);
  assert.equal(ignoradas.length, 2);
});

test('critério 2: mais de 10 itens vai para análise', () => {
  const dezenove = Array.from({ length: 19 }, (_, i) => `PRODUTO DE TESTE ${i + 1} UN`).join('\n');
  const a = analisarSolicitacao(tarefa('Cód 7000 (Mat. de escritório )', dezenove));
  assert.equal(a.itens.length, 19);
  assert.equal(a.sugestao, 'analise');
  assert.ok(a.motivos.some((m) => m.includes('19 itens')));
});

test('título e campo em conflito vão para análise', () => {
  const a = analisarSolicitacao(tarefa('Kit 5 Placas Livre Ocupado (Cód 7000)', 'Kit 5 Placas Livre Ocupado', 'ATIVO'));
  assert.equal(a.sugestao, 'analise');
  assert.ok(a.motivos[0].includes('Conflito'));
  const b = analisarSolicitacao(tarefa('Cód 7000 (Mat de Escritório)', 'PAPEL HIGIENICO INTERFOLHADO CAIXA COM 6.000', 'INTERNO'));
  assert.equal(b.sugestao, 'analise');
});

test('SUPRIMENTOS sem faixa no título pede análise; outras famílias seguem', () => {
  assert.equal(analisarSolicitacao(tarefa('Pedido de cadastro', 'LUVA DE LATEX M', 'SUPRIMENTOS')).sugestao, 'analise');
  assert.equal(analisarSolicitacao(tarefa('Pedido de cadastro', 'CAIXA DE PAPELAO 30X20', 'EMBALAGEM')).sugestao, 'automatica');
});

test('pedido que cita código existente do Omie vira rota "importar"', () => {
  const a = analisarSolicitacao(tarefa('Preciso que cadastra esse item igual como está no omie ( 7004083 FORNO IND ELETRICO PANIF )', 'Preciso que cadastra esse item igual como está no omie ( 7004083 FORNO IND ELETRICO PANIF )\nNão achei esse item cadastrado no nexas', 'ATIVO'));
  assert.equal(a.rota, 'importar');
  assert.equal(a.sugestao, 'analise');
});

test('sem descrição usa o título; sem nada, análise', () => {
  const a = analisarSolicitacao(tarefa('CNEUTRE CX/3 RF 500ML (item entra no cód 7000)', ''));
  assert.deepEqual(a.itens.map((i) => i.descricao), ['CNEUTRE CX/3 RF 500ML']);
  assert.equal(a.sugestao, 'analise');
  assert.equal(analisarSolicitacao(tarefa('Cód 7000 (x)', '')).itens.length, 0);
});

test('produto igual ou parecido no Omie bloqueia o automático', () => {
  const cat = prepararCatalogo([{ codigo: '7000500', descricao: 'NEUTRE CX/3 RF 500ML' }, { codigo: '7000501', descricao: 'CAFE EM PO 500G' }]);
  assert.equal(acharParecidos('neutre cx/3 rf 500ml', cat)[0].similaridade, 1);
  assert.equal(acharParecidos('NEUTRE CX/3 RF 1L', cat).length, 0); // 3 de 5 palavras: abaixo de 0,8
  const a = analisarSolicitacao(tarefa('Cód 7000 (x)', 'NEUTRE CX/3 RF 500ML'), cat);
  assert.equal(a.sugestao, 'analise');
  assert.ok(a.itens[0].avisos[0].includes('7000500'));
});

test('tarefa sem os campos do formulário não é cadastro', () => {
  const t = lerTarefaClickUp({ id: 'x', name: 'IMPLANTAÇÃO | Biscoitê Continental', text_content: 'Checklist', custom_fields: [] });
  assert.equal(t.ehCadastro, false);
  assert.equal(analisarSolicitacao(t).sugestao, 'analise');
});

test('linha com vários produtos ou longa demais recebe aviso', () => {
  const { itens } = lerLinhasDaDescricao(`COPO 200ML; COPO 300ML\n${'A'.repeat(130)}`);
  assert.ok(itens[0].avisos[0].includes('mais de um produto'));
  assert.ok(itens[1].avisos[0].includes('120'));
});
