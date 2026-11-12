import test from 'node:test';
import assert from 'node:assert/strict';
import { validarItem, montarProdutoOmie, montarProdutoNexaas, nomeCategoriaNexaas, nomeFamiliaOmie, lerSimNao } from './regras.js';

const base = { descricao: ' biscoito  de teste ', familia: 'PRODUTOS PRONTOS', ncm: '1905.90.20', entraNaLoja: 'Sim' };
const ok = (extra = {}) => {
  const r = validarItem({ ...base, ...extra });
  assert.deepEqual(r.erros, []);
  return r.item;
};

test('validarItem normaliza descrição e exige NCM, loja e família', () => {
  assert.equal(ok().descricao, 'BISCOITO DE TESTE');
  assert.equal(ok().ncm, '19059020');
  assert.match(validarItem({ ...base, ncm: '' }).erros.join(), /NCM é obrigatório/);
  assert.match(validarItem({ ...base, ncm: '123' }).erros.join(), /8 dígitos/);
  assert.match(validarItem({ ...base, entraNaLoja: '' }).erros.join(), /entra na loja/);
  assert.match(validarItem({ ...base, familia: 'XYZ' }).erros.join(), /Família não reconhecida/);
  assert.match(validarItem({ ...base, descricao: '' }).erros.join(), /descrição/);
});

test('NCM do Excel sem zero à esquerda é corrigido', () => {
  assert.equal(ok({ ncm: 4061010 }).ncm, '04061010');
});

test('sazonal exige a família sazonal e troca a família nos dois sistemas', () => {
  assert.match(validarItem({ ...base, sazonal: 'Sim' }).erros.join(), /família sazonal/);
  const item = ok({ sazonal: 'Sim', familiaSazonal: 'natal' });
  assert.equal(nomeFamiliaOmie(item), 'NATAL');
  assert.equal(nomeCategoriaNexaas(item), 'NATAL');
  assert.equal(item.familia.prefixo, '400'); // o prefixo do código continua o da família-base
  assert.equal(nomeFamiliaOmie(ok()), 'PRODUTOS PRONTOS');
});

test('Nexaas: 300 entra como PRODUTOS PRONTOS; fora da loja é sempre ATIVO', () => {
  assert.equal(nomeCategoriaNexaas(ok({ familia: '300' })), 'PRODUTOS PRONTOS');
  assert.equal(nomeCategoriaNexaas(ok({ familia: '200' })), 'EMBALAGEM');
  assert.equal(nomeCategoriaNexaas(ok({ entraNaLoja: 'Não', sazonal: 'Sim', familiaSazonal: 'NATAL' })), 'ATIVO');
});

test('lerSimNao', () => {
  assert.equal(lerSimNao('sim'), true);
  assert.equal(lerSimNao('Não'), false);
  assert.equal(lerSimNao(''), null);
});

test('Omie: manda família, tipo do item, NCM formatado e origem 0', () => {
  const p = montarProdutoOmie(ok(), 425537792, { codigo: '4000001' });
  assert.equal(p.codigo_familia, 425537792);
  assert.equal(p.tipoItem, '04');
  assert.equal(p.ncm, '1905.90.20');
  assert.equal(p.recomendacoes_fiscais.origem_mercadoria, '0');
  assert.equal(p.codigo_produto_integracao, '4000001');
  assert.throws(() => montarProdutoOmie(ok(), null, { codigo: '4000001' }), /Família/);
});

test('Omie: stand-by usa o id interno e não o código de integração', () => {
  const p = montarProdutoOmie(ok(), 1, { codigo: '4000002', codigoProdutoOmie: 999 });
  assert.equal(p.codigo_produto, 999);
  assert.equal('codigo_produto_integracao' in p, false);
});

const cfg = { organizationId: 423, categoriaId: 10, canalEstoqueId: 255 };

