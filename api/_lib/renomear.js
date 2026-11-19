// api/_lib/renomear.js — "Renomear códigos": troca o NOME de produtos já cadastrados, no Omie (base dos códigos) e depois no Nexaas.
// NUNCA é automático: propor só LÊ (Omie e Nexaas); aplicar e desfazer exigem uma pessoa e RENOMEAR_ATIVO=1 (desligado por padrão,
// até um teste real com um produto de teste). Só o nome muda: código, preço, NCM, família, estoque e situação ficam como estão.
import { randomUUID } from 'node:crypto';
import { sql as sqlPadrao } from './db.js';
import { alterarProdutoOmie, consultarProdutoOmie } from './omie.js';
import { buscarSkuNexaas, lerProdutoNexaas, renomearProdutoNexaas } from './nexaas.js';
import { salvarProdutos } from './catalogo.js';
import { normalizarTexto } from '../../src/lib/familias.js';
import { avaliarRenomeacao, corpoDeRenomeacao, lerLinhasDeRenomeacao } from '../../src/lib/renomear.js';

export const renomeacaoAtiva = () => process.env.RENOMEAR_ATIVO === '1';

export const listarRenomeacoes = (sql = sqlPadrao) => sql`SELECT id, lote, codigo, codigo_produto, nexaas_product_id, nome_novo, estado, antes->>'descricao' AS nome_antes, nexaas_antes, nexaas_depois, avisos, criado_por, criado_em, aprovado_por, aprovado_em, aplicado_em, desfeito_por, desfeito_em, erro FROM renomeacoes ORDER BY id DESC LIMIT 100`;

async function log(sql, usuario, acao, detalhe) {
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (NULL, ${usuario}, ${acao}, ${JSON.stringify(detalhe)}::jsonb)`;
}

// Só LEITURA no Omie e no Nexaas. Grava as propostas (com o estado de antes) e devolve a prévia, inclusive das linhas com problema.
export async function proporRenomeacoes(sql, usuario, texto, { consultar = consultarProdutoOmie, sku = buscarSkuNexaas, produtoNexaas = lerProdutoNexaas } = {}) {
  const linhas = lerLinhasDeRenomeacao(texto);
  if (linhas.length === 0) throw new Error('Cole pelo menos uma linha no formato "código; novo nome".');
  const lote = randomUUID();
  const resultado = [];
  for (const l of linhas) {
    if (l.erro) { resultado.push({ linha: l.linha, original: l.original, estado: 'invalida', avisos: [l.erro] }); continue; }
    const [aberta] = await sql`SELECT id FROM renomeacoes WHERE codigo = ${l.codigo} AND estado IN ('proposta', 'aplicando', 'erro') ORDER BY id DESC LIMIT 1`;
    if (aberta) { resultado.push({ linha: l.linha, codigo: l.codigo, nome_novo: l.nome, estado: 'invalida', avisos: [`Já existe uma renomeação em aberto para este código (#${aberta.id}).`] }); continue; }
    const omie = await consultar({ codigo: l.codigo }).catch(() => null);
    let nexaas = { existe: null };
    let nexaasAntes = {};
    try {
      const s = await sku(l.codigo);
      if (!s) nexaas = { existe: false };
      else {
        const p = await produtoNexaas(s.product_id).catch(() => null);
        nexaas = { existe: true, productId: s.product_id, nomeProduto: p?.name ?? null };
        nexaasAntes = { product_id: s.product_id, nome_produto: p?.name ?? null, nome_sku: s.name ?? null };
      }
    } catch { nexaas = { existe: null }; }
    const [outro] = await sql`SELECT codigo FROM omie_produtos WHERE inativo = false AND descricao_norm = ${normalizarTexto(l.nome)} AND codigo <> ${l.codigo} LIMIT 1`;
    const av = avaliarRenomeacao({ codigo: l.codigo, nome: l.nome, omie, nexaas, outroComNome: outro?.codigo });
    if (av.estado !== 'proposta') { resultado.push({ linha: l.linha, codigo: l.codigo, nome_novo: l.nome, nome_antes: omie?.descricao ?? null, estado: av.estado, avisos: av.avisos }); continue; }
    const [gravada] = await sql`INSERT INTO renomeacoes (lote, codigo, codigo_produto, nexaas_product_id, nome_novo, estado, antes, nexaas_antes, avisos, criado_por)
      VALUES (${lote}::uuid, ${l.codigo}, ${Number(omie.codigo_produto)}, ${nexaas.existe ? Number(nexaas.productId) : null}, ${l.nome}, 'proposta', ${JSON.stringify(omie)}::jsonb, ${JSON.stringify(nexaasAntes)}::jsonb, ${JSON.stringify(av.avisos)}::jsonb, ${usuario.email})
      RETURNING id, codigo, nome_novo, estado, avisos, nexaas_product_id`;
    resultado.push({ ...gravada, linha: l.linha, nome_antes: omie.descricao, nexaas_nome_antes: nexaasAntes.nome_produto ?? null });
  }
  await log(sql, usuario.email, 'renomear-proposta', { lote, total: linhas.length, propostas: resultado.filter((r) => r.estado === 'proposta').length });
  return { lote, ativa: renomeacaoAtiva(), linhas: resultado };
}

