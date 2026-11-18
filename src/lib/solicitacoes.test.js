import test from 'node:test';
import assert from 'node:assert/strict';
import { chaveCanonica, situacaoDoCodigo, ehPedidoDeAlteracao, analisarSolicitacao, acharParecidos, lerFaixaDoTitulo, lerLinhasDaDescricao, lerTarefaClickUp, prefixoDaFamiliaDoCampo, prepararCatalogo } from './solicitacoes.js';

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
  assert.equal(a.faixa, '7000'); // o título cita 7000 (é a família 700); o código nasce do prefixo 700
  assert.equal(a.prefixoCodigo, '700');
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

test('alteração de nome e ativar códigos vão para "Outras tarefas"; produto novo não', () => {
  for (const t of ['Alteração de nome Mães 2027', 'alteração nome produtos Natal', 'Ativar códigos da linha Páscoa', 'Inativar código 4000123', 'Renomear kit']) {
    assert.equal(ehPedidoDeAlteracao(t), true, t);
    assert.equal(analisarSolicitacao(tarefa(t, 'ITEM A\nITEM B', 'INTERNO(400)')).rota, 'alteracao', t);
  }
  assert.equal(ehPedidoDeAlteracao('Pedido', 'Alterar o nome dos produtos abaixo:\nA\nB'), true);
  for (const t of ['GAVETEIRO ORGANIZADOR', 'CX Organizadora Dobrável Multiuso Com Polia Giratória', 'Biscoito Ativador de Fermento']) assert.equal(ehPedidoDeAlteracao(t), false, t);
  const a = analisarSolicitacao(tarefa('Alteração de nome Mães 2027', 'X\nY', 'INTERNO(400)'));
  assert.equal(a.sugestao, 'analise'); assert.equal(a.motivos.length, 1);
});

test('mesmo produto com acento, caixa, ordem e abreviação diferentes é o mesmo nome', () => {
  assert.equal(chaveCanonica('Moinho Astro 12 Instantâneo'), chaveCanonica('INSTANTANEO MOINHO ASTRO 12'));
  assert.equal(chaveCanonica('Neutre CX/3 RF 500ML'), chaveCanonica('NEUTRE CAIXA 3 REFIL 500ML'));
  assert.notEqual(chaveCanonica('TAMPER 53MM INOX'), chaveCanonica('TAMPER 58MM INOX'));
  const cat = prepararCatalogo([{ codigo: '7004083', descricao: 'MOINHO ASTRO 12 INSTANTANEO' }, { codigo: '10360', descricao: 'GAVETA DE BORRA' }]);
  const [a] = acharParecidos('INSTANTANEO MOINHO ASTRO 12', cat, 0.8, 3, '700');
  assert.deepEqual([a.igual, a.situacao], [true, 'correto']);
  assert.equal(acharParecidos('GAVETA DE BORRA', cat, 0.8, 3, '800')[0].situacao, 'fora_da_faixa');
});

test('situação do código: certo, outra família ou fora da faixa', () => {
  assert.equal(situacaoDoCodigo('7004083', '700'), 'correto');
  assert.equal(situacaoDoCodigo('8000103', '700'), 'outra_familia');
  assert.equal(situacaoDoCodigo('10360', '800'), 'fora_da_faixa');
  assert.equal(situacaoDoCodigo('10100001', '1010'), 'fora_da_faixa');
  assert.equal(situacaoDoCodigo('1010001', '1010'), 'correto');
});

test('nomes sobem em MAIÚSCULAS e SEM ACENTO', () => {
  const a = analisarSolicitacao(tarefa('x', 'Caixa Organizadora Dobrável com Polia Giratória\ncafé em pó 500g', 'ATIVO(800)'));
  assert.deepEqual(a.itens.map((i) => i.descricao), ['CAIXA ORGANIZADORA DOBRAVEL COM POLIA GIRATORIA', 'CAFE EM PO 500G']);
});

