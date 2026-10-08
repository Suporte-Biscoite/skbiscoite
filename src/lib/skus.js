import { normalizarTexto } from './familias.js';

// Código final = prefixo + sequência, sempre com 7 dígitos no total.
// Ex.: 400 + 0001 = 4000001 | 1010 + 001 = 1010001
export const TOTAL_DIGITOS_CODIGO = 7;

// Produtos "reservados" no Omie: o código pode ser reaproveitado (AlterarProduto).
const DESCRICOES_STANDBY = new Set(
  ['PRODUTO INDEFINIDO', 'PRODUTO INDENIDO', 'CÓDIGO EM STAND-BY'].map(normalizarTexto)
);

// Procura o primeiro "buraco" na sequência do prefixo (ou reaproveita stand-by).
// `produtos`: [{ codigo, descricao, codigo_produto }] (strings soltas também servem).
// `ocupados`: códigos que não podem ser usados nesta rodada (ex.: o Omie recusou por duplicidade).
export function encontrarProximaVaga(produtos, prefixo, { ocupados = new Set() } = {}) {
  const prefixoStr = String(prefixo ?? '').trim();
  const digitosSequencia = TOTAL_DIGITOS_CODIGO - prefixoStr.length;
  if (!/^\d+$/.test(prefixoStr) || digitosSequencia < 1) {
    throw new Error(`Prefixo inválido: "${prefixo}".`);
  }

  const padrao = new RegExp(`^${prefixoStr}\\d{${digitosSequencia}}$`);
  const porCodigo = new Map();
  for (const item of produtos) {
    const produto = typeof item === 'string' ? { codigo: item, descricao: '' } : item;
    const codigo = String(produto.codigo ?? '').trim();
    if (padrao.test(codigo)) porCodigo.set(codigo, produto);
  }

  const limite = 10 ** digitosSequencia - 1;
  for (let sequencia = 1; sequencia <= limite; sequencia++) {
    const codigo = prefixoStr + String(sequencia).padStart(digitosSequencia, '0');
    if (ocupados.has(codigo)) continue;

    const existente = porCodigo.get(codigo);
    if (!existente) return { codigo, acao: 'IncluirProduto' };
    if (DESCRICOES_STANDBY.has(normalizarTexto(existente.descricao))) {
      return { codigo, acao: 'AlterarProduto', codigo_produto: existente.codigo_produto };
    }
  }
  throw new Error(`Não há mais códigos livres para o prefixo ${prefixoStr}.`);
}

// Atualiza a lista local depois de um cadastro, para a próxima linha já enxergar o código como usado.
export function registrarProdutoLocal(produtos, vaga, descricao, codigoProduto) {
  if (vaga.acao === 'AlterarProduto') {
    const existente = produtos.find((p) => p.codigo === vaga.codigo);
    if (existente) {
      existente.descricao = descricao;
      return;
    }
  }
  produtos.push({ codigo: vaga.codigo, descricao, codigo_produto: codigoProduto });
}

// O Omie recusou porque o código (ou código de integração) já existe?
export function ehErroDeCodigoDuplicado(mensagem = '') {
  const t = normalizarTexto(mensagem);
  return /CODIGO/.test(t) && /(JA EXISTE|JA CADASTRAD|JA ESTA|DUPLICAD|EM USO)/.test(t);
}

// Escolhe o próximo código livre da família e cadastra usando `cadastrar` (a chamada ao Omie).
// Se o Omie recusar porque o código já existe, marca como ocupado e tenta o seguinte, em vez de
// repetir o mesmo código nas linhas seguintes. `produtos` é atualizado a cada cadastro.
export async function cadastrarComVaga(cadastrar, { produtos, ocupados, familia, descricao, ncm }) {
  const maxTentativas = 5;
  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    const vaga = encontrarProximaVaga(produtos, familia.prefixo, { ocupados });
    try {
      const resp = await cadastrar({
        codigo: vaga.codigo,
        descricao,
        ncm,
        acao: vaga.acao,
        familia: familia.familia,
        codigo_produto: vaga.codigo_produto,
      });
      registrarProdutoLocal(produtos, vaga, descricao, resp.omie_id);
      return { ...vaga, resp };
    } catch (err) {
      err.codigo = vaga.codigo;
      if (!ehErroDeCodigoDuplicado(err.message) || tentativa === maxTentativas) throw err;
      ocupados.add(vaga.codigo);
    }
  }
}

const ALIAS_COLUNAS = {
  familia: ['FAMILIA', 'CATEGORIA', 'FAMILIA DO PRODUTO'],
  descricao: ['DESCRICAO', 'DESCRICAO DO PRODUTO'],
  ncm: ['NCM'],
};

// Excel tira o zero à esquerda de NCM numérico (04061010 vira 4061010).
const normalizarNcm = (valor) => {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  return digitos.length === 7 ? digitos.padStart(8, '0') : digitos;
};

// Recebe a aba como matriz (sheet_to_json com header:1), acha a linha de cabeçalho
// em qualquer posição e devolve as linhas preenchidas com o número real da linha no Excel.
export function lerLinhasDaPlanilha(matriz, primeiraLinha = 1) {
  const achar = (cabecalho, nomes) => cabecalho.findIndex((c) => nomes.includes(c));

  for (let i = 0; i < Math.min(matriz.length, 30); i++) {
    const cabecalho = (matriz[i] || []).map(normalizarTexto);
    const colFamilia = achar(cabecalho, ALIAS_COLUNAS.familia);
    const colDescricao = achar(cabecalho, ALIAS_COLUNAS.descricao);
    if (colFamilia === -1 || colDescricao === -1) continue;
    const colNcm = achar(cabecalho, ALIAS_COLUNAS.ncm);

    return matriz
      .slice(i + 1)
      .map((colunas, j) => ({
        linha: primeiraLinha + i + 1 + j,
        familia: String(colunas[colFamilia] ?? '').trim(),
        descricao: String(colunas[colDescricao] ?? '').trim(),
        ncm: colNcm >= 0 ? normalizarNcm(colunas[colNcm]) : '',
      }))
      .filter((l) => l.familia || l.descricao || l.ncm);
  }
  throw new Error('Não encontrei o cabeçalho (FAMILIA, DESCRICAO, NCM) na planilha. Baixe o modelo atualizado.');
}
