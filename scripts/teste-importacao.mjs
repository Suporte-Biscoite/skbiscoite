// ESCREVE em produção: cria 2 produtos "TESTE - NÃO USAR" SÓ no Omie e importa para o Nexaas pela rotina nova.
// Valida: 400 entra na loja, 800 só estoque, e que repetir a importação não duplica. Inative os produtos depois.
import { sql } from '../api/_lib/db.js';
import { garantirEsquema } from '../api/_lib/schema.js';
import { garantirCatalogo } from '../api/_lib/catalogo.js';
import { resolverFamiliaOmie } from '../api/_lib/catalogo.js';
import { encontrarProximaVaga } from '../src/lib/skus.js';
import { montarProdutoOmie } from '../src/lib/regras.js';
import { obterFamiliaPorPrefixo } from '../src/lib/familias.js';
import { incluirProdutoOmie } from '../api/_lib/omie.js';
import { analisarCodigos, importarCodigos } from '../api/_lib/importacao.js';
import { chamarNexaas } from '../api/_lib/nexaas.js';

await garantirEsquema();
await garantirCatalogo(sql);
const marca = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const codigos = [];
for (const prefixo of ['400', '800']) {
  const fam = obterFamiliaPorPrefixo(prefixo);
  const produtos = await sql`SELECT codigo, descricao, codigo_produto FROM omie_produtos WHERE codigo LIKE ${prefixo + '%'} AND length(codigo) = 7 UNION ALL SELECT codigo, descricao, NULL::bigint FROM cadastros WHERE codigo LIKE ${prefixo + '%'} AND length(codigo) = 7`;
  const vaga = encontrarProximaVaga(produtos.map((p) => ({ ...p, codigo_produto: p.codigo_produto ? Number(p.codigo_produto) : undefined })), prefixo);
  if (vaga.acao !== 'IncluirProduto') { console.log('vaga em stand-by, pulando', vaga.codigo); continue; }
  const familiaOmie = await resolverFamiliaOmie(sql, fam.familia);
  const item = { descricao: `TESTE - NÃO USAR (IMPORTAR ${prefixo}) ${marca}`, ncm: '19059020', familia: fam };
  const r = await incluirProdutoOmie(montarProdutoOmie(item, familiaOmie.codigo, { codigo: vaga.codigo }));
  console.log('Omie criado:', vaga.codigo, r.codigo_produto);
  codigos.push(vaga.codigo);
}
const usuario = { email: 'teste-automatizado@skbiscoite' };
console.log('\nANALISAR:'); console.log((await analisarCodigos(sql, codigos)).map((i) => `${i.codigo} ${i.estado} loja=${i.entraNaLoja} cat=${i.categoriaNexaas}`).join('\n'));
console.log('\nIMPORTAR:'); const res = await importarCodigos(sql, usuario, codigos);
for (const i of res) {
  console.log(`${i.codigo} ${i.estado} nexaasId=${i.nexaasId} ${i.erros || ''}`);
  if (i.nexaasId) { const d = await chamarNexaas('GET', `/products/${i.nexaasId}`); const p = d.products?.[0] ?? d.product ?? d;
    console.log('  ', JSON.stringify({ name: p.name, status: p.status, cat: p.product_category_id, vis: p.visibility, todos_canais: p.visible_to_all_channels, canais: p.sale_channel_ids, ncm: p.ncm, origin: p.origin, skus: (p.product_skus || []).map((s) => s.code) })); }
}
console.log('\nREPETIR (não pode duplicar):'); console.log((await importarCodigos(sql, usuario, codigos)).map((i) => `${i.codigo} ${i.estado}`).join('\n'));
console.log('\nHISTÓRICO:', JSON.stringify(await sql`SELECT codigo, acao, omie_status, nexaas_status, categoria_nexaas FROM cadastros WHERE codigo = ANY(${codigos})`));
process.exit(0);
