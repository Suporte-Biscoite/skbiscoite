// Mede o tempo das chamadas de LEITURA ao Omie (não escreve nada). Uso: npm run medir
const URL_OMIE = 'https://app.omie.com.br/api/v1/geral';
const auth = { app_key: process.env.OMIE_APP_KEY, app_secret: process.env.OMIE_APP_SECRET };
if (!auth.app_key || !auth.app_secret) throw new Error('Defina OMIE_APP_KEY e OMIE_APP_SECRET no .env.local');

async function chamar(rota, call, param) {
  const t = performance.now();
  const res = await fetch(`${URL_OMIE}/${rota}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, ...auth, param: [param] }),
  });
  const dados = await res.json().catch(() => ({}));
  return { ms: Math.round(performance.now() - t), status: res.status, dados };
}

const fam = await chamar('familias', 'ListarFamilias', { pagina: 1, registros_por_pagina: 100 });
console.log(`ListarFamilias: ${fam.ms} ms (HTTP ${fam.status})`);
const lista = fam.dados.famCadastro || [];
console.log('famílias:', lista.map((f) => `${f.codigo}=${f.nomeFamilia}`).join(' | '));
console.log('campos de uma família:', Object.keys(lista[0] || {}).join(', '));

let pagina = 1, total = 1, soma = 0, qtd = 0;
do {
  const r = await chamar('produtos', 'ListarProdutos', { pagina, registros_por_pagina: 500, apenas_importado_api: 'N', filtrar_apenas_omiepdv: 'N' });
  if (r.status !== 200) { console.log(`ListarProdutos pág ${pagina}: HTTP ${r.status} ${r.dados.faultstring || ''}`); break; }
  total = r.dados.total_de_paginas || 1;
  qtd += (r.dados.produto_servico_cadastro || []).length; soma += r.ms;
  console.log(`ListarProdutos pág ${pagina}/${total}: ${r.ms} ms`);
  pagina++;
} while (pagina <= total);
console.log(`TOTAL: ${qtd} produtos lidos em ${(soma / 1000).toFixed(1)} s — é isso que HOJE é refeito a cada cadastro.`);
