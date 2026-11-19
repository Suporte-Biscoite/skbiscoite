import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarRenomeacao, corpoDeRenomeacao, lerLinhasDeRenomeacao } from './renomear.js';

test('lê linhas com ; tab hífen ou espaço, aplica a regra da casa e acusa erros', () => {
  const l = lerLinhasDeRenomeacao('8000109; Poltrona Ângel Jaspe\n4000001\tBISCOITO CASTANHA 150G\n\n7000500 - Neutre cx/3\n4000001; repetido\nSOCORRO\n8000110;');
  assert.equal(l[0].nome, 'POLTRONA ANGEL JASPE');
  assert.equal(l[1].codigo, '4000001'); assert.equal(l[1].nome, 'BISCOITO CASTANHA 150G');
  assert.equal(l[2].nome, 'NEUTRE CX/3');
  assert.match(l[3].erro, /repetido/); assert.match(l[4].erro, /formato/); assert.match(l[5].erro, /nome/i);
  assert.throws(() => lerLinhasDeRenomeacao(Array.from({ length: 51 }, (_, i) => `${1000 + i}; X`).join('\n')), /No máximo 50/);
  assert.match(lerLinhasDeRenomeacao('8000109; ' + 'A'.repeat(130))[0].erro, /120/);
});

test('avaliação: não achou, sem mudança, avisos e proposta', () => {
  const omie = { codigo_produto: 1, descricao: 'NOME VELHO', inativo: 'N' };
  assert.equal(avaliarRenomeacao({ codigo: '1', nome: 'X', omie: null }).estado, 'invalida');
  assert.equal(avaliarRenomeacao({ codigo: '1', nome: 'NOME VELHO', omie }).estado, 'sem_mudanca');
  const ok = avaliarRenomeacao({ codigo: '1', nome: 'NOME NOVO', omie, nexaas: { existe: true, productId: 9, nomeProduto: 'NOME VELHO' } });
  assert.deepEqual([ok.estado, ok.avisos.length], ['proposta', 0]);
  const av = avaliarRenomeacao({ codigo: '1', nome: 'NOME NOVO', omie: { ...omie, inativo: 'S' }, nexaas: { existe: false }, outroComNome: '2' });
  assert.equal(av.avisos.length, 3);
  assert.match(avaliarRenomeacao({ codigo: '1', nome: 'NOVO', omie, nexaas: { existe: true, nomeProduto: 'OUTRO' } }).avisos[0], /já era diferente/);
});

test('corpo do AlterarProduto mantém os campos do cadastro e troca só a descrição', () => {
  assert.deepEqual(corpoDeRenomeacao({ codigo_produto: 5, codigo: 'A', unidade: 'UN', ncm: '1', descricao: 'VELHO', inativo: 'N', x: 1 }, 'NOVO'), { codigo_produto: 5, codigo: 'A', unidade: 'UN', ncm: '1', descricao: 'NOVO' });
});
