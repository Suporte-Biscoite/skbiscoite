// api/_lib/omie.js — cliente do Omie (somente servidor). Credenciais só por variável de ambiente.
const BASE = 'https://app.omie.com.br/api/v1/geral';
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ErroOmie extends Error {
  constructor(mensagem, { status = 0, transitorio = false } = {}) {
    super(mensagem);
    this.name = 'ErroOmie';
    this.status = status;
    this.transitorio = transitorio;
  }
}

// O Omie responde 500 também para erro de negócio (com faultstring). Só repetimos o que é
// instabilidade de verdade: sem mensagem, ou "consumo redundante"/bloqueio temporário.
const ehTransitorio = (status, falha) =>
  [425, 429, 502, 503, 504].includes(status) || (status >= 500 && !falha) || /consumo redundante|bloquead|aguarde/i.test(falha);

export async function chamarOmie(rota, call, param, { tentativas = 4, timeoutMs = 20000 } = {}) {
  const app_key = process.env.OMIE_APP_KEY;
  const app_secret = process.env.OMIE_APP_SECRET;
  if (!app_key || !app_secret) throw new ErroOmie('Credenciais do Omie ausentes no servidor.');

  for (let tentativa = 1; ; tentativa++) {
    let resposta, dados;
    try {
      resposta = await fetch(`${BASE}/${rota}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call, app_key, app_secret, param: [param] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      dados = await resposta.json().catch(() => ({}));
    } catch {
      if (tentativa < tentativas) { await esperar(500 * 2 ** (tentativa - 1)); continue; }
      throw new ErroOmie('O Omie não respondeu a tempo.', { transitorio: true });
    }
    if (resposta.ok) return dados;

    const falha = String(dados.faultstring || '');
    const transitorio = ehTransitorio(resposta.status, falha);
    if (transitorio && tentativa < tentativas) { await esperar(1000 * 2 ** (tentativa - 1)); continue; }
    throw new ErroOmie(falha || `O Omie recusou a operação (HTTP ${resposta.status}).`, { status: resposta.status, transitorio });
  }
}

// Famílias: o método certo é PesquisarFamilias (ListarFamilias dá erro 500 no Omie).
export async function listarFamiliasOmie() {
  const todas = [];
  for (let pagina = 1, total = 1; pagina <= total; pagina++) {
    const dados = await chamarOmie('familias', 'PesquisarFamilias', { pagina, registros_por_pagina: 100 });
    total = dados.total_de_paginas || 1;
    todas.push(...(dados.famCadastro || []));
  }
  return todas;
}

// Uma página de produtos. `desde` (dd/mm/aaaa) traz só o que foi incluído/alterado desde então.
export const listarProdutosOmie = ({ pagina, desde } = {}) =>
  chamarOmie('produtos', 'ListarProdutos', {
    pagina,
    registros_por_pagina: 500,
    apenas_importado_api: 'N',
    filtrar_apenas_omiepdv: 'N',
    ...(desde ? { filtrar_por_data_de: desde } : {}),
  });

export const incluirProdutoOmie = (produto) => chamarOmie('produtos', 'IncluirProduto', produto);
export const alterarProdutoOmie = (produto) => chamarOmie('produtos', 'AlterarProduto', produto);
export const consultarProdutoOmie = (filtro) => chamarOmie('produtos', 'ConsultarProduto', filtro);