test('Nexaas, entra na loja: todos os canais + on-line e off-line + categoria da família', () => {
  const { product } = montarProdutoNexaas(ok(), '4000001', cfg);
  assert.equal(product.visibility, 'both');
  assert.equal(product.visible_to_all_channels, true);
  assert.equal('sale_channel_ids' in product, false);
  assert.equal(product.status, 'active');
  assert.equal(product.name, 'BISCOITO DE TESTE');
  assert.equal(product.measure, 'UN');
  assert.equal(product.origin, 0);
  assert.equal(product.product_purpose, 'resale_third_party_product');
  assert.deepEqual(product.product_skus, [{ code: '4000001', fiscal_code: '4000001', description: 'BISCOITO DE TESTE', active: true }]);
});

test('Nexaas, fora da loja: só ESTOQUE + só off-line (sempre juntos)', () => {
  const { product } = montarProdutoNexaas(ok({ entraNaLoja: 'Não' }), '4000001', cfg);
  assert.equal(product.visibility, 'offline');
  assert.equal(product.visible_to_all_channels, false);
  assert.deepEqual(product.sale_channel_ids, [255]);
  assert.throws(() => montarProdutoNexaas(ok({ entraNaLoja: 'Não' }), '4000001', { ...cfg, canalEstoqueId: null }), /ESTOQUE/);
});

test('Nexaas: sem categoria ou sem NCM não monta', () => {
  assert.throws(() => montarProdutoNexaas(ok(), '1', { ...cfg, categoriaId: null }), /Categoria/);
});

import { entraNaLojaPorCodigo, planejarImportacaoOmie } from './regras.js';

test('importação: só 300 e 400 entram na loja', () => {
  assert.equal(entraNaLojaPorCodigo('3000010'), true);
  assert.equal(entraNaLojaPorCodigo('4000064'), true);
  for (const c of ['1010001', '2000071', '5000023', '7000001', '8000074']) assert.equal(entraNaLojaPorCodigo(c), false);
});

test('importação: planeja categoria e loja a partir do produto do Omie', () => {
  const cats = { 'NATAL': 1, 'PRODUTOS PRONTOS': 2 };
  const base = { codigo: '4000001', descricao: 'bolo  teste', ncm: '1905.90.20', inativo: 'N', descricao_familia: 'PRODUTOS PRONTOS' };
  let r = planejarImportacaoOmie(base, cats);
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.item, { descricao: 'BOLO TESTE', ncm: '19059020', entraNaLoja: true });
  assert.equal(r.categoriaNexaas, 'PRODUTOS PRONTOS');
  assert.equal(planejarImportacaoOmie({ ...base, codigo: '3000001', descricao_familia: 'PRODUTOS PARA REVENDA' }, cats).categoriaNexaas, 'PRODUTOS PRONTOS');
  assert.equal(planejarImportacaoOmie({ ...base, descricao_familia: 'NATAL' }, cats).categoriaNexaas, 'NATAL');
  r = planejarImportacaoOmie({ ...base, descricao_familia: '' }, cats);
  assert.equal(r.categoriaNexaas, 'PRODUTOS PRONTOS'); assert.ok(r.aviso);
  r = planejarImportacaoOmie({ ...base, codigo: '2000001', descricao_familia: 'EMBALAGEM' }, cats);
  assert.equal(r.item.entraNaLoja, false); assert.equal(r.categoriaNexaas, 'ATIVO');
  assert.ok(planejarImportacaoOmie({ ...base, descricao_familia: 'PASCOA' }, cats).erros[0].includes('não existe no Nexaas'));
  assert.ok(planejarImportacaoOmie({ ...base, ncm: '' }, cats).erros[0].includes('NCM'));
  assert.ok(planejarImportacaoOmie({ ...base, inativo: 'S' }, cats).erros[0].includes('inativo'));
});

test('importação: bloqueia código em stand-by e trata "PRODUTO SEM FAMILIA" como sem família', () => {
  const p = { codigo: '4000001', descricao: 'PRODUTO INDEFINIDO 12', ncm: '1905.90.20', inativo: 'N', descricao_familia: 'PRODUTO SEM FAMILIA' };
  assert.ok(planejarImportacaoOmie(p, {}).erros[0].includes('stand-by'));
  const r = planejarImportacaoOmie({ ...p, descricao: 'BOLO' }, {});
  assert.deepEqual(r.erros, []); assert.equal(r.categoriaNexaas, 'PRODUTOS PRONTOS');
});
