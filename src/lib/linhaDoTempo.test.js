import test from 'node:test';
import assert from 'node:assert/strict';
import { montarLinhaDoTempo, quemFez, resumoDoPedido } from './linhaDoTempo.js';

test('quem fez: pessoa, robô ou sistema', () => {
  assert.equal(quemFez('automatico@skbiscoite').tipo, 'robo');
  assert.equal(quemFez('sistema').tipo, 'sistema');
  assert.deepEqual(quemFez('ana@x.com'), { tipo: 'pessoa', nome: 'ana@x.com' });
});

test('linha do tempo: texto simples, mais novo primeiro', () => {
  const l = montarLinhaDoTempo([{ acao: 'recebida', usuario: 'clickup', em: '2026-11-18T10:00:00Z' }, { acao: 'auto-aprovou', usuario: 'automatico', em: '2026-11-18T10:05:00Z' }]);
  assert.equal(l[0].texto.startsWith('Aprovado automaticamente'), true); assert.equal(l[0].nome, 'Robô'); assert.equal(l[1].texto, 'Pedido recebido do ClickUp');
});

test('resumo do pedido conta novos, já cadastrados, NCM faltando e avisos', () => {
  const r = resumoDoPedido({ motivos: ['x'], itens: [{ descricao: 'A', ncm: '' }, { descricao: 'B', ncm: '84198190', avisos: ['a'] }, { descricao: 'C', usar_codigo: '800001' }, { descricao: '', ncm: '' }] });
  assert.match(r.encontrou, /3 produto\(s\) lido\(s\), 2 novo\(s\), 1 já cadastrado/);
  assert.deepEqual(r.precisa, ['Preencher o NCM de 1 item(ns).', 'Ler 2 aviso(s).']);
  assert.match(r.aprovar, /Cria 2 código\(s\).*reaproveita 1/);
});
