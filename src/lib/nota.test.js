import test from 'node:test';
import assert from 'node:assert/strict';
import { lerItensDaNota, ligarProdutosAosItensDaNota, validarRespostaDaIA, trechoDosProdutos } from './nota.js';

// Texto no formato que o leitor de PDF devolve para um DANFE (dados fictícios).
const NOTA = `RECEBEMOS DE EMPRESA FICTICIA LTDA ...
DADOS DOS PRODUTOS / SERVIÇOS
CÓDIGO PRODUTO DESCRIÇÃO DO PRODUTO / SERVIÇO NCM/SH O/CST CFOP UN QUANT VALOR UNIT VALOR TOTAL B.CÁLC
ICMS VALOR
ICMS VALOR
IPI ALÍQ.
ICMS ALÍQ.
IPI
01 PAPEL HIGIENICO INTERFOLHADO MARCA X FOLHA DUPLA -
CAIXA COM 6.000 48181000 000 5102 un 2 167,63 335,26 335,26 60,34 18,00
02 TOALHA 2 DOBRAS MARCA X FOLHA DUPLA 22,5 X 21,0cm
- FARDO COM 2.000 FOLHAS 48182000 000 5102 un 2 87,30 174,60 174,60 31,42 18,00
ABC123 CADEIRA ESCRITORIO GIRATORIA PRETA 94013000 0102 5102 UN 1 450,00 450,00 0,00 0,00
DADOS ADICIONAIS
INFORMAÇÕES COMPLEMENTARES
Código de barras 12345678 não é NCM`;

test('acha as linhas de produto e o NCM de cada uma', () => {
  const itens = lerItensDaNota(NOTA);
  assert.deepEqual(itens.map((i) => i.ncm), ['48181000', '48182000', '94013000']);
  assert.ok(itens[0].descricao.includes('PAPEL HIGIENICO INTERFOLHADO') && itens[0].descricao.includes('CAIXA COM 6.000'));
  assert.ok(itens[1].descricao.startsWith('TOALHA 2 DOBRAS'));
  assert.ok(itens[2].descricao.includes('CADEIRA ESCRITORIO'));
});

test('o trecho enviado à IA não inclui dados do fornecedor nem informações complementares', () => {
  const trecho = trechoDosProdutos(NOTA);
  assert.ok(!trecho.includes('EMPRESA FICTICIA') && !trecho.includes('INFORMAÇÕES'));
  assert.ok(trecho.includes('48181000'));
});

test('liga cada produto pedido à linha da nota pelo nome', () => {
  const itens = lerItensDaNota(NOTA);
  const r = ligarProdutosAosItensDaNota(['PAPEL HIGIENICO INTERFOLHADO MARCA X FOLHA DUPLA - CAIXA COM 6.000', 'TOALHA 2 DOBRAS MARCA X FOLHA DUPLA 22,5 X 21,0CM - FARDO COM 2.000 FOLHAS', 'CADEIRA GIRATORIA PRETA', 'PRODUTO QUE NAO ESTA NA NOTA'], itens);
  assert.deepEqual(r.map((x) => x.ncm), ['48181000', '48182000', '94013000', null]);
  assert.equal(r[0].linha, 1);
  assert.ok(r[3].motivo.includes('Nenhuma linha'));
});

test('duas linhas parecidas com NCMs diferentes: não escolhe sozinho', () => {
  const itens = [{ ordem: 1, descricao: 'LUVA LATEX M', ncm: '40151100' }, { ordem: 2, descricao: 'LUVA LATEX M', ncm: '40159000' }];
  assert.equal(ligarProdutosAosItensDaNota(['LUVA LATEX M'], itens)[0].ncm, null);
  const iguais = [{ ordem: 1, descricao: 'LUVA LATEX M', ncm: '40151100' }, { ordem: 2, descricao: 'LUVA LATEX M CX', ncm: '40151100' }];
  assert.equal(ligarProdutosAosItensDaNota(['LUVA LATEX M'], iguais)[0].ncm, '40151100');
});

test('resposta da IA: só vale NCM de 8 dígitos que exista no texto da nota', () => {
  assert.equal(validarRespostaDaIA({ ncm: '4818.10.00' }, NOTA), '48181000');
  assert.equal(validarRespostaDaIA({ ncm: '99999999' }, NOTA), null); // inventado
  assert.equal(validarRespostaDaIA({ ncm: '4818' }, NOTA), null);
  assert.equal(validarRespostaDaIA({ ncm: null }, NOTA), null);
});
