// api/_lib/cadastros.js — o fluxo completo: validar -> reservar código -> Omie -> Nexaas.
// Cada produto é uma linha em `cadastros`; o estado de cada sistema fica salvo separado, então
// uma falha no Nexaas nunca faz o Omie repetir (e vice-versa).
import crypto from 'node:crypto';
import { sql as sqlPadrao } from './db.js';
import { normalizarTexto, obterFamiliaPorPrefixo } from '../../src/lib/familias.js';
import { encontrarProximaVaga, ehErroDeCodigoDuplicado } from '../../src/lib/skus.js';
import { CANAL_NEXAAS_ESTOQUE, validarItem, montarProdutoOmie, montarProdutoNexaas, nomeFamiliaOmie, nomeCategoriaNexaas } from '../../src/lib/regras.js';
import { descricaoJaExiste, familiasOmie, gravarEstado, lerEstado, resolverFamiliaOmie, salvarProdutos } from './catalogo.js';
import { alterarProdutoOmie, consultarProdutoOmie, ErroOmie, incluirProdutoOmie } from './omie.js';
import { buscarSkuNexaas, criarProdutoNexaas, listarCanaisNexaas, listarCategoriasNexaas } from './nexaas.js';

const NEXAAS_CONFIG_VALIDA_POR_MS = 30 * 60 * 1000;
const ORGANIZACAO_NEXAAS_PADRAO = 475; // BISCOITE CENTER NORTE (o produto fica visível para todas as organizações)

// ---------- Configuração do Nexaas (ids resolvidos por nome, em cache) ----------
export async function configNexaas(sql = sqlPadrao) {
  let estado = await lerEstado(sql, 'nexaas');
  if (!estado || Date.now() - new Date(estado._atualizado_em).getTime() > NEXAAS_CONFIG_VALIDA_POR_MS) {
    const [categorias, canais] = await Promise.all([listarCategoriasNexaas(), listarCanaisNexaas()]);
    const porNome = new Map();
    for (const c of categorias) {
      const chave = normalizarTexto(c.name);
      porNome.set(chave, porNome.has(chave) ? null : c.id); // nome repetido = ambíguo, não chutamos
    }
    const estoques = canais.filter((c) => normalizarTexto(c.name) === CANAL_NEXAAS_ESTOQUE);
    estado = {
      categorias: Object.fromEntries(porNome),
      canalEstoqueId: estoques.length === 1 ? estoques[0].id : null,
    };
    await gravarEstado(sql, 'nexaas', estado);
  }
  return {
    organizationId: Number(process.env.NEXAAS_ORGANIZATION_ID) || ORGANIZACAO_NEXAAS_PADRAO,
    categorias: estado.categorias,
    canalEstoqueId: estado.canalEstoqueId,
  };
}

// Famílias que o usuário pode escolher como "sazonal": existem no Omie (ativas, sem nome repetido)
// E no Nexaas (categoria de mesmo nome), fora as 7 famílias-base.
export async function listarFamiliasSazonais(sql = sqlPadrao) {
  const [familias, nexaas] = await Promise.all([familiasOmie(sql), configNexaas(sql)]);
  const nomesBase = new Set(['INSUMOS PARA ENVASE', 'EMBALAGEM', 'PRODUTOS PARA REVENDA', 'PRODUTOS PRONTOS', 'CESTAS/KIT', 'SUPRIMENTOS', 'ATIVO'].map(normalizarTexto));
  const contagem = new Map();
  for (const f of familias.filter((x) => !x.inativa)) contagem.set(f.nome_norm, (contagem.get(f.nome_norm) || 0) + 1);
  return familias
    .filter((f) => !f.inativa && contagem.get(f.nome_norm) === 1 && !nomesBase.has(f.nome_norm) && !/^(X\s*-|INATIVO)/.test(f.nome_norm) && nexaas.categorias[f.nome_norm])
    .map((f) => f.nome);
}

