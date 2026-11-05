// api/_lib/nexaas.js — cliente do Nexaas OMS (somente servidor). Token só por variável de ambiente.
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class ErroNexaas extends Error {
  constructor(mensagem, { status = 0 } = {}) {
    super(mensagem);
    this.name = 'ErroNexaas';
    this.status = status;
  }
}

const baseUrl = () => `${(process.env.NEXAAS_API_URL || 'https://app.oms.nexaas.com').replace(/\/$/, '')}/api/v1`;

// Cada erro pode vir como texto ou como { 'campo': ['mensagem'] }.
const textoDoErro = (e) => (e && typeof e === 'object' ? Object.entries(e).map(([campo, msg]) => `${campo}: ${[].concat(msg).join(', ')}`).join('; ') : String(e));

// Junta as mensagens de erro do Nexaas (422 traz `errors`) numa frase legível.
function mensagemDeErro(status, dados) {
  if (status === 401) return 'Token do Nexaas inválido ou sem permissão.';
  const erros = dados?.errors ?? dados?.error;
  if (Array.isArray(erros)) return erros.map(textoDoErro).join('; ');
  if (erros && typeof erros === 'object') {
    return Object.entries(erros).map(([campo, msg]) => `${campo}: ${[].concat(msg).join(', ')}`).join('; ');
  }
  return String(erros || `O Nexaas recusou a operação (HTTP ${status}).`);
}

export async function chamarNexaas(metodo, caminho, corpo, { tentativas = 3, timeoutMs = 20000 } = {}) {
  const token = process.env.NEXAAS_API_TOKEN;
  if (!token) throw new ErroNexaas('NEXAAS_API_TOKEN ausente no servidor.');

  for (let tentativa = 1; ; tentativa++) {
    let resposta, dados;
    try {
      resposta = await fetch(`${baseUrl()}${caminho}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      dados = await resposta.json().catch(() => ({}));
    } catch {
      // Só repetimos leitura: repetir um POST que pode ter chegado criaria produto em duplicidade.
      if (metodo === 'GET' && tentativa < tentativas) { await esperar(500 * 2 ** (tentativa - 1)); continue; }
      throw new ErroNexaas('O Nexaas não respondeu a tempo. Confira no Nexaas antes de tentar de novo.');
    }
    if (resposta.ok) return dados;
    // 5xx/429 em leitura são instabilidade; 4xx (inclusive 422) é erro de dados e não adianta repetir.
    if (metodo === 'GET' && (resposta.status >= 500 || resposta.status === 429) && tentativa < tentativas) {
      await esperar(1000 * 2 ** (tentativa - 1));
      continue;
    }
    throw new ErroNexaas(mensagemDeErro(resposta.status, dados), { status: resposta.status });
  }
}

// Todas as categorias (a API pagina de 20 em 20).
export async function listarCategoriasNexaas() {
  const todas = [];
  for (let pagina = 1, total = 1; pagina <= total; pagina++) {
    const dados = await chamarNexaas('GET', `/product_categories?visible_on_pdv=true&page=${pagina}`);
    total = dados.meta?.total_pages || 1;
    todas.push(...(dados.product_categories || []));
  }
  return todas;
}

export const listarCanaisNexaas = async () => (await chamarNexaas('GET', '/sale_channels')).sale_channels || [];

// O SKU já existe no Nexaas? Evita criar produto em duplicidade ao reprocessar.
export async function buscarSkuNexaas(codigo) {
  const dados = await chamarNexaas('GET', `/products/product_skus/?search%5Bcode%5D=${encodeURIComponent(codigo)}`);
  return (dados.product_skus || []).find((s) => String(s.code) === String(codigo)) || null;
}

export const criarProdutoNexaas = (corpo) => chamarNexaas('POST', '/products', corpo);
