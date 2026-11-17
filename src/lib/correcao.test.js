import test from 'node:test';
import assert from 'node:assert/strict';
import { avaliarSeguranca, camposDaCorrecao, camposParaDesfazer, nomeDoCadastroErrado } from './correcao.js';
import { descobrirPadraoDeNomes, limparNomeSugerido } from './padraoNomes.js';

test('nome do cadastro errado: prefixo, sufixo, limite de 120 e sem acumular', () => {
  assert.equal(nomeDoCadastroErrado('MOINHO ASTRO 12 INSTANTANEO'), 'CADASTRO ERRADO - MOINHO ASTRO 12 INSTANTANEO (INATIVO)');
  const longo = nomeDoCadastroErrado('X'.repeat(200));
  assert.ok(longo.length <= 120 && longo.startsWith('CADASTRO ERRADO - ') && longo.endsWith(' (INATIVO)'));
  assert.equal(nomeDoCadastroErrado(nomeDoCadastroErrado('A B')), 'CADASTRO ERRADO - A B (INATIVO)');
});

test('segurança: saldo, reserva, pendência e movimentação bloqueiam; o que não dá para verificar exige confirmação', () => {
  const limpo = avaliarSeguranca({ estoque: { saldo: 0, reservado: 0, pendentes: 0 }, movimentos: 0, pedidos: 0 });
  assert.deepEqual([limpo.podeAplicar, limpo.naoVerificado.length], [true, 0]);
  const b = avaliarSeguranca({ estoque: { saldo: 3, reservado: 1, pendentes: 2 }, movimentos: 4, pedidos: 1 });
  assert.equal(b.podeAplicar, false); assert.equal(b.bloqueios.length, 5);
  const nv = avaliarSeguranca({ estoque: { saldo: 0, reservado: 0, pendentes: 0 } });
  assert.equal(nv.podeAplicar, true); assert.deepEqual(nv.naoVerificado, ['movimentações', 'pedidos e notas']);
  assert.deepEqual(avaliarSeguranca({}).naoVerificado, ['estoque', 'movimentações', 'pedidos e notas']);
});

test('a correção só envia descrição e inativo; desfazer devolve o que estava antes', () => {
  const antes = { descricao: 'MOINHO X', inativo: 'N', ncm: '84198190' };
  assert.deepEqual(camposDaCorrecao(antes), { descricao: 'CADASTRO ERRADO - MOINHO X (INATIVO)', inativo: 'S' });
  assert.deepEqual(camposParaDesfazer(antes), { descricao: 'MOINHO X', inativo: 'N' });
});

test('padrão de nomes descoberto do catálogo (por família) e nome sugerido limpo', () => {
  const nomes = Array.from({ length: 20 }, (_, i) => ({ codigo: `400100${i}`.slice(0, 7).padEnd(7, '0'), descricao: `BISCOITO ${i} - ${100 + i}G` }));
  const p = descobrirPadraoDeNomes([...nomes, { codigo: '10360', descricao: 'fora' }], { exemplosPorFamilia: 5 });
  assert.equal(Object.keys(p.porFamilia).join(), '400');
  assert.ok(p.porFamilia['400'].regras.some((r) => r.includes('" - "')) && p.porFamilia['400'].exemplos.length <= 5);
  assert.equal(limparNomeSugerido('Máquina de Café La Spaziale S40 Suprema'), 'MAQUINA DE CAFE LA SPAZIALE S40 SUPREMA');
});