// ---------- Validação ----------
// Devolve, para cada item: { linha, erros: [...], item?, familiaOmie?, categoriaNexaas? }.
export async function validarLote(sql, itensBrutos) {
  const nexaas = await configNexaas(sql);
  const vistas = new Set();
  const resultados = [];

  for (const [indice, bruto] of itensBrutos.entries()) {
    const linha = bruto.linha ?? indice + 1;
    const { erros, item } = validarItem(bruto);

    if (item.familia) {
      const nomeOmie = nomeFamiliaOmie(item);
      if (!item.sazonal || item.familiaSazonal) {
        const fam = await resolverFamiliaOmie(sql, nomeOmie);
        if (fam.erro) erros.push(fam.erro);
      }
      if (item.entraNaLoja !== null && (!item.sazonal || item.familiaSazonal)) {
        const nomeCat = nomeCategoriaNexaas(item);
        if (!nexaas.categorias[normalizarTexto(nomeCat)]) erros.push(`A categoria "${nomeCat}" não existe (ou está repetida) no Nexaas.`);
      }
    }

    if (item.descricao) {
      const chave = normalizarTexto(item.descricao);
      if (vistas.has(chave)) erros.push('Descrição repetida neste mesmo lote.');
      else {
        vistas.add(chave);
        const existente = await descricaoJaExiste(sql, item.descricao);
        if (existente) erros.push(`Produto ${existente}.`);
      }
    }
    resultados.push({ linha, descricao: item.descricao, erros, item });
  }
  return resultados;
}

// Valida e grava os itens válidos como pendentes. Os inválidos voltam bloqueados, com o motivo.
export async function criarLote(sql, usuario, itensBrutos) {
  const resultados = await validarLote(sql, itensBrutos);
  const validos = resultados.filter((r) => r.erros.length === 0);
  const loteId = crypto.randomUUID();

  if (validos.length > 0) {
    const col = (fn) => validos.map(fn);
    await sql`INSERT INTO cadastros (lote_id, linha, usuario_email, descricao, ncm, entra_na_loja, sazonal, familia_base, familia_prefixo, familia_omie, categoria_nexaas)
      SELECT ${loteId}::uuid, * FROM unnest(${col((r) => r.linha)}::int[], ${col(() => usuario.email)}::text[], ${col((r) => r.item.descricao)}::text[],
        ${col((r) => r.item.ncm)}::text[], ${col((r) => r.item.entraNaLoja)}::boolean[], ${col((r) => r.item.sazonal)}::boolean[],
        ${col((r) => r.item.familia.familia)}::text[], ${col((r) => r.item.familia.prefixo)}::text[],
        ${col((r) => nomeFamiliaOmie(r.item))}::text[], ${col((r) => nomeCategoriaNexaas(r.item))}::text[])`;
  }
  return {
    lote_id: validos.length ? loteId : null,
    criados: validos.length,
    bloqueados: resultados.filter((r) => r.erros.length > 0).map(({ linha, descricao, erros }) => ({ linha, descricao, erros })),
  };
}

// ---------- Reserva atômica de código ----------
async function candidatosDoPrefixo(sql, prefixo) {
  const padrao = `${prefixo}%`;
  return sql`SELECT codigo, descricao, codigo_produto FROM omie_produtos WHERE codigo LIKE ${padrao} AND length(codigo) = 7
    UNION ALL SELECT codigo, descricao, NULL::bigint FROM cadastros WHERE codigo LIKE ${padrao} AND length(codigo) = 7`;
}

// Escolhe o primeiro código livre do prefixo e o grava no cadastro. O índice único em
// cadastros.codigo garante que dois usuários ao mesmo tempo nunca recebam o mesmo código.
export async function reservarCodigo(sql, cadastro) {
  const ocupados = new Set();
  for (let tentativa = 0; tentativa < 8; tentativa++) {
    const produtos = (await candidatosDoPrefixo(sql, cadastro.familia_prefixo)).map((p) => ({ ...p, codigo_produto: p.codigo_produto ? Number(p.codigo_produto) : undefined }));
    const vaga = encontrarProximaVaga(produtos, cadastro.familia_prefixo, { ocupados });
    try {
      const [atualizado] = await sql`UPDATE cadastros SET codigo = ${vaga.codigo}, acao = ${vaga.acao}, codigo_produto_omie = ${vaga.codigo_produto ?? null}, atualizado_em = now()
        WHERE id = ${cadastro.id} RETURNING *`;
      return atualizado;
    } catch (erro) {
      if (erro.code === '23505') { ocupados.add(vaga.codigo); continue; } // outro cadastro pegou antes
      throw erro;
    }
  }
  throw new Error('Não consegui reservar um código livre. Tente novamente.');
}

const itemDeRegra = (c) => ({
  descricao: c.descricao,
  ncm: c.ncm,
  entraNaLoja: c.entra_na_loja,
  sazonal: c.sazonal,
  familia: obterFamiliaPorPrefixo(c.familia_prefixo),
  familiaSazonal: c.sazonal ? c.familia_omie : '',
});