// Aprovação de uma pessoa. Cada passo roda uma vez (os feitos ficam marcados), então repetir após erro é seguro.
// Ordem: Omie primeiro (é a base dos códigos), depois o Nexaas. Se o Nexaas falhar, o Omie fica como está e dá para tentar de novo só o Nexaas.
export async function aplicarRenomeacoes(sql, usuario, ids, { consultar = consultarProdutoOmie, alterar = alterarProdutoOmie, produtoNexaas = lerProdutoNexaas, renomearNexaas = renomearProdutoNexaas, sku = buscarSkuNexaas } = {}) {
  if (!renomeacaoAtiva()) throw new Error('A renomeação está desligada no servidor (RENOMEAR_ATIVO). Ligue só depois de testar com um produto de teste.');
  const lista = [...new Set((ids || []).map(Number).filter(Number.isInteger))];
  if (lista.length === 0) throw new Error('Nenhuma renomeação escolhida.');
  const saida = [];
  for (const id of lista) {
    const [c] = await sql`SELECT * FROM renomeacoes WHERE id = ${id}`;
    if (!c) { saida.push({ id, estado: 'erro', erro: 'Renomeação não encontrada.' }); continue; }
    if (c.estado === 'aplicada') { saida.push({ id, estado: 'aplicada' }); continue; }
    const [trava] = await sql`UPDATE renomeacoes SET estado = 'aplicando', aprovado_por = COALESCE(aprovado_por, ${usuario.email}), aprovado_em = COALESCE(aprovado_em, now()), erro = NULL WHERE id = ${id} AND estado IN ('proposta', 'erro') RETURNING passos`;
    if (!trava) { saida.push({ id, estado: c.estado, erro: `Esta renomeação está "${c.estado}" e não pode ser aplicada.` }); continue; }
    const passos = { ...(trava.passos || {}) };
    const gravarPassos = () => sql`UPDATE renomeacoes SET passos = ${JSON.stringify(passos)}::jsonb WHERE id = ${id}`;
    try {
      if (!passos.omie) {
        const agora = await consultar({ codigo_produto: Number(c.codigo_produto) });
        if (agora.descricao !== c.antes.descricao) throw new Error('O nome mudou no Omie depois da prévia. Gere uma nova proposta.');
        await alterar(corpoDeRenomeacao(c.antes, c.nome_novo));
        passos.omie = true; await gravarPassos();
        await salvarProdutos(sql, [{ codigo: c.codigo, descricao: c.nome_novo, codigo_produto: c.codigo_produto, inativo: c.antes.inativo === 'S' }]);
      }
      let nexaasDepois = {};
      if (c.nexaas_product_id && !passos.nexaas) {
        await renomearNexaas(c.nexaas_product_id, c.nome_novo);
        passos.nexaas = true; await gravarPassos();
      }
      if (c.nexaas_product_id) {
        // Confere de volta: o nome do produto mudou? O nome do SKU acompanha? (só informa, não falha)
        const p = await produtoNexaas(c.nexaas_product_id).catch(() => null);
        const s = await sku(c.codigo).catch(() => null);
        nexaasDepois = { nome_produto: p?.name ?? null, nome_sku: s?.name ?? null };
        if (p?.name && p.name !== c.nome_novo) throw new Error(`O Nexaas respondeu, mas o nome do produto continua "${p.name}". Confira no Nexaas.`);
      }
      const [feita] = await sql`UPDATE renomeacoes SET estado = 'aplicada', aplicado_em = now(), nexaas_depois = ${JSON.stringify(nexaasDepois)}::jsonb WHERE id = ${id} RETURNING id, estado, nexaas_depois`;
      await log(sql, usuario.email, 'renomear-aplicada', { renomeacao: id, codigo: c.codigo, de: c.antes.descricao, para: c.nome_novo, nexaas: !!c.nexaas_product_id });
      saida.push(feita);
    } catch (erro) {
      const msg = String(erro.message).slice(0, 300);
      await sql`UPDATE renomeacoes SET estado = 'erro', erro = ${msg} WHERE id = ${id}`;
      await log(sql, usuario.email, 'renomear-falhou', { renomeacao: id, codigo: c.codigo, passos, erro: msg });
      saida.push({ id, estado: 'erro', erro: msg });
    }
  }
  return saida;
}

// Desfazer: devolve o nome de antes nos dois sistemas (a partir do registro guardado na proposta).
export async function desfazerRenomeacao(sql, usuario, id, { alterar = alterarProdutoOmie, renomearNexaas = renomearProdutoNexaas } = {}) {
  if (!renomeacaoAtiva()) throw new Error('A renomeação está desligada no servidor (RENOMEAR_ATIVO).');
  const [c] = await sql`SELECT * FROM renomeacoes WHERE id = ${id}`;
  if (!c) throw new Error('Renomeação não encontrada.');
  if (c.estado !== 'aplicada') throw new Error('Só dá para desfazer uma renomeação já aplicada.');
  await alterar(corpoDeRenomeacao(c.antes, c.antes.descricao));
  await salvarProdutos(sql, [{ codigo: c.codigo, descricao: c.antes.descricao, codigo_produto: c.codigo_produto, inativo: c.antes.inativo === 'S' }]);
  const nomeAntigoNexaas = c.nexaas_antes?.nome_produto;
  if (c.nexaas_product_id && nomeAntigoNexaas) await renomearNexaas(c.nexaas_product_id, nomeAntigoNexaas);
  const [feita] = await sql`UPDATE renomeacoes SET estado = 'desfeita', desfeito_por = ${usuario.email}, desfeito_em = now() WHERE id = ${id} AND estado = 'aplicada' RETURNING id, estado`;
  await log(sql, usuario.email, 'renomear-desfeita', { renomeacao: id, codigo: c.codigo });
  return feita;
}
