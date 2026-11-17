import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidar, organizarSugestao, pesquisarNaWeb } from './nome-ia.js';

test('a pesquisa na web envia só o nome, usa a ferramenta web_search e devolve as fontes citadas', async () => {
  let enviado;
  const buscar = async (url, init) => {
    enviado = { url, corpo: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'La Spaziale S40 Suprema, 3 grupos.', annotations: [{ type: 'url_citation', url: 'https://exemplo.com/s40', title: 'S40 Suprema' }, { type: 'url_citation', url: 'https://exemplo.com/s40', title: 'repetida' }] }] }] }) };
  };
  const r = await pesquisarNaWeb('S40 SUPREMA 3GR BIANCA', { chave: 'x', buscar });
  assert.equal(enviado.url, 'https://api.openai.com/v1/responses');
  assert.equal(enviado.corpo.tools[0].type, 'web_search'); assert.equal(enviado.corpo.tool_choice, 'required');
  assert.ok(enviado.corpo.input.includes('S40 SUPREMA 3GR BIANCA'));
  assert.deepEqual(r.fontes, [{ url: 'https://exemplo.com/s40', titulo: 'S40 Suprema' }]);
  await assert.rejects(() => pesquisarNaWeb('x', { chave: '' }), /OPENAI_API_KEY/);
});

test('organizar usa o estilo do catálogo e não manda dados internos', async () => {
  let corpo;
  const buscar = async (_u, init) => { corpo = JSON.parse(init.body); return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ identificado: true, nome_sugerido: 'x', marca: '', modelo: '', familia_sugerida: '800', confianca: 'alta', resumo: '', ncm_provavel: '' }) } }] }) }; };
  const estilo = { geral: ['Caixa alta.'], porFamilia: { 800: { regras: ['Tamanho médio de 30.'], exemplos: ['LIXEIRA PLAST C/PEDAL 20L'] } } };
  await organizarSugestao({ nomeOriginal: 'S40', pesquisa: { texto: 'texto', fontes: [] }, estilo, prefixoPedido: '800' }, { chave: 'x', buscar });
  assert.ok(corpo.messages[0].content.includes('LIXEIRA PLAST C/PEDAL 20L'));
  assert.deepEqual(Object.keys(JSON.parse(corpo.messages[1].content)).sort(), ['nome_na_nota', 'resultado_da_pesquisa']);
});

test('sem fonte ou sem confiança: não identificado; com fonte e confiança: sugerido, NCM só sugestão', () => {
  const pesq = { texto: 'La Spaziale S40 Suprema', fontes: [{ url: 'https://a.com', titulo: 'a' }] };
  const ok = consolidar('S40 SUPREMA 3GR BIANCA', pesq, { identificado: true, nome_sugerido: 'Máquina de Café La Spaziale S40 Suprema 3 Grupos Branca', marca: 'La Spaziale', modelo: 'S40 Suprema', familia_sugerida: '800', confianca: 'alta', resumo: 'x', ncm_provavel: '8419.81.90' });
  assert.equal(ok.estado, 'sugerido'); assert.equal(ok.nome_sugerido, 'MAQUINA DE CAFE LA SPAZIALE S40 SUPREMA 3 GRUPOS BRANCA'); assert.equal(ok.ncm_sugerido, '84198190'); assert.ok(ok.aviso.includes('IA'));
  assert.equal(consolidar('X', { texto: 'x', fontes: [] }, { identificado: true, nome_sugerido: 'N', confianca: 'alta' }).estado, 'nao_identificado');
  assert.equal(consolidar('X', pesq, { identificado: true, nome_sugerido: 'N', confianca: 'baixa' }).estado, 'nao_identificado');
  assert.equal(consolidar('X', pesq, { identificado: false, nome_sugerido: '', confianca: 'alta' }).estado, 'nao_identificado');
  assert.equal(consolidar('X', { texto: 'NAO_IDENTIFICADO', fontes: pesq.fontes }, { identificado: true, nome_sugerido: 'N', confianca: 'alta' }).estado, 'nao_identificado');
});