// ---------- Etapa Omie ----------
async function etapaOmie(sql, cadastro) {
  const familia = await resolverFamiliaOmie(sql, cadastro.familia_omie);
  if (familia.erro) return erroOmie(sql, cadastro, familia.erro);

  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    if (!cadastro.codigo) cadastro = await reservarCodigo(sql, cadastro);
    const standBy = cadastro.acao === 'AlterarProduto';
    const produto = montarProdutoOmie(itemDeRegra(cadastro), familia.codigo, {
      codigo: cadastro.codigo,
      codigoProdutoOmie: standBy ? Number(cadastro.codigo_produto_omie) : null,
    });
    try {
      const resposta = await (standBy ? alterarProdutoOmie(produto) : incluirProdutoOmie(produto));
      return await sucessoOmie(sql, cadastro, resposta.codigo_produto ?? cadastro.codigo_produto_omie);
    } catch (erro) {
      if (!(erro instanceof ErroOmie)) return erroOmie(sql, cadastro, erro.message);
      if (!standBy && ehErroDeCodigoDuplicado(erro.message)) {
        // Duas possibilidades: já criamos antes e perdemos a resposta (então está OK), ou o código é de outro produto.
        const existente = await consultarProdutoOmie({ codigo_produto_integracao: cadastro.codigo }).catch(() => null);
        if (existente && normalizarTexto(existente.descricao) === normalizarTexto(cadastro.descricao)) {
          return await sucessoOmie(sql, cadastro, existente.codigo_produto);
        }
        await salvarProdutos(sql, [{ codigo: cadastro.codigo, descricao: '(código já usado no Omie)', codigo_produto: null }]);
        await sql`UPDATE cadastros SET codigo = NULL, acao = NULL, codigo_produto_omie = NULL WHERE id = ${cadastro.id}`;
        cadastro = { ...cadastro, codigo: null, acao: null, codigo_produto_omie: null };
        continue;
      }
      return erroOmie(sql, cadastro, erro.message);
    }
  }
  return erroOmie(sql, cadastro, 'O Omie recusou vários códigos seguidos por duplicidade.');
}

async function sucessoOmie(sql, cadastro, omieId) {
  // Já deixa o Nexaas "criando" para nenhum outro processo pegar o mesmo item.
  const [atualizado] = await sql`UPDATE cadastros SET omie_status = 'ok', omie_erro = NULL, omie_id = ${omieId ?? null},
      nexaas_status = CASE WHEN nexaas_status = 'ok' THEN 'ok' ELSE 'criando' END, iniciado_em = now(), atualizado_em = now()
    WHERE id = ${cadastro.id} RETURNING *`;
  await salvarProdutos(sql, [{ codigo: cadastro.codigo, descricao: cadastro.descricao, codigo_produto: omieId }]);
  await sql`INSERT INTO historico_skus (email_usuario, sku, descricao) VALUES (${cadastro.usuario_email}, ${cadastro.codigo}, ${cadastro.descricao})`.catch(() => {});
  return atualizado;
}

async function erroOmie(sql, cadastro, mensagem) {
  const [atualizado] = await sql`UPDATE cadastros SET omie_status = 'erro', omie_erro = ${mensagem}, atualizado_em = now() WHERE id = ${cadastro.id} RETURNING *`;
  return atualizado;
}

// ---------- Etapa Nexaas ----------
async function etapaNexaas(sql, cadastro) {
  try {
    const cfg = await configNexaas(sql);
    const categoriaId = cfg.categorias[normalizarTexto(cadastro.categoria_nexaas)];
    if (!categoriaId) throw new Error(`A categoria "${cadastro.categoria_nexaas}" não existe (ou está repetida) no Nexaas.`);

    // Nunca duplica: se o SKU já está no Nexaas (ex.: criado numa tentativa anterior), só registra.
    const existente = await buscarSkuNexaas(cadastro.codigo);
    let nexaasId = existente?.product_id;
    if (!existente) {
      const corpo = montarProdutoNexaas(itemDeRegra(cadastro), cadastro.codigo, {
        organizationId: cfg.organizationId,
        categoriaId,
        canalEstoqueId: cfg.canalEstoqueId,
      });
      nexaasId = (await criarProdutoNexaas(corpo)).product?.id;
    }
    const [atualizado] = await sql`UPDATE cadastros SET nexaas_status = 'ok', nexaas_erro = NULL, nexaas_id = ${nexaasId ?? null}, atualizado_em = now() WHERE id = ${cadastro.id} RETURNING *`;
    return atualizado;
  } catch (erro) {
    const [atualizado] = await sql`UPDATE cadastros SET nexaas_status = 'erro', nexaas_erro = ${erro.message}, atualizado_em = now() WHERE id = ${cadastro.id} RETURNING *`;
    return atualizado;
  }
}

