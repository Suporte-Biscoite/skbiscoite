import test from 'node:test';
import assert from 'node:assert/strict';
import { acharDivergencias, perguntarFamiliaIA } from './familia-ia.js';

const resposta = (itens) => async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ itens }) } }] }) });

test('a IA devolve uma família por produto, na ordem pedida', async () => {
  const r = await perguntarFamiliaIA('Pedido', 'SUPRIMENTOS(700)', ['GAVETEIRO ORGANIZADOR', 'PAPEL HIGIENICO'], {
    chave: 'x',
    buscar: resposta([{ indice: 1, prefixo: '700', confianca: 'alta', motivo: 'consumo' }, { indice: 0, prefixo: '800', confianca: 'alta', motivo: 'móvel' }]),
  });
  assert.deepEqual(r.map((x) => [x.descricao, x.prefixo]), [['GAVETEIRO ORGANIZADOR', '800'], ['PAPEL HIGIENICO', '700']]);
});

test('sem chave não chama a IA', async () => {
  await assert.rejects(() => perguntarFamiliaIA('a', 'b', ['c'], { chave: '' }), /OPENAI_API_KEY/);
});

test('divergência: família diferente com confiança; 300 e 400 contam como a mesma área; baixa confiança não alerta', () => {
  const p = (prefixo, confianca = 'alta') => ({ descricao: 'X', prefixo, confianca, motivo: '' });
  assert.equal(acharDivergencias('700', [p('800')]).length, 1);
  assert.equal(acharDivergencias('700', [p('700')]).length, 0);
  assert.equal(acharDivergencias('400', [p('300')]).length, 0);
  assert.equal(acharDivergencias('700', [p('800', 'baixa')]).length, 0);
  assert.equal(acharDivergencias('200', [p('1010', 'media')]).length, 1);
});
