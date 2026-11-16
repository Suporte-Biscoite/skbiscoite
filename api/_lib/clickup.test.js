import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assinaturaValida, chaveDoEvento, eventoDoRobo } from './clickup.js';

const segredo = 'segredo-de-teste';
const corpo = Buffer.from(JSON.stringify({ event: 'taskCreated', task_id: 'abc', history_items: [{ id: '1', user: { id: 7 } }] }));
const assinar = (c, s = segredo) => crypto.createHmac('sha256', s).update(c).digest('hex');

test('webhook: assinatura certa passa; errada, ausente ou de outro corpo é recusada', () => {
  assert.equal(assinaturaValida(corpo, assinar(corpo), segredo), true);
  assert.equal(assinaturaValida(corpo, assinar(corpo, 'outro'), segredo), false);
  assert.equal(assinaturaValida(corpo, undefined, segredo), false);
  assert.equal(assinaturaValida(Buffer.from('{"a":1}'), assinar(corpo), segredo), false);
  assert.equal(assinaturaValida(corpo, assinar(corpo), ''), false); // sem segredo configurado nunca aceita
  assert.equal(assinaturaValida(corpo, 'curta', segredo), false);
});

test('o mesmo evento gera sempre a mesma chave; eventos diferentes, chaves diferentes', () => {
  const a = { event: 'taskCreated', task_id: 'abc', history_items: [{ id: '1' }] };
  assert.equal(chaveDoEvento(a), chaveDoEvento({ ...a }));
  assert.notEqual(chaveDoEvento(a), chaveDoEvento({ ...a, history_items: [{ id: '2' }] }));
  assert.notEqual(chaveDoEvento(a), chaveDoEvento({ ...a, task_id: 'xyz' }));
  assert.equal(chaveDoEvento({ event: 'taskUpdated', task_id: 'a' }), chaveDoEvento({ event: 'taskUpdated', task_id: 'a' }));
});

test('eventos feitos pelo usuário do robô são ignorados (sem loop)', () => {
  const antes = process.env.CLICKUP_BOT_USER_ID;
  process.env.CLICKUP_BOT_USER_ID = '7';
  assert.equal(eventoDoRobo({ history_items: [{ user: { id: 7 } }] }), true);
  assert.equal(eventoDoRobo({ history_items: [{ user: { id: 8 } }] }), false);
  delete process.env.CLICKUP_BOT_USER_ID;
  assert.equal(eventoDoRobo({ history_items: [{ user: { id: 7 } }] }), false);
  if (antes) process.env.CLICKUP_BOT_USER_ID = antes;
});