// ---------- Fila ----------
// Pega até `n` itens pendentes (de forma que dois processos nunca peguem o mesmo) e os marca "criando".
// Itens "criando" parados há mais de 3 minutos (função que caiu) voltam para a fila.
async function pegarOmie(sql, loteId, n) {
  return sql`UPDATE cadastros SET omie_status = 'criando', iniciado_em = now(), atualizado_em = now()
    WHERE id IN (SELECT id FROM cadastros WHERE lote_id = ${loteId}::uuid
      AND (omie_status = 'pendente' OR (omie_status = 'criando' AND iniciado_em < now() - interval '3 minutes'))
      ORDER BY id LIMIT ${n} FOR UPDATE SKIP LOCKED) RETURNING *`;
}

async function pegarNexaas(sql, loteId, n) {
  return sql`UPDATE cadastros SET nexaas_status = 'criando', iniciado_em = now(), atualizado_em = now()
    WHERE id IN (SELECT id FROM cadastros WHERE lote_id = ${loteId}::uuid AND omie_status = 'ok'
      AND (nexaas_status = 'pendente' OR (nexaas_status = 'criando' AND iniciado_em < now() - interval '3 minutes'))
      ORDER BY id LIMIT ${n} FOR UPDATE SKIP LOCKED) RETURNING *`;
}

// Processa o que couber em `orcamentoMs`. O navegador chama de novo enquanto restar trabalho.
export async function processarLote(sql, loteId, { orcamentoMs = 25000, concorrencia = 2 } = {}) {
  const inicio = Date.now();
  while (Date.now() - inicio < orcamentoMs) {
    const paraOmie = await pegarOmie(sql, loteId, concorrencia);
    const paraNexaas = paraOmie.length ? [] : await pegarNexaas(sql, loteId, concorrencia);
    if (paraOmie.length === 0 && paraNexaas.length === 0) break;

    await Promise.all([
      ...paraOmie.map(async (c) => {
        const depois = await etapaOmie(sql, c);
        if (depois.omie_status === 'ok' && depois.nexaas_status === 'criando') await etapaNexaas(sql, depois);
      }),
      ...paraNexaas.map((c) => etapaNexaas(sql, c)),
    ]);
  }
  return estadoDoLote(sql, loteId);
}

// "Tentar de novo": volta só o que falhou, e só a etapa que falhou (o Omie ok nunca repete).
export async function reprocessar(sql, loteId, { id = null } = {}) {
  await sql`UPDATE cadastros SET omie_status = 'pendente', omie_erro = NULL, atualizado_em = now()
    WHERE lote_id = ${loteId}::uuid AND omie_status = 'erro' AND (${id}::bigint IS NULL OR id = ${id}::bigint)`;
  await sql`UPDATE cadastros SET nexaas_status = 'pendente', nexaas_erro = NULL, atualizado_em = now()
    WHERE lote_id = ${loteId}::uuid AND omie_status = 'ok' AND nexaas_status = 'erro' AND (${id}::bigint IS NULL OR id = ${id}::bigint)`;
}

export async function estadoDoLote(sql, loteId) {
  const itens = await sql`SELECT id, linha, descricao, codigo, familia_omie, categoria_nexaas, entra_na_loja, sazonal,
      omie_status, omie_erro, omie_id, nexaas_status, nexaas_erro, nexaas_id, acao
    FROM cadastros WHERE lote_id = ${loteId}::uuid ORDER BY id`;
  const terminou = (i) => i.omie_status === 'erro' || (i.omie_status === 'ok' && ['ok', 'erro'].includes(i.nexaas_status));
  return { itens, concluido: itens.length > 0 && itens.every(terminou) };
}

export const ultimosCadastros = (sql, limite = 100) =>
  sql`SELECT id, lote_id, descricao, codigo, familia_omie, entra_na_loja, omie_status, omie_erro, nexaas_status, nexaas_erro, usuario_email, criado_em
    FROM cadastros ORDER BY id DESC LIMIT ${limite}`;
