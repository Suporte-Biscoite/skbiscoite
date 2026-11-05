// Verificação da Fase 2 contra o banco real. NÃO cria produto no Omie nem no Nexaas:
// cria as tabelas novas, carrega o espelho do catálogo e valida itens. Uso: npm run verificar
import { sql } from '../api/_lib/db.js';
import { garantirEsquema } from '../api/_lib/schema.js';
import { sincronizarCatalogo, garantirCatalogo } from '../api/_lib/catalogo.js';
import { listarFamiliasSazonais, validarLote, configNexaas } from '../api/_lib/cadastros.js';

const medir = async (rotulo, fn) => {
  const t = performance.now();
  const r = await fn();
  console.log(`${rotulo}: ${((performance.now() - t) / 1000).toFixed(1)} s`);
  return r;
};

await medir('esquema', () => garantirEsquema());

let estado = await garantirCatalogo(sql);
while (!estado.completo) {
  estado = await medir(`  sincronizando (pág ${estado.pagina}/${estado.total_paginas || '?'})`, () => sincronizarCatalogo(sql));
}
const [{ n }] = await sql`SELECT count(*)::int AS n FROM omie_produtos`;
console.log(`catálogo completo: ${n} produtos no espelho`);

// A partir daqui deve ser rápido: é o custo real de cada cadastro hoje.
await medir('atualização incremental (antes de cada lote)', () => sincronizarCatalogo(sql));

const nexaas = await medir('config do Nexaas (categorias + canal ESTOQUE)', () => configNexaas(sql));
console.log('  canal ESTOQUE:', nexaas.canalEstoqueId, '| categorias:', Object.keys(nexaas.categorias).length, '| org:', nexaas.organizationId);

const sazonais = await medir('famílias sazonais', () => listarFamiliasSazonais(sql));
console.log(`  ${sazonais.length}:`, sazonais.join(', '));

const itens = [
  { linha: 1, descricao: 'TESTE - NÃO USAR 1', familia: 'PRODUTOS PRONTOS', ncm: '19059020', entraNaLoja: 'Sim' },
  { linha: 2, descricao: 'TESTE - NÃO USAR 2', familia: '300', ncm: '19059020', entraNaLoja: 'Não' },
  { linha: 3, descricao: 'TESTE - NÃO USAR 3', familia: '400', ncm: '19059020', entraNaLoja: 'Sim', sazonal: 'Sim', familiaSazonal: 'NATAL' },
  { linha: 4, descricao: 'TESTE - NÃO USAR 4', familia: '400', ncm: '', entraNaLoja: 'Sim' },
  { linha: 5, descricao: 'TESTE - NÃO USAR 5', familia: '400', ncm: '19059020', entraNaLoja: 'Sim', sazonal: 'Sim', familiaSazonal: 'KIT' },
  { linha: 6, descricao: 'TESTE - NÃO USAR 1', familia: '400', ncm: '19059020', entraNaLoja: 'Sim' },
  { linha: 7, descricao: 'TESTE - NÃO USAR 7', familia: '500', ncm: '19059020', entraNaLoja: 'Sim' },
];
const validacao = await medir('validação de 7 itens', () => validarLote(sql, itens));
for (const r of validacao) console.log(`  linha ${r.linha}: ${r.erros.length ? 'BLOQUEADO -> ' + r.erros.join(' | ') : 'ok'}`);