test('SUPRIMENTOS(700) sem faixa no título NÃO pede análise: o código nasce do prefixo 700, em sequência', () => {
  for (const fam of ['SUPRIMENTOS', 'SUPRIMENTOS(700)']) {
    const a = analisarSolicitacao(tarefa('Gaveteiro Organizador', 'GAVETEIRO ORGANIZADOR PLÁSTICO', fam));
    assert.equal(a.sugestao, 'automatica', fam);
    assert.deepEqual(a.motivos, []);
    assert.equal(a.prefixoCodigo, '700');
  }
  // os 3 casos reais da lista (1 produto, título que é o nome do produto, descrição preenchida)
  for (const [t, d] of [['Kit Banco Alto Dobrável Com Assento Estofado ', 'KIT BANCO ALTO DOBRÁVEL COM ASSENTO ESTOFADO'], ['CX Organizadora Dobrável Multiuso Com Polia Giratória', 'CX ORGANIZADORA DOBRÁVEL MULTIUSO COM POLIA GIRATÓRIA']]) {
    assert.equal(analisarSolicitacao(tarefa(t, d, 'SUPRIMENTOS(700)')).sugestao, 'automatica', t);
  }
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

test('produto idêntico com código certo é caso seguro; parecido ou código errado ainda bloqueia o automático', () => {
  const seguro = prepararCatalogo([{ codigo: '7000500', descricao: 'NEUTRE CX/3 RF 500ML' }, { codigo: '7000999', descricao: 'NEUTRE CX/3 RF 1L PLUS' }]);
  const ok = analisarSolicitacao(tarefa('Cód 7000 (x)', 'NEUTRE CX/3 RF 500ML'), seguro);
  assert.equal(ok.sugestao, 'automatica'); assert.deepEqual(ok.motivos, []);
  assert.ok(ok.itens[0].avisos.some((a) => a.includes('reaproveitado'))); // o aviso informativo continua na tela
  const duplo = prepararCatalogo([{ codigo: '7000500', descricao: 'NEUTRE CX/3 RF 500ML' }, { codigo: '7000501', descricao: 'NEUTRE CX/3 RF 500ML' }]);
  assert.equal(analisarSolicitacao(tarefa('Cód 7000 (x)', 'NEUTRE CX/3 RF 500ML'), duplo).sugestao, 'analise');
  const outraFamilia = prepararCatalogo([{ codigo: '4000500', descricao: 'NEUTRE CX/3 RF 500ML' }]);
  assert.equal(analisarSolicitacao(tarefa('Cód 7000 (x)', 'NEUTRE CX/3 RF 500ML'), outraFamilia).sugestao, 'analise');
  const foraDaFaixa = prepararCatalogo([{ codigo: '10360', descricao: 'NEUTRE CX/3 RF 500ML' }]);
  assert.equal(analisarSolicitacao(tarefa('Cód 7000 (x)', 'NEUTRE CX/3 RF 500ML'), foraDaFaixa).sugestao, 'analise');
  const parecido = prepararCatalogo([{ codigo: '7000500', descricao: 'NEUTRE CX/3 RF 500ML EXTRA' }]);
  assert.equal(analisarSolicitacao(tarefa('Cód 7000 (x)', 'NEUTRE CX/3 RF 500ML'), parecido).sugestao, 'analise');
});

test('produto idêntico no Omie: aviso informativo com o código existente', () => {
  const cat = prepararCatalogo([{ codigo: '7000500', descricao: 'NEUTRE CX/3 RF 500ML' }, { codigo: '7000501', descricao: 'CAFE EM PO 500G' }]);
  assert.equal(acharParecidos('neutre cx/3 rf 500ml', cat)[0].similaridade, 1);
  assert.equal(acharParecidos('NEUTRE CX/3 RF 1L', cat).length, 0); // 3 de 5 palavras: abaixo de 0,8
  const a = analisarSolicitacao(tarefa('Cód 7000 (x)', 'NEUTRE CX/3 RF 500ML'), cat);
  assert.equal(a.sugestao, 'automatica'); // idêntico com código certo: o robô só reaproveita
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

test('formato real da API de lista: campos vazios e repetidos não atrapalham', () => {
  const opcoes = (...nomes) => nomes.map((name, orderindex) => ({ name, orderindex }));
  const t = lerTarefaClickUp({
    id: '868muy2hw', name: 'Cód 7000 (mat de escritório)', text_content: OITO, status: { status: 'kauã' },
    custom_fields: [
      { name: 'Família de Produto', type: 'short_text' }, // outro formulário, vazio
      { name: 'Família de Produto', type: 'drop_down', type_config: { options: opcoes('Externo', 'Interno', 'Embalagem', 'Envase') } }, // outro formulário, vazio
      { name: 'Família de Produto', type: 'drop_down', value: 2, type_config: { options: opcoes('INTERNO', 'EXTERNO', 'SUPRIMENTOS', 'ATIVO', 'EMBALAGEM', 'ENVASE') } },
      { name: 'Tipo de Identificação', type: 'drop_down', value: 0, type_config: { options: opcoes('Código', 'EAN') } },
      { name: 'Quem está solicitando', type: 'users', value: [{ username: 'Fulano' }] },
    ],
  });
  assert.equal(t.familiaCampo, 'SUPRIMENTOS');
  assert.equal(t.tipoIdentificacao, 'Código');
  assert.equal(t.ehCadastro, true);
  assert.equal(analisarSolicitacao(t).prefixoCodigo, '700');
});

test('dois campos "Família de Produto": usa o preenchido; só avisa se os dois divergem', () => {
  const vazio = { id: 'A', name: 'Família de Produto', type: 'drop_down', value: undefined, type_config: { options: [{ name: 'INTERNO(400)', orderindex: 0 }, { name: 'EXTERNO(300)', orderindex: 1 }, { name: 'SUPRIMENTOS(700)', orderindex: 2 }] } };
  const cheio = (valor, id = 'B') => ({ ...vazio, id, value: valor });
  const tipo = { id: 'T', name: 'Tipo de Identificação', type: 'drop_down', value: 0, type_config: { options: [{ name: 'Código', orderindex: 0 }] } };
  const base = { id: '1', name: 'TESTE', text_content: 'PRODUTO TESTE010', status: { status: 'novo' } };
  const um = lerTarefaClickUp({ ...base, custom_fields: [vazio, cheio(2), tipo] });
  assert.equal(um.familiaCampo, 'SUPRIMENTOS(700)');
  assert.deepEqual(um.familiasDivergentes, []);
  assert.equal(analisarSolicitacao(um).sugestao, 'automatica');
  const iguais = lerTarefaClickUp({ ...base, custom_fields: [cheio(2, 'B'), cheio(2, 'C'), tipo] });
  assert.deepEqual(iguais.familiasDivergentes, []);
  const dif = lerTarefaClickUp({ ...base, custom_fields: [cheio(0, 'B'), cheio(2, 'C'), tipo] });
  assert.equal(dif.familiasDivergentes.length, 2);
  assert.ok(analisarSolicitacao(dif).motivos.some((m) => m.includes('Dois campos')));
});

test('regras de alerta que continuam valendo (nada de falso positivo novo)', () => {
  const rodar = (...a) => analisarSolicitacao(tarefa(...a));
  assert.ok(rodar('x', 'ITEM A', 'ATIVO(800)', { campos: undefined }).motivos.length === 0);
  assert.ok(rodar('x', '', 'SUPRIMENTOS(700)').motivos.some((m) => m.includes('Nenhum produto') || m.includes('título')));
  assert.ok(rodar('Cód 400 (x)', 'ITEM A', 'EXTERNO(300)').motivos.some((m) => m.startsWith('Conflito')));
  assert.equal(rodar('x', 'Produtos:\nITEM A\nITEM B', 'ATIVO').sugestao, 'automatica'); // cabeçalho ignorado não alerta
});

test('tarefa de marketing com campos definidos mas vazios não é cadastro', () => {
  const t = lerTarefaClickUp({ id: 'm1', name: '[DIGITAL] PÁSCOA', text_content: 'Plano\nPeças\nDisparo', custom_fields: [
    { name: 'Família de Produto', type: 'drop_down', type_config: { options: [{ name: 'INTERNO', orderindex: 0 }] } },
    { name: 'Tipo de Identificação', type: 'drop_down', type_config: { options: [{ name: 'Código', orderindex: 0 }] } },
  ] });
  assert.equal(t.ehCadastro, false);
});

test('família com o código entre parênteses (formulário novo)', () => {
  assert.equal(prefixoDaFamiliaDoCampo('INTERNO(400)'), '400');
  assert.equal(prefixoDaFamiliaDoCampo('EXTERNO(300)'), '300');
  assert.equal(prefixoDaFamiliaDoCampo('SUPRIMENTOS(700)'), '700');
  assert.equal(prefixoDaFamiliaDoCampo('ATIVO(800)'), '800');
  assert.equal(prefixoDaFamiliaDoCampo('EMBALAGEM(200)'), '200');
  assert.equal(prefixoDaFamiliaDoCampo('ENVASE E MATERIA PRIMA(1010)'), '1010');
  assert.equal(prefixoDaFamiliaDoCampo('INTERNO'), '400'); // formato antigo continua valendo
  assert.equal(prefixoDaFamiliaDoCampo('COISA(999)'), null);
});

test('status do ClickUp: finalizado e cancelado encerram, os demais não', () => {
  const base = { id: '1', name: 'x', custom_fields: [] };
  assert.equal(lerTarefaClickUp({ ...base, status: { status: 'finalizado', type: 'closed' } }).encerramento, 'finalizada');
  assert.equal(lerTarefaClickUp({ ...base, status: { status: 'cancelado', type: 'done' } }).encerramento, 'cancelada');
  assert.equal(lerTarefaClickUp({ ...base, status: { status: 'em progresso', type: 'custom' } }).encerramento, null);
  assert.equal(lerTarefaClickUp({ ...base, status: { status: 'backlog', type: 'open' } }).encerramento, null);
});
