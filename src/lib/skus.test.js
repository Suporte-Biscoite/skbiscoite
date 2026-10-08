import test from 'node:test';
import assert from 'node:assert/strict';
import { FAMILIAS, resolverFamilia, obterFamiliaPorPrefixo } from './familias.js';
import {
  encontrarProximaVaga,
  registrarProdutoLocal,
  ehErroDeCodigoDuplicado,
  lerLinhasDaPlanilha,
} from './skus.js';

const prod = (codigo, descricao = 'ALGUM PRODUTO', codigo_produto) => ({ codigo, descricao, codigo_produto });

test('tabela de famílias bate com o combinado', () => {
  const tabela = Object.fromEntries(FAMILIAS.map((f) => [f.prefixo, f.familia]));
  assert.deepEqual(tabela, {
    1010: 'INSUMOS PARA ENVASE',
    200: 'EMBALAGEM',
    300: 'PRODUTOS PARA REVENDA',
    400: 'PRODUTOS PRONTOS',
    500: 'CESTAS/KIT',
    700: 'SUPRIMENTOS',
    800: 'ATIVO',
  });
});

test('resolverFamilia aceita nome da família, grupo, prefixo e textos antigos', () => {
  assert.equal(resolverFamilia('Produtos Prontos').prefixo, '400');
  assert.equal(resolverFamilia('CESTAS / KIT').prefixo, '500');
  assert.equal(resolverFamilia('insumos para envase').prefixo, '1010');
  assert.equal(resolverFamilia('INTERNO').prefixo, '400');
  assert.equal(resolverFamilia('KITS').prefixo, '500');
  assert.equal(resolverFamilia('ATIVOS').prefixo, '800');
  assert.equal(resolverFamilia('ATIVO').prefixo, '800');
  assert.equal(resolverFamilia(400).prefixo, '400');
  assert.equal(resolverFamilia('1010 - ENVASE').prefixo, '1010');
  assert.equal(resolverFamilia('CESTAS').prefixo, '500');
  assert.equal(resolverFamilia('suprimentos').familia, 'SUPRIMENTOS');
});

test('resolverFamilia rejeita o que não reconhece', () => {
  assert.equal(resolverFamilia(''), null);
  assert.equal(resolverFamilia('INATIVO'), null);
  assert.equal(resolverFamilia('999'), null);
  assert.equal(resolverFamilia('QUALQUER COISA'), null);
});

test('gap: usa o primeiro buraco da sequência', () => {
  const lista = [prod('4000001'), prod('4000002'), prod('4000004'), prod('4000005')];
  assert.deepEqual(encontrarProximaVaga(lista, '400'), { codigo: '4000003', acao: 'IncluirProduto' });
});

test('sem buraco: pega o último + 1', () => {
  const lista = [prod('4000001'), prod('4000002'), prod('4000003')];
  assert.equal(encontrarProximaVaga(lista, '400').codigo, '4000004');
});

test('família vazia começa no 1, e prefixo 1010 usa 3 dígitos de sequência', () => {
  assert.equal(encontrarProximaVaga([], '400').codigo, '4000001');
  assert.equal(encontrarProximaVaga([], '1010').codigo, '1010001');
});

test('não mistura famílias: códigos de outro prefixo são ignorados', () => {
  const lista = [prod('3000001'), prod('2000001'), prod('4000001')];
  assert.equal(encontrarProximaVaga(lista, '400').codigo, '4000002');
  assert.equal(encontrarProximaVaga(lista, '500').codigo, '5000001');
});

test('stand-by é reaproveitado com AlterarProduto e leva o id do Omie', () => {
  const lista = [prod('4000001'), prod('4000002', 'Produto Indefinido', 987), prod('4000003')];
  assert.deepEqual(encontrarProximaVaga(lista, '400'), {
    codigo: '4000002',
    acao: 'AlterarProduto',
    codigo_produto: 987,
  });
});

