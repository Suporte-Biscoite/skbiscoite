// api/_lib/catalogo.js — espelho local (Neon) do catálogo do Omie.
// Em vez de baixar os ~7 mil produtos (96 s) a cada cadastro, baixamos tudo UMA vez
// e depois só o que mudou (1 chamada curta).
import { sql as sqlPadrao } from './db.js';
import { normalizarTexto } from '../../src/lib/familias.js';
import { listarFamiliasOmie, listarProdutosOmie } from './omie.js';

const CHAVE = 'catalogo';
const CONCORRENCIA = 3; // páginas em paralelo na carga inicial (o Omie aceita poucas chamadas simultâneas)
const INCREMENTAL_A_CADA_MS = 60 * 1000;
const FAMILIAS_VALIDAS_POR_MS = 10 * 60 * 1000;

export async function lerEstado(sql = sqlPadrao, chave = CHAVE) {
  const [linha] = await sql`SELECT valor, atualizado_em FROM sync_meta WHERE chave = ${chave}`;
  return linha ? { ...linha.valor, _atualizado_em: linha.atualizado_em } : null;
}

export async function gravarEstado(sql, chave, valor) {
  const json = JSON.stringify(valor);
  await sql`INSERT INTO sync_meta (chave, valor, atualizado_em) VALUES (${chave}, ${json}::jsonb, now())
    ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`;
}

// Data (dd/mm/aaaa) no fuso de Brasília, como o Omie espera.
export const dataOmie = (data) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(data);

// Grava/atualiza produtos no espelho. Deduplica por código (o Omie pode repetir).
export async function salvarProdutos(sql, produtos) {
  const porCodigo = new Map();
  for (const p of produtos) {
    const codigo = String(p.codigo ?? '').trim();
    if (!codigo) continue;
    const descricao = String(p.descricao ?? '').trim();
    porCodigo.set(codigo, {
      codigo,
      descricao,
      norm: normalizarTexto(descricao),
      id: p.codigo_produto ?? null,
      inativo: p.inativo === 'S' || p.inativo === true,
    });
  }
  const lista = [...porCodigo.values()];
  if (lista.length === 0) return 0;
  await sql`INSERT INTO omie_produtos (codigo, descricao, descricao_norm, codigo_produto, inativo)
    SELECT * FROM unnest(${lista.map((p) => p.codigo)}::text[], ${lista.map((p) => p.descricao)}::text[],
      ${lista.map((p) => p.norm)}::text[], ${lista.map((p) => p.id)}::bigint[], ${lista.map((p) => p.inativo)}::boolean[])
    ON CONFLICT (codigo) DO UPDATE SET descricao = EXCLUDED.descricao, descricao_norm = EXCLUDED.descricao_norm,
      codigo_produto = EXCLUDED.codigo_produto, inativo = EXCLUDED.inativo, atualizado_em = now()`;
  return lista.length;
}

// Carga inicial em fatias (cada chamada faz o que couber no orçamento de tempo e salva o progresso)
// e, depois de completa, atualização incremental. Devolve o estado para a tela mostrar o progresso.
export async function sincronizarCatalogo(sql = sqlPadrao, { orcamentoMs = 40000 } = {}) {
  const inicioChamada = Date.now();
  let estado = (await lerEstado(sql)) || { completo: false, proxima_pagina: 1, total_paginas: null, inicio: new Date().toISOString(), ultima: null };

  if (!estado.completo) {
    if (!estado.total_paginas) {
      const primeira = await listarProdutosOmie({ pagina: 1 });
      estado.total_paginas = primeira.total_de_paginas || 1;
      await salvarProdutos(sql, primeira.produto_servico_cadastro || []);
      estado.proxima_pagina = 2;
      estado.inicio = new Date().toISOString();
    }
    while (estado.proxima_pagina <= estado.total_paginas && Date.now() - inicioChamada < orcamentoMs) {
      const paginas = [];
      for (let p = estado.proxima_pagina; p < estado.proxima_pagina + CONCORRENCIA && p <= estado.total_paginas; p++) paginas.push(p);
      const respostas = await Promise.all(paginas.map((pagina) => listarProdutosOmie({ pagina })));
      for (const r of respostas) await salvarProdutos(sql, r.produto_servico_cadastro || []);
      estado.proxima_pagina += paginas.length;
      await gravarEstado(sql, CHAVE, estado);
    }
    if (estado.proxima_pagina > estado.total_paginas) {
      estado = { ...estado, completo: true, ultima: estado.inicio };
    }
    await gravarEstado(sql, CHAVE, estado);
    return resumoEstado(estado);
  }

  return sincronizarIncremental(sql, estado);
}

