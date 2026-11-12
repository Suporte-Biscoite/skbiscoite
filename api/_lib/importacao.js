// api/_lib/importacao.js — traz para o Nexaas produtos que JÁ existem no Omie.
// Para cada código: lê no Omie, confere se o SKU já está no Nexaas e, se não estiver, cria.
// Só 300 e 400 entram na loja (PDV); o resto fica só no estoque. Nunca altera nada no Omie.
import crypto from 'node:crypto';
import { normalizarTexto, FAMILIAS } from '../../src/lib/familias.js';
import { entraNaLojaPorCodigo, montarProdutoNexaas, planejarImportacaoOmie } from '../../src/lib/regras.js';
import { consultarProdutoOmie } from './omie.js';
import { buscarSkuNexaas, criarProdutoNexaas } from './nexaas.js';
import { configNexaas } from './cadastros.js';

export const LIMITE_CODIGOS_POR_CHAMADA = 20;

export const normalizarCodigos = (lista) => [...new Set((lista || []).map((c) => String(c ?? '').trim()).filter(Boolean))];

async function mapear(lista, concorrencia, fn) {
  const saida = new Array(lista.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(concorrencia, lista.length) }, async () => {
    while (proximo < lista.length) { const i = proximo++; saida[i] = await fn(lista[i]); }
  }));
  return saida;
}

// Cache curto: analisar e importar o mesmo código em seguida não repete a mesma consulta no Omie
// (o Omie bloqueia a API por 30 min quando recebe a mesma consulta várias vezes em pouco tempo).
const cacheOmie = new Map();
const CACHE_MS = 90 * 1000;
async function produtoDoOmie(codigo) {
  const guardado = cacheOmie.get(codigo);
  if (guardado && Date.now() - guardado.em < CACHE_MS) return guardado.produto;
  const produto = await consultarProdutoOmie({ codigo });
  if (cacheOmie.size > 500) cacheOmie.clear();
  cacheOmie.set(codigo, { produto, em: Date.now() });
  return produto;
}

const mensagemOmie = (erro) => {
  if (/n[aã]o cadastrad/i.test(erro.message)) return 'Código não encontrado no Omie.';
  const bloqueio = erro.message.match(/bloqueada por consumo indevido.*?(\d+) segundos/i);
  if (bloqueio) return `O Omie bloqueou as consultas por excesso de uso. Aguarde cerca de ${Math.ceil(Number(bloqueio[1]) / 60)} minuto(s) e tente de novo.`;
  return `Falha ao consultar o Omie: ${erro.message}`;
};

// Olha um código: Nexaas (já existe?) -> Omie -> regras. NÃO grava nada. estado: pronto | ja_no_nexaas | erro
// O Nexaas vem primeiro: o que já está lá nem precisa ser consultado no Omie.
async function analisarCodigo(codigo, cfg) {
  try {
    const existente = await buscarSkuNexaas(codigo);
    if (existente) return { codigo, estado: 'ja_no_nexaas', nexaasId: existente.product_id, descricao: String(existente.name ?? '').replace(`${codigo} - `, ''), entraNaLoja: entraNaLojaPorCodigo(codigo) };
  } catch (erro) {
    return { codigo, estado: 'erro', erros: [`Falha ao consultar o Nexaas: ${erro.message}`] };
  }
  let produto;
  try {
    produto = await produtoDoOmie(codigo);
  } catch (erro) {
    return { codigo, estado: 'erro', erros: [mensagemOmie(erro)] };
  }
  const plano = planejarImportacaoOmie(produto, cfg.categorias);
  const base = { codigo, descricao: plano.item.descricao, familiaOmie: produto.descricao_familia || '', entraNaLoja: plano.item.entraNaLoja, categoriaNexaas: plano.categoriaNexaas, aviso: plano.aviso, ncm: plano.item.ncm, _plano: plano };
  if (plano.erros.length) return { ...base, estado: 'erro', erros: plano.erros };
  return { ...base, estado: 'pronto' };
}

const publico = (r) => { const { _plano: _ignorado, ...resto } = r; return resto; };

export async function analisarCodigos(sql, codigos) {
  const cfg = await configNexaas(sql);
  return (await mapear(codigos, 4, (c) => analisarCodigo(c, cfg))).map(publico);
}

const familiaDoCodigo = (codigo) => FAMILIAS.find((f) => codigo.startsWith(f.prefixo)) || null;

// Registra no histórico (tabela cadastros) quem importou o quê. Se o código já tem linha, só atualiza o Nexaas.
async function registrar(sql, usuario, loteId, r, nexaas) {
  const fam = familiaDoCodigo(r.codigo);
  await sql`INSERT INTO cadastros (lote_id, usuario_email, descricao, ncm, entra_na_loja, familia_base, familia_prefixo, familia_omie, categoria_nexaas, codigo, acao,
      omie_status, omie_erro, nexaas_status, nexaas_erro, nexaas_id)
    VALUES (${loteId}::uuid, ${usuario.email}, ${r.descricao}, ${r.ncm || ''}, ${r.entraNaLoja}, ${fam?.familia ?? ''}, ${fam?.prefixo ?? ''}, ${r.familiaOmie}, ${r.categoriaNexaas}, ${r.codigo}, 'ImportarOmie',
      'ok', NULL, ${nexaas.status}, ${nexaas.erro ?? null}, ${nexaas.id ?? null})
    ON CONFLICT (codigo) WHERE codigo IS NOT NULL DO UPDATE
      SET nexaas_status = EXCLUDED.nexaas_status, nexaas_erro = EXCLUDED.nexaas_erro, nexaas_id = COALESCE(EXCLUDED.nexaas_id, cadastros.nexaas_id), atualizado_em = now()`;
}

export async function importarCodigos(sql, usuario, codigos) {
  const cfg = await configNexaas(sql);
  const loteId = crypto.randomUUID();
  const resultados = await mapear(codigos, 3, async (codigo) => {
    const r = await analisarCodigo(codigo, cfg);
    if (r.estado === 'erro' && !r._plano) return publico(r); // nem chegou a existir no Omie: nada a registrar
    if (r.estado === 'ja_no_nexaas') return publico(r); // já estava lá: não mexe em nada
    if (r.estado === 'pronto') {
      try {
        const categoriaId = cfg.categorias[normalizarTexto(r.categoriaNexaas)];
        if (!categoriaId) throw new Error(`A categoria "${r.categoriaNexaas}" não existe (ou está repetida) no Nexaas.`);
        const corpo = montarProdutoNexaas({ descricao: r._plano.item.descricao, ncm: r._plano.item.ncm, entraNaLoja: r.entraNaLoja }, codigo, {
          organizationId: cfg.organizationId, categoriaId, canalEstoqueId: cfg.canalEstoqueId,
        });
        const criado = await criarProdutoNexaas(corpo);
        const nexaasId = criado.product?.id ?? null;
        await registrar(sql, usuario, loteId, r, { status: 'ok', id: nexaasId });
        return publico({ ...r, estado: 'criado', nexaasId });
      } catch (erro) {
        await registrar(sql, usuario, loteId, r, { status: 'erro', erro: erro.message }).catch(() => {});
        return publico({ ...r, estado: 'erro', erros: [erro.message] });
      }
    }
    return publico(r);
  });
  return resultados;
}