test('aceita lista de strings (formato antigo da API)', () => {
  assert.equal(encontrarProximaVaga(['4000001', '4000002'], '400').codigo, '4000003');
});

test('lote: cada linha recebe um código novo e diferente', () => {
  const lista = [prod('4000001'), prod('4000003')];
  const gerados = [];
  for (const desc of ['A', 'B', 'C']) {
    const vaga = encontrarProximaVaga(lista, '400');
    registrarProdutoLocal(lista, vaga, desc, 1);
    gerados.push(vaga.codigo);
  }
  assert.deepEqual(gerados, ['4000002', '4000004', '4000005']);
});

test('lote: sobrescrever stand-by marca o código como usado', () => {
  const lista = [prod('4000001', 'PRODUTO INDEFINIDO', 11), prod('4000002', 'PRODUTO INDEFINIDO', 12)];
  const a = encontrarProximaVaga(lista, '400');
  registrarProdutoLocal(lista, a, 'NOVO A', 11);
  const b = encontrarProximaVaga(lista, '400');
  registrarProdutoLocal(lista, b, 'NOVO B', 12);
  assert.deepEqual([a.codigo, b.codigo], ['4000001', '4000002']);
  assert.equal(encontrarProximaVaga(lista, '400').codigo, '4000003');
});

test('códigos recusados (ocupados) são pulados na próxima tentativa', () => {
  const lista = [prod('4000001')];
  const ocupados = new Set(['4000002', '4000003']);
  assert.equal(encontrarProximaVaga(lista, '400', { ocupados }).codigo, '4000004');
});

test('prefixo inválido gera erro claro', () => {
  assert.throws(() => encontrarProximaVaga([], 'ABC'), /Prefixo inválido/);
  assert.throws(() => encontrarProximaVaga([], '1234567'), /Prefixo inválido/);
});

test('detecta erro de código duplicado do Omie', () => {
  assert.equal(ehErroDeCodigoDuplicado('ERROR: Já existe um produto cadastrado com o código 4000003'), true);
  assert.equal(ehErroDeCodigoDuplicado('Código de integração já cadastrado'), true);
  assert.equal(ehErroDeCodigoDuplicado('NCM inválido'), false);
  assert.equal(ehErroDeCodigoDuplicado('O Omie recusou a operação.'), false);
});

test('planilha: acha o cabeçalho, aceita acento e CATEGORIA antiga, numera as linhas do Excel', () => {
  const matriz = [
    ['Planilha de Importação de SKUs', '', ''],
    ['Módulo: Gestão de Produtos Biscoitê', '', ''],
    ['(obrigatório)\nEscolha na lista', '(obrigatório)\nNome', '(opcional)\nNCM'],
    ['FAMÍLIA', 'DESCRIÇÃO', 'NCM'],
    ['PRODUTOS PRONTOS', 'BISCOITO GOIABA', 19059020],
    ['', '', ''],
    [400, 'BISCOITO COCO', 4061010],
  ];
  const linhas = lerLinhasDaPlanilha(matriz);
  assert.deepEqual(linhas, [
    { linha: 5, familia: 'PRODUTOS PRONTOS', descricao: 'BISCOITO GOIABA', ncm: '19059020' },
    { linha: 7, familia: '400', descricao: 'BISCOITO COCO', ncm: '04061010' },
  ]);

  const antiga = [['CATEGORIA', 'DESCRICAO', 'NCM'], ['400', 'X', '']];
  assert.equal(lerLinhasDaPlanilha(antiga)[0].familia, '400');
});

test('planilha sem cabeçalho reconhecível dá erro claro', () => {
  assert.throws(() => lerLinhasDaPlanilha([['a', 'b'], ['c', 'd']]), /cabeçalho/);
});

test('obterFamiliaPorPrefixo', () => {
  assert.equal(obterFamiliaPorPrefixo('800').familia, 'ATIVO');
  assert.equal(obterFamiliaPorPrefixo('999'), null);
});

