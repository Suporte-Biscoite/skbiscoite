// api/_lib/ncm.js — NCM padrão por família e revisão do NCM de produtos criados com o padrão.
// 700 (suprimentos) e 800 (ativos) NÃO têm padrão: o NCM vem da nota do fornecedor e a pessoa informa na aprovação.
import { sql as sqlPadrao } from './db.js';
import { gravarEstado, lerEstado, resolverFamiliaOmie } from './catalogo.js';
import { alterarProdutoOmie, consultarProdutoOmie } from './omie.js';
import { montarProdutoOmie } from '../../src/lib/regras.js';
import { normalizarNcm } from '../../src/lib/skus.js';
import { obterFamiliaPorPrefixo } from '../../src/lib/familias.js';

export const NCM_PADRAO_INICIAL = Object.freeze({
  '1010': '19059020',
  '200': '48192000',
  '300': '19059020',
  '400': '19059020',
  '500': '19059020',
});

export async function lerNcmPadrao(sql = sqlPadrao) {
  const guardado = (await lerEstado(sql, 'ncm_padrao')) || {};
  const { _atualizado_em: _ignorado, ...resto } = guardado;
  return { ...NCM_PADRAO_INICIAL, ...resto };
}

// Aceita "4819.20.00" e "48192000". Vazio remove o padrão daquela família.
export async function gravarNcmPadrao(sql, usuario, mudancas) {
  const atual = await lerNcmPadrao(sql);
  for (const [prefixo, valor] of Object.entries(mudancas || {})) {
    if (!obterFamiliaPorPrefixo(prefixo)) throw new Error(`Família desconhecida: ${prefixo}.`);
    const ncm = normalizarNcm(valor);
    if (!ncm) { delete atual[prefixo]; continue; }
    if (ncm.length !== 8) throw new Error(`NCM inválido para ${prefixo} (${valor}): precisa ter 8 números.`);
    atual[prefixo] = ncm;
  }
  await gravarEstado(sql, 'ncm_padrao', atual);
  await sql`INSERT INTO solicitacoes_log (usuario, acao, detalhe) VALUES (${usuario.email}, 'ncm-padrao', ${JSON.stringify(mudancas)}::jsonb)`;
  return atual;
}

// Produtos criados com o NCM padrão e ainda não conferidos.
export const listarParaRevisarNcm = (sql = sqlPadrao) => sql`
  SELECT i.id, i.descricao, i.ncm, i.codigo_gerado AS codigo, s.id AS solicitacao_id, s.titulo, s.url, c.omie_id, c.nexaas_id, c.familia_prefixo
  FROM solicitacao_itens i JOIN solicitacoes s ON s.id = i.solicitacao_id JOIN cadastros c ON c.id = i.cadastro_id
  WHERE i.ncm_padrao AND i.ncm_revisado_em IS NULL AND i.codigo_gerado IS NOT NULL
  ORDER BY s.recebido_em DESC, i.ordem LIMIT 300`;

// Conferido (mesmo NCM) ou corrigido (NCM novo, atualizado no Omie). Repetir não faz nada de novo.
// O Nexaas não tem rotina de alteração no sistema: o aviso diz para ajustar lá quando o NCM mudou.
export async function revisarNcm(sql = sqlPadrao, usuario, itemId, novoNcm, { consultar = consultarProdutoOmie, alterar = alterarProdutoOmie } = {}) {
  const [i] = await sql`SELECT i.id, i.descricao, i.ncm, i.ncm_revisado_em, i.solicitacao_id, c.codigo, c.omie_id, c.nexaas_id, c.familia_prefixo, c.familia_omie, c.id AS cadastro_id
    FROM solicitacao_itens i JOIN cadastros c ON c.id = i.cadastro_id WHERE i.id = ${itemId}`;
  if (!i) throw new Error('Produto não encontrado.');
  if (i.ncm_revisado_em) return { jaRevisado: true };
  const ncm = normalizarNcm(novoNcm || i.ncm);
  if (ncm.length !== 8) throw new Error('NCM inválido: precisa ter 8 números.');
  const mudou = ncm !== normalizarNcm(i.ncm);
  if (mudou) {
    if (!i.omie_id) throw new Error('Produto sem ID do Omie: não dá para corrigir o NCM por aqui.');
    const familia = await resolverFamiliaOmie(sql, i.familia_omie);
    if (familia.erro) throw new Error(familia.erro);
    const atual = await consultar({ codigo_produto: Number(i.omie_id) });
    const produto = montarProdutoOmie({ descricao: atual.descricao ?? i.descricao, ncm, familia: obterFamiliaPorPrefixo(i.familia_prefixo) }, familia.codigo, { codigo: i.codigo, codigoProdutoOmie: Number(i.omie_id) });
    // Preserva o que alguém já ajustou no Omie depois da criação.
    if (atual.valor_unitario !== undefined) produto.valor_unitario = atual.valor_unitario;
    if (atual.unidade) produto.unidade = atual.unidade;
    await alterar(produto);
    await sql`UPDATE cadastros SET ncm = ${ncm}, atualizado_em = now() WHERE id = ${i.cadastro_id}`;
  }
  await sql`UPDATE solicitacao_itens SET ncm = ${ncm}, ncm_revisado_em = now(), ncm_revisado_por = ${usuario.email} WHERE id = ${itemId} AND ncm_revisado_em IS NULL`;
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${i.solicitacao_id}, ${usuario.email}, ${mudou ? 'ncm-corrigido' : 'ncm-conferido'}, ${JSON.stringify({ codigo: i.codigo, de: i.ncm, para: ncm })}::jsonb)`;
  return { jaRevisado: false, mudou, avisoNexaas: mudou && i.nexaas_id ? `O NCM do produto ${i.codigo} foi corrigido no Omie. No Nexaas (produto ${i.nexaas_id}) ajuste o NCM manualmente.` : null };
}
