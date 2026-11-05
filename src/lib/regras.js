// Regras de negócio puras (sem rede, sem banco): valem igual no navegador (pré-visualização)
// e no servidor (validação de verdade). Qualquer mudança de regra do Omie/Nexaas é aqui.
import { normalizarTexto, resolverFamilia } from './familias.js';
import { normalizarNcm } from './skus.js';

export const LIMITE_DESCRICAO = 120; // tamanho máximo da descrição no Omie
export const ORIGEM = 0; // origem da mercadoria: sempre 0 - Nacional
export const UNIDADE = 'UN';

// Tipo do item no Omie (campo tipoItem) conforme o grupo do código. Sem isso o Omie grava "99 - Outros".
// Fonte: o que a maioria dos produtos já cadastrados de cada grupo usa.
export const TIPO_ITEM_POR_PREFIXO = {
  '1010': '01', // Matéria-prima / insumos
  '200': '02', // Embalagem
  '300': '00', // Mercadoria para revenda
  '400': '04', // Produto acabado
  '500': 'KT', // Kits
  '700': '07', // Material de uso e consumo
  '800': '08', // Ativo imobilizado
};

// REGRA CHAVE: visibilidade e canais de venda andam SEMPRE juntos. Por isso são UMA opção só:
// quem escolhe "entra na loja" recebe o par completo, nunca um dos dois isolado.
export const CENARIOS_LOJA = Object.freeze({
  sim: Object.freeze({ visibility: 'both', todosOsCanais: true, categoriaDaFamilia: true }),
  nao: Object.freeze({ visibility: 'offline', todosOsCanais: false, categoriaDaFamilia: false }),
});
export const cenarioLoja = (entraNaLoja) => (entraNaLoja ? CENARIOS_LOJA.sim : CENARIOS_LOJA.nao);

export const CATEGORIA_NEXAAS_FORA_DA_LOJA = 'ATIVO';
export const CANAL_NEXAAS_ESTOQUE = 'ESTOQUE';

// "SIM"/"NÃO" da planilha ou do formulário -> true/false/null (null = não informado ou inválido).
export function lerSimNao(valor) {
  if (valor === true || valor === false) return valor;
  const t = normalizarTexto(valor);
  if (['SIM', 'S', '1', 'TRUE', 'ENTRA'].includes(t)) return true;
  if (['NAO', 'N', '0', 'FALSE'].includes(t)) return false;
  return null;
}

export const ncmParaOmie = (ncm8) => `${ncm8.slice(0, 4)}.${ncm8.slice(4, 6)}.${ncm8.slice(6, 8)}`;

// Família efetiva do produto: a sazonal (NATAL, PÁSCOA...) quando marcada, senão a da família-base.
// O prefixo do código vem SEMPRE da família-base (ex.: NATAL continua 400xxxx).
export const nomeFamiliaOmie = (item) => (item.sazonal ? item.familiaSazonal : item.familia.familia);

// Categoria principal no Nexaas: fora da loja é sempre ATIVO; na loja segue a família.
export function nomeCategoriaNexaas(item) {
  if (!cenarioLoja(item.entraNaLoja).categoriaDaFamilia) return CATEGORIA_NEXAAS_FORA_DA_LOJA;
  return item.sazonal ? item.familiaSazonal : item.familia.categoriaNexaas;
}

// Confere UM item antes de qualquer envio. Devolve { erros: [...], item } com o item já normalizado.
// (A existência da família sazonal no Omie/Nexaas é conferida no servidor, que conhece as listas.)
export function validarItem(bruto) {
  const erros = [];
  const descricao = String(bruto.descricao ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!descricao) erros.push('Informe a descrição.');
  else if (descricao.length > LIMITE_DESCRICAO) erros.push(`Descrição com mais de ${LIMITE_DESCRICAO} caracteres.`);

  const familia = resolverFamilia(bruto.familia ?? bruto.prefixo);
  if (!familia) erros.push(`Família não reconhecida${bruto.familia ? ` (${bruto.familia})` : ''}. Escolha uma da lista.`);

  const sazonal = lerSimNao(bruto.sazonal) === true;
  const familiaSazonal = String(bruto.familiaSazonal ?? '').trim().toUpperCase();
  if (sazonal && !familiaSazonal) erros.push('Produto sazonal: escolha a família sazonal (ex.: NATAL, PÁSCOA).');

  const ncm = normalizarNcm(bruto.ncm);
  if (!ncm) erros.push('NCM é obrigatório.');
  else if (ncm.length !== 8) erros.push(`NCM inválido (${bruto.ncm}): precisa ter 8 dígitos.`);

  const entraNaLoja = lerSimNao(bruto.entraNaLoja);
  if (entraNaLoja === null) erros.push('Informe se o produto entra na loja (Sim/Não).');

  return { erros, item: { descricao, familia, sazonal, familiaSazonal: sazonal ? familiaSazonal : '', ncm, entraNaLoja } };
}

// Produto do Omie. `codigoFamilia` é o ID numérico vindo de PesquisarFamilias.
// Para reaproveitar um código em stand-by (AlterarProduto) o Omie identifica o produto pelo ID interno.
export function montarProdutoOmie(item, codigoFamilia, { codigo, codigoProdutoOmie } = {}) {
  if (!codigoFamilia) throw new Error('Família não encontrada no Omie.');
  const produto = {
    codigo,
    descricao: item.descricao,
    unidade: UNIDADE,
    ncm: ncmParaOmie(item.ncm),
    valor_unitario: 0,
    codigo_familia: codigoFamilia,
    tipoItem: TIPO_ITEM_POR_PREFIXO[item.familia.prefixo] ?? '99',
    recomendacoes_fiscais: { origem_mercadoria: String(ORIGEM) },
  };
  if (codigoProdutoOmie) produto.codigo_produto = codigoProdutoOmie;
  else produto.codigo_produto_integracao = codigo;
  return produto;
}

// Produto do Nexaas (seção 5 do pedido). `cfg`: { organizationId, categoriaId, canalEstoqueId }.
// Campos deixados de fora ficam vazios no Nexaas (departamento, marca, descrições, CEST, EAN...).
export function montarProdutoNexaas(item, codigo, cfg) {
  const cenario = cenarioLoja(item.entraNaLoja);
  if (!cfg.categoriaId) throw new Error('Categoria do Nexaas não encontrada para este produto.');
  if (!cenario.todosOsCanais && !cfg.canalEstoqueId) throw new Error('Canal de venda ESTOQUE não encontrado no Nexaas.');
  if (!item.ncm || item.ncm.length !== 8) throw new Error('NCM obrigatório para o Nexaas.');

  return {
    product: {
      // Dados gerais
      status: 'active',
      code: codigo,
      name: item.descricao.toUpperCase(),
      measure: UNIDADE,
      kind: 'default',
      organization_id: cfg.organizationId,
      visible_to_all_organizations: true,
      member_edit: true,
      product_category_id: cfg.categoriaId,
      // Loja: visibilidade e canais SEMPRE juntos, saindo do mesmo cenário
      visibility: cenario.visibility,
      visible_to_all_channels: cenario.todosOsCanais,
      ...(cenario.todosOsCanais ? {} : { sale_channel_ids: [cfg.canalEstoqueId] }),
      // Tributação
      ncm: item.ncm,
      origin: ORIGEM,
      product_purpose: 'resale_third_party_product', // Revenda - produção de terceiros
      // Variação (SKU): código igual ao interno, sem EAN, ativa
      product_skus: [{ code: codigo, active: true }],
    },
  };
}