// ---- Lote contra um Omie simulado ----------------------------------------------------------
import { cadastrarComVaga } from './skus.js';

// Omie falso: recusa código repetido (como o real) e guarda o que foi criado.
const criarOmieFalso = (jaExistem = []) => {
  const banco = new Map(jaExistem.map((c) => [c, 'EXISTENTE']));
  const chamadas = [];
  const cadastrar = async ({ codigo, descricao, acao }) => {
    chamadas.push({ codigo, acao });
    if (acao === 'IncluirProduto' && banco.has(codigo)) {
      throw new Error(`Já existe um produto cadastrado com o código ${codigo}`);
    }
    banco.set(codigo, descricao);
    return { sucesso: true, omie_id: banco.size, familia_id: 1 };
  };
  return { banco, chamadas, cadastrar };
};

test('lote de 5 produtos: todos entram, cada um com código diferente', async () => {
  const omie = criarOmieFalso(['4000001', '4000003']);
  const produtos = [prod('4000001'), prod('4000003')];
  const ocupados = new Set();
  const familia = resolverFamilia('PRODUTOS PRONTOS');
  const criados = [];
  for (const nome of ['A', 'B', 'C', 'D', 'E']) {
    const r = await cadastrarComVaga(omie.cadastrar, { produtos, ocupados, familia, descricao: nome, ncm: '' });
    criados.push(r.codigo);
  }
  assert.deepEqual(criados, ['4000002', '4000004', '4000005', '4000006', '4000007']);
});

test('lista do Omie incompleta: a colisão é absorvida e o lote continua', async () => {
  // O Omie já tem 4000002 e 4000003, mas a nossa lista veio sem eles (página perdida).
  const omie = criarOmieFalso(['4000001', '4000002', '4000003']);
  const produtos = [prod('4000001')];
  const ocupados = new Set();
  const familia = resolverFamilia('PRODUTOS PRONTOS');
  const criados = [];
  for (const nome of ['A', 'B', 'C']) {
    const r = await cadastrarComVaga(omie.cadastrar, { produtos, ocupados, familia, descricao: nome, ncm: '' });
    criados.push(r.codigo);
  }
  assert.deepEqual(criados, ['4000004', '4000005', '4000006']);
  // gastou 2 tentativas só na primeira linha; as outras já acertaram de primeira
  assert.equal(omie.chamadas.length, 5);
});

test('erro que não é de código duplicado sobe com o código anexado e não é repetido', async () => {
  const cadastrar = async () => { throw new Error('NCM inválido'); };
  const familia = resolverFamilia('SUPRIMENTOS');
  await assert.rejects(
    cadastrarComVaga(cadastrar, { produtos: [], ocupados: new Set(), familia, descricao: 'X', ncm: '' }),
    (err) => err.message === 'NCM inválido' && err.codigo === '7000001'
  );
});

test('stand-by no lote: usa AlterarProduto com o id do Omie e depois segue para o próximo', async () => {
  const chamadas = [];
  const cadastrar = async (dados) => { chamadas.push(dados); return { omie_id: 1 }; };
  const produtos = [prod('4000001', 'PRODUTO INDEFINIDO', 555)];
  const familia = resolverFamilia('400');
  const a = await cadastrarComVaga(cadastrar, { produtos, ocupados: new Set(), familia, descricao: 'NOVO', ncm: '' });
  const b = await cadastrarComVaga(cadastrar, { produtos, ocupados: new Set(), familia, descricao: 'OUTRO', ncm: '' });
  assert.equal(a.acao, 'AlterarProduto');
  assert.equal(chamadas[0].codigo_produto, 555);
  assert.equal(chamadas[0].familia, 'PRODUTOS PRONTOS');
  assert.equal(b.codigo, '4000002');
  assert.equal(b.acao, 'IncluirProduto');
});
