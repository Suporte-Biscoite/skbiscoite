// Padrão de nome do catálogo, descoberto a partir dos nomes JÁ cadastrados no Omie (família por família).
// Serve para (1) mostrar as regras encontradas e (2) dar exemplos reais à IA, que deve imitar o estilo.
import { FAMILIAS, normalizarTexto } from './familias.js';
import { padronizarNome } from './regras.js';

const prefixoDe = (codigo) => (/^\d{7}$/.test(String(codigo)) ? FAMILIAS.map((f) => f.prefixo).sort((a, b) => b.length - a.length).find((p) => String(codigo).startsWith(p)) ?? null : null);
const MEDIDA = /\b\d+(?:[.,]\d+)?\s?(?:ML|L|LT|LTS|KG|G|GR|MG|MM|CM|M|UN|CX|PCT|V|W|KW|HP)\b/i;

// produtos: [{ codigo, descricao }] ativos. Devolve { porFamilia: { [prefixo]: { total, regras: [...], exemplos: [...] } }, geral: [...] }.
export function descobrirPadraoDeNomes(produtos, { exemplosPorFamilia = 12 } = {}) {
  const grupos = {};
  for (const p of produtos) {
    const pref = prefixoDe(p.codigo);
    if (!pref || !p.descricao) continue;
    (grupos[pref] ??= []).push(p.descricao.trim());
  }
  const porFamilia = {};
  for (const [pref, nomes] of Object.entries(grupos)) {
    const n = nomes.length;
    const pct = (fn) => Math.round((100 * nomes.filter(fn).length) / n);
    const tamanhoMedio = Math.round(nomes.reduce((a, x) => a + x.length, 0) / n);
    const regras = [];
    regras.push(`Tamanho médio de ${tamanhoMedio} caracteres (máximo 120).`);
    if (pct((x) => x === x.toUpperCase()) >= 75) regras.push(`Caixa alta (${pct((x) => x === x.toUpperCase())}% dos nomes).`);
    if (pct((x) => / - /.test(x)) >= 15) regras.push(`Separa partes com " - ", por exemplo "NOME - 150G" (${pct((x) => / - /.test(x))}%).`);
    if (pct((x) => MEDIDA.test(x)) >= 12) regras.push(`Medida ao final, junto da unidade abreviada (ML, L, KG, G, MM, CM...) (${pct((x) => MEDIDA.test(x))}% têm medida).`);
    if (pct((x) => /\b[CP]\//.test(x)) >= 4) regras.push('Abrevia "com" como C/ e "para" como P/.');
    if (pct((x) => /\(/.test(x)) >= 4) regras.push('Detalhe ou variação entre parênteses quando necessário.');
    // exemplos espalhados pela lista (não só os primeiros)
    const passo = Math.max(1, Math.floor(n / exemplosPorFamilia));
    const exemplos = nomes.filter((_, i) => i % passo === 0).slice(0, exemplosPorFamilia);
    porFamilia[pref] = { total: n, regras, exemplos };
  }
  const geral = [
    'Todo nome sobe em MAIÚSCULAS e SEM ACENTO (regra da casa, aplicada pelo sistema).',
    'Nome curto e direto: tipo do produto, depois marca/modelo, depois medidas e variação.',
    'Sem códigos de fornecedor, sem textos de nota fiscal ("S40 SUPREMA 3GR BIANCA" não é um nome de catálogo).',
  ];
  return { porFamilia, geral };
}

// Aplica as regras que dá para garantir por código (a IA só sugere o resto).
export const limparNomeSugerido = (nome) => padronizarNome(nome).slice(0, 120);

// Nome da nota x nome sugerido: serve para mostrar "antes e depois" sem falsa diferença (acento/caixa).
export const mesmoNome = (a, b) => normalizarTexto(a) === normalizarTexto(b);
