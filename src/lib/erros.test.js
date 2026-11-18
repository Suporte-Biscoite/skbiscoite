import test from 'node:test';
import assert from 'node:assert/strict';
import { explicarErro } from './erros.js';

test('erros técnicos viram frases simples e guardam o original', () => {
  const a = explicarErro('Task status invalid');
  assert.match(a.oQue, /status final/); assert.equal(a.detalhe, 'Task status invalid');
  assert.match(explicarErro('OpenAI respondeu 401: Incorrect API key').oQue, /chave/);
  assert.match(explicarErro('fetch failed').oQue, /conex/);
  assert.match(explicarErro('Omie: coisa estranha').oQue, /Omie/);
  assert.match(explicarErro('???').oQue, /não saiu como esperado/);
  assert.equal(explicarErro(''), null);
});
