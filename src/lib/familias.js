// Fonte única da verdade: prefixo do SKU <-> grupo <-> família cadastrada no Omie.
// O texto de `familia` precisa ser IGUAL ao nome da família no Omie
// (Cadastros > Produtos e Serviços > Famílias de Produtos).
export const FAMILIAS = [
  { prefixo: '1010', grupo: 'ENVASE',      familia: 'INSUMOS PARA ENVASE' },
  { prefixo: '200',  grupo: 'EMBALAGEM',   familia: 'EMBALAGEM' },
  { prefixo: '300',  grupo: 'EXTERNO',     familia: 'PRODUTOS PARA REVENDA' },
  { prefixo: '400',  grupo: 'INTERNO',     familia: 'PRODUTOS PRONTOS' },
  { prefixo: '500',  grupo: 'KITS',        familia: 'CESTAS/KIT' },
  { prefixo: '700',  grupo: 'SUPRIMENTOS', familia: 'SUPRIMENTOS' },
  { prefixo: '800',  grupo: 'ATIVOS',      familia: 'ATIVO' },
];

// Maiúsculas, sem acento, sem espaço sobrando ("CESTAS / KIT" == "CESTAS/KIT").
export const normalizarTexto = (valor) =>
  String(valor ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();

export const obterFamiliaPorPrefixo = (prefixo) =>
  FAMILIAS.find((f) => f.prefixo === String(prefixo ?? '').trim()) || null;

// Planilhas antigas usavam texto solto na coluna CATEGORIA; continuam funcionando.
const PALAVRAS_LEGADAS = [
  [/ENVASE|INSUMO/, '1010'],
  [/EMBALAGEM/, '200'],
  [/REVENDA/, '300'],
  [/PRONTO/, '400'],
  [/CESTA|KIT/, '500'],
  [/SUPRIMENTO/, '700'],
  [/\bATIVOS?\b/, '800'],
];

// Aceita: nome da família ("PRODUTOS PRONTOS"), grupo ("INTERNO"),
// prefixo ("400" ou "400 - INTERNO") e os textos soltos antigos.
// Retorna { prefixo, grupo, familia } ou null se não reconhecer.
export function resolverFamilia(valor) {
  const txt = normalizarTexto(valor);
  if (!txt) return null;

  const exata = FAMILIAS.find((f) => normalizarTexto(f.familia) === txt || f.grupo === txt);
  if (exata) return exata;

  const comPrefixo = txt.match(/^(\d+)(?:\D|$)/);
  if (comPrefixo) return obterFamiliaPorPrefixo(comPrefixo[1]);

  for (const [regex, prefixo] of PALAVRAS_LEGADAS) {
    if (regex.test(txt)) return obterFamiliaPorPrefixo(prefixo);
  }
  return null;
}
