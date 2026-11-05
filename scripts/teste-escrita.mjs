// ESCREVE em produção (Omie + Nexaas + Neon): cria 2 produtos claramente marcados como TESTE.
// Só rodar com autorização. Depois, inative os produtos nos dois sistemas. Uso: npm run teste-escrita
import { sql } from '../api/_lib/db.js';
import { garantirEsquema } from '../api/_lib/schema.js';
import { garantirCatalogo } from '../api/_lib/catalogo.js';
import { criarLote, processarLote } from '../api/_lib/cadastros.js';
import { chamarNexaas } from '../api/_lib/nexaas.js';
import { consultarProdutoOmie } from '../api/_lib/omie.js';

await garantirEsquema();
if (!(await garantirCatalogo(sql)).completo) throw new Error('Rode "npm run verificar" antes (carrega o catálogo).');

const marca = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
const itens = [
  { linha: 1, descricao: `TESTE - NÃO USAR (ENTRA NA LOJA) ${marca}`, familia: '400', ncm: '19059020', entraNaLoja: 'Sim' },
  { linha: 2, descricao: `TESTE - NÃO USAR (SÓ ESTOQUE) ${marca}`, familia: '800', ncm: '19059020', entraNaLoja: 'Não' },
];

let t = performance.now();
const lote = await criarLote(sql, { email: 'teste-automatizado@skbiscoite' }, itens);
console.log(`lote criado em ${((performance.now() - t) / 1000).toFixed(1)} s:`, JSON.stringify({ criados: lote.criados, bloqueados: lote.bloqueados }));
if (!lote.lote_id) process.exit(1);

t = performance.now();
let estado;
do { estado = await processarLote(sql, lote.lote_id); } while (!estado.concluido);
console.log(`processado em ${((performance.now() - t) / 1000).toFixed(1)} s`);

for (const i of estado.itens) {
  console.log(`\n#${i.linha} ${i.descricao}\n  código ${i.codigo} (${i.acao}) | Omie: ${i.omie_status} ${i.omie_erro || ''} id=${i.omie_id} | Nexaas: ${i.nexaas_status} ${i.nexaas_erro || ''} id=${i.nexaas_id}`);
  if (i.omie_status === 'ok') {
    const o = await consultarProdutoOmie({ codigo_produto: Number(i.omie_id) }).catch((e) => ({ erro: e.message }));
    console.log('  OMIE:', JSON.stringify({ codigo: o.codigo, familia: o.codigo_familia, descricao_familia: o.descricao_familia, tipoItem: o.tipoItem, ncm: o.ncm, unidade: o.unidade, origem: o.recomendacoes_fiscais?.origem_mercadoria, erro: o.erro }));
  }
  if (i.nexaas_status === 'ok') {
    const d = await chamarNexaas('GET', `/products/${i.nexaas_id}`);
    const p = (d.products?.[0]) ?? d.product ?? d;
    console.log('  NEXAAS:', JSON.stringify({ code: p.code, name: p.name, status: p.status, measure: p.measure, org: p.organization_id, categoria: p.product_category_id, visibility: p.visibility, todos_canais: p.visible_to_all_channels, canais: p.sale_channel_ids, todas_orgs: p.visible_to_all_organizations, member_edit: p.member_edit, ncm: p.ncm, origin: p.origin, finalidade: p.product_purpose, skus: (p.product_skus || []).map((s) => ({ code: s.code, ean: s.ean, active: s.active })) }));
  }
}