// Traz só o que foi incluído/alterado desde a última vez (com 1 dia de folga, pois o filtro é por data).
async function sincronizarIncremental(sql, estado) {
  const agora = new Date();
  const desde = dataOmie(new Date(new Date(estado.ultima).getTime() - 24 * 60 * 60 * 1000));
  for (let pagina = 1, total = 1; pagina <= total; pagina++) {
    const r = await listarProdutosOmie({ pagina, desde });
    total = r.total_de_paginas || 1;
    await salvarProdutos(sql, r.produto_servico_cadastro || []);
  }
  const novo = { ...estado, ultima: agora.toISOString() };
  delete novo._atualizado_em;
  await gravarEstado(sql, CHAVE, novo);
  return resumoEstado(novo);
}

const resumoEstado = (e) => ({ completo: !!e.completo, pagina: Math.min(e.proxima_pagina - 1, e.total_paginas || 0), total_paginas: e.total_paginas || 0 });

// Chamada antes de validar/cadastrar: garante que o espelho está pronto e recente.
export async function garantirCatalogo(sql = sqlPadrao) {
  const estado = await lerEstado(sql);
  if (!estado?.completo) return { completo: false, ...(estado ? resumoEstado(estado) : { pagina: 0, total_paginas: 0 }) };
  if (Date.now() - new Date(estado._atualizado_em).getTime() > INCREMENTAL_A_CADA_MS) await sincronizarIncremental(sql, estado);
  return { completo: true, pagina: estado.total_paginas, total_paginas: estado.total_paginas };
}

// ---------- Famílias do Omie ----------
export async function atualizarFamilias(sql = sqlPadrao) {
  const familias = (await listarFamiliasOmie()).filter((f) => f.codigo && f.nomeFamilia);
  const porCodigo = new Map(familias.map((f) => [f.codigo, f]));
  const lista = [...porCodigo.values()];
  await sql.transaction([
    sql`DELETE FROM omie_familias`,
    sql`INSERT INTO omie_familias (codigo, cod_familia, nome, nome_norm, inativa)
      SELECT * FROM unnest(${lista.map((f) => f.codigo)}::bigint[], ${lista.map((f) => String(f.codFamilia ?? ''))}::text[],
        ${lista.map((f) => f.nomeFamilia)}::text[], ${lista.map((f) => normalizarTexto(f.nomeFamilia))}::text[],
        ${lista.map((f) => f.inativo === 'S')}::boolean[])`,
  ]);
  await gravarEstado(sql, 'familias', { total: lista.length });
}

export async function familiasOmie(sql = sqlPadrao) {
  const estado = await lerEstado(sql, 'familias');
  if (!estado || Date.now() - new Date(estado._atualizado_em).getTime() > FAMILIAS_VALIDAS_POR_MS) await atualizarFamilias(sql);
  return sql`SELECT codigo, cod_familia, nome, nome_norm, inativa FROM omie_familias ORDER BY nome`;
}

// Acha a família pelo nome. Bloqueia (em vez de chutar) quando não existe, está inativa ou o nome é repetido.
export async function resolverFamiliaOmie(sql, nome) {
  const norm = normalizarTexto(nome);
  const todas = await familiasOmie(sql);
  const ativas = todas.filter((f) => f.nome_norm === norm && !f.inativa);
  if (ativas.length === 1) return { codigo: Number(ativas[0].codigo), nome: ativas[0].nome };
  if (ativas.length > 1) return { erro: `A família "${nome}" está repetida no Omie (${ativas.length} cadastros). Corrija no Omie para evitar cadastrar na errada.` };
  if (todas.some((f) => f.nome_norm === norm)) return { erro: `A família "${nome}" está inativa no Omie.` };
  return { erro: `A família "${nome}" não foi encontrada no Omie.` };
}

// Já existe produto com esta descrição (no Omie ou num cadastro em andamento)?
export async function descricaoJaExiste(sql, descricao) {
  const norm = normalizarTexto(descricao);
  const [noOmie] = await sql`SELECT codigo FROM omie_produtos WHERE descricao_norm = ${norm} LIMIT 1`;
  if (noOmie) return `já existe no Omie com o código ${noOmie.codigo}`;
  const candidatos = await sql`SELECT descricao, codigo FROM cadastros WHERE omie_status <> 'erro' AND upper(descricao) = ${descricao.toUpperCase()} LIMIT 1`;
  if (candidatos.length) return `já foi cadastrado agora há pouco${candidatos[0].codigo ? ` (código ${candidatos[0].codigo})` : ''}`;
  return null;
}
