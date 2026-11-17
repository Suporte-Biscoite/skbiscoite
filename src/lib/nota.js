// Regras puras para ler o NCM numa nota fiscal (DANFE em PDF, já convertida em texto). Sem rede, sem banco.
// 1) acha as linhas de produto da nota (descrição + NCM);  2) liga cada produto pedido a uma linha da nota pelo nome;
// 3) o que não ligar com segurança pode ir para a IA, que só vale se o NCM devolvido existir MESMO no texto da nota.
import { normalizarTexto } from './familias.js';

const tokens = (s) => new Set(normalizarTexto(s).split(/[^A-Z0-9]+/).filter((p) => p.length > 1));

// Trecho dos produtos: entre "DADOS DOS PRODUTOS" e "DADOS ADICIONAIS" (menos dados do fornecedor enviados à IA).
export function trechoDosProdutos(texto) {
  const t = String(texto ?? '');
  const ini = t.search(/DADOS DOS PRODUTOS/i);
  if (ini < 0) return t.slice(0, 12000);
  const fim = t.slice(ini).search(/DADOS ADICIONAIS|INFORMA[ÇC][ÕO]ES COMPLEMENTARES/i);
  return t.slice(ini, fim > 0 ? ini + fim : ini + 12000);
}

// Cada linha de produto termina em "NCM  CST  CFOP  UN  QTD" (ex.: "48181000 000 5102 un 2 167,63").
const TAIL = /(?<!\d)(\d{8})\s+(\d{3,4})\s+([1-7]\d{3})\s+([A-Za-z]{1,4})\s+[\d.,]+/g;

export function lerItensDaNota(texto) {
  const secao = trechoDosProdutos(texto).replace(/\r/g, '');
  const itens = [];
  let anterior = 0;
  for (const m of secao.matchAll(TAIL)) {
    let descricao = secao.slice(anterior, m.index);
    // Fim da linha anterior (quantidade, valores) ou o cabeçalho da tabela não fazem parte do nome.
    descricao = descricao.replace(/^[\s\d.,%]*(?=[A-Za-zÀ-ÿ0-9])/, ' ').replace(/\s+/g, ' ').trim();
    // Na primeira linha vem junto o cabeçalho da tabela: corta até o fim dele.
    if (/DESCRI[ÇC][ÃA]O DO PRODUTO/i.test(descricao)) descricao = descricao.replace(/^.*?AL[ÍI]Q\.?\s*IPI\s+(?!AL[ÍI]Q)/i, '').replace(/^\d{1,3}\s+(?=[A-Za-zÀ-ÿ])/, '');
    itens.push({ ordem: itens.length + 1, descricao, ncm: m[1] });
    anterior = m.index + m[0].length;
  }
  return itens;
}

// Para cada produto pedido: a linha da nota que contém todas as palavras do nome (>= 85%), se for única ou do mesmo NCM.
export function ligarProdutosAosItensDaNota(produtos, itensNota, minimo = 0.85) {
  const preparados = itensNota.map((i) => ({ ...i, t: tokens(i.descricao) }));
  return produtos.map((produto) => {
    const pt = tokens(produto);
    if (pt.size === 0) return { produto, ncm: null, motivo: 'Nome vazio.' };
    const pontuados = preparados.map((i) => {
      let dentro = 0;
      for (const x of pt) if (i.t.has(x)) dentro++;
      return { item: i, nota: dentro / pt.size };
    }).filter((p) => p.nota >= minimo).sort((a, b) => b.nota - a.nota);
    if (pontuados.length === 0) return { produto, ncm: null, motivo: 'Nenhuma linha da nota tem esse nome.' };
    const melhores = pontuados.filter((p) => p.nota === pontuados[0].nota);
    const ncms = new Set(melhores.map((p) => p.item.ncm));
    if (ncms.size > 1) return { produto, ncm: null, motivo: 'Mais de uma linha da nota parece ser este produto, com NCMs diferentes.' };
    const achada = melhores[0].item;
    return { produto, ncm: achada.ncm, linha: achada.ordem, linhaDaNota: achada.descricao, certeza: pontuados[0].nota };
  });
}

// Resposta da IA só vale se o NCM tiver 8 dígitos e aparecer no texto da nota (nunca "inventado").
export function validarRespostaDaIA(resposta, texto) {
  const naNota = new Set(String(texto ?? '').match(/(?<!\d)\d{8}(?!\d)/g) ?? []);
  const ncm = String(resposta?.ncm ?? '').replace(/[^0-9]/g, '');
  if (ncm.length !== 8 || !naNota.has(ncm)) return null;
  return ncm;
}

// NCMs distintos que aparecem nas linhas de produto (para a pessoa escolher quando a ligação não for segura).
export const ncmsDaNota = (itensNota) => [...new Set(itensNota.map((i) => i.ncm))];
