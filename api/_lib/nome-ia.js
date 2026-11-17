// api/_lib/nome-ia.js — "nome sujo": a IA identifica o produto REAL pesquisando na web e SUGERE um nome limpo no padrão do catálogo.
// Regras: nunca cadastra sozinha; sem confiança ou sem fonte o item fica "não identificado"; só o NOME do produto vai para a pesquisa
// (nenhum dado interno); resultado em cache; limite de pesquisas por dia e por solicitação. NCM da web é só sugestão com fonte.
//
// Como pesquisa: API Responses da OpenAI com a ferramenta nativa "web_search" (a mesma chave OPENAI_API_KEY que já existe; sem serviço novo).
// Duas chamadas: (1) pesquisa na web, texto livre, com citações; (2) organiza em JSON, sem ferramentas (não depende de a busca aceitar json_schema).
import crypto from 'node:crypto';
import { sql as sqlPadrao } from './db.js';
import { chaveCanonica } from '../../src/lib/solicitacoes.js';
import { descobrirPadraoDeNomes, limparNomeSugerido } from '../../src/lib/padraoNomes.js';
import { lerEstado, gravarEstado } from './catalogo.js';

export const LIMITE_BUSCAS_POR_DIA = 40;
export const LIMITE_ITENS_POR_SOLICITACAO = 8;
const CACHE_DIAS = 30;
const PREFIXOS = ['200', '300', '400', '500', '700', '800', '1010'];

const modeloBusca = () => process.env.OPENAI_MODELO_BUSCA || process.env.OPENAI_MODELO || 'gpt-4o-mini';

// Passo 1: pesquisa. Devolve { texto, fontes: [{ url, titulo }] }.
export async function pesquisarNaWeb(nome, { chave = process.env.OPENAI_API_KEY, buscar = fetch, timeoutMs = 45000 } = {}) {
  if (!chave) throw new Error('OPENAI_API_KEY não configurada.');
  const r = await buscar('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: modeloBusca(),
      tools: [{ type: 'web_search', search_context_size: 'low', user_location: { type: 'approximate', country: 'BR', timezone: 'America/Sao_Paulo' } }],
      tool_choice: 'required',
      max_tool_calls: 2,
      input: `Identifique o produto comercial que este texto de nota fiscal descreve e liste marca, modelo, tipo de produto e características confirmadas nas fontes. Se não tiver certeza de qual produto é, escreva NAO_IDENTIFICADO. Não invente nada que as fontes não digam.\n\nTexto: "${String(nome).slice(0, 200)}"`,
    }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI (pesquisa) respondeu ${r.status}: ${dados.error?.message ?? 'erro'}`.slice(0, 220));
  const mensagem = (dados.output || []).find((o) => o.type === 'message');
  const partes = mensagem?.content || [];
  const texto = partes.map((p) => p.text ?? '').join('\n').trim();
  const fontes = [];
  for (const p of partes) for (const a of p.annotations || []) if (a.type === 'url_citation' && a.url && !fontes.some((f) => f.url === a.url)) fontes.push({ url: a.url, titulo: String(a.title ?? '').slice(0, 120) });
  return { texto, fontes: fontes.slice(0, 5) };
}

// Passo 2: organiza o que a pesquisa achou, no estilo do catálogo. Só pode usar fatos do texto da pesquisa.
export async function organizarSugestao({ nomeOriginal, pesquisa, estilo, prefixoPedido }, { chave = process.env.OPENAI_API_KEY, buscar = fetch, timeoutMs = 30000 } = {}) {
  if (!chave) throw new Error('OPENAI_API_KEY não configurada.');
  const r = await buscar('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: modeloBusca(),
      temperature: 0,
      messages: [
        { role: 'system', content: `Você padroniza nomes de produto para o catálogo de uma fábrica/loja de biscoitos. Use SOMENTE fatos presentes no "resultado da pesquisa"; nunca invente marca, modelo, medida ou especificação. Se a pesquisa for vaga ou disser NAO_IDENTIFICADO, devolva identificado=false e nome_sugerido vazio. O nome sugerido segue o estilo do catálogo: ${estilo.geral.join(' ')} ${(estilo.porFamilia[prefixoPedido]?.regras || []).join(' ')} Exemplos reais de nomes desta família: ${(estilo.porFamilia[prefixoPedido]?.exemplos || []).join(' | ')}. confianca: "alta" só se marca e modelo forem confirmados; ncm_provavel só se a pesquisa citar o NCM, senão vazio.` },
        { role: 'user', content: JSON.stringify({ nome_na_nota: nomeOriginal, resultado_da_pesquisa: String(pesquisa.texto).slice(0, 4000) }) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'nome_limpo', strict: true,
          schema: {
            type: 'object', additionalProperties: false,
            required: ['identificado', 'nome_sugerido', 'marca', 'modelo', 'familia_sugerida', 'confianca', 'resumo', 'ncm_provavel'],
            properties: {
              identificado: { type: 'boolean' }, nome_sugerido: { type: 'string' }, marca: { type: 'string' }, modelo: { type: 'string' },
              familia_sugerida: { type: 'string', enum: PREFIXOS }, confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
              resumo: { type: 'string' }, ncm_provavel: { type: 'string' },
            },
          },
        },
      },
    }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OpenAI respondeu ${r.status}: ${dados.error?.message ?? 'erro'}`.slice(0, 220));
  return JSON.parse(dados.choices?.[0]?.message?.content ?? '{}');
}

// Junta tudo e aplica as travas: sem fonte ou com confiança baixa = não identificado.
export function consolidar(nomeOriginal, pesquisa, parecer) {
  const base = { nome_original: nomeOriginal, fontes: pesquisa.fontes, aviso: 'Sugerido por IA com pesquisa na web. Confira antes de aceitar.' };
  const identificado = parecer.identificado === true && parecer.confianca !== 'baixa' && pesquisa.fontes.length > 0 && !!String(parecer.nome_sugerido ?? '').trim() && !/NAO_IDENTIFICADO/i.test(pesquisa.texto.slice(0, 80));
  if (!identificado) {
    return { ...base, estado: 'nao_identificado', motivo: pesquisa.fontes.length === 0 ? 'A pesquisa não trouxe fontes confiáveis.' : 'A IA não teve confiança suficiente para identificar o produto. Trate manualmente.' };
  }
  const ncm = String(parecer.ncm_provavel ?? '').replace(/\D/g, '');
  return {
    ...base, estado: 'sugerido', nome_sugerido: limparNomeSugerido(parecer.nome_sugerido), marca: parecer.marca || null, modelo: parecer.modelo || null,
    familia_sugerida: parecer.familia_sugerida, confianca: parecer.confianca, resumo: String(parecer.resumo ?? '').slice(0, 300),
    ncm_sugerido: ncm.length === 8 ? ncm : null, // só sugestão com fonte: nunca preenche o NCM sozinha
  };
}

const hojeChave = () => `busca_web_${new Date().toISOString().slice(0, 10)}`;

// Sugere o nome limpo de UM item (cache de 30 dias por nome; respeita o limite diário de pesquisas).
export async function sugerirNome(sql, nomeOriginal, prefixoPedido, { estilo, pesquisar = pesquisarNaWeb, organizar = organizarSugestao, limiteDia = LIMITE_BUSCAS_POR_DIA, contador = hojeChave() } = {}) {
  const chave = crypto.createHash('sha256').update(chaveCanonica(nomeOriginal) + '|' + prefixoPedido).digest('hex').slice(0, 32);
  const [guardado] = await sql`SELECT resultado FROM nomes_ia_cache WHERE chave = ${chave} AND criado_em > now() - ${CACHE_DIAS + ' days'}::interval`;
  if (guardado) return { ...guardado.resultado, do_cache: true };
  const usadas = (await lerEstado(sql, contador))?.n ?? 0;
  if (usadas >= limiteDia) throw new Error(`Limite diário de pesquisas na web atingido (${limiteDia}). Tente amanhã ou trate manualmente.`);
  await gravarEstado(sql, contador, { n: usadas + 1 });
  const pesquisa = await pesquisar(nomeOriginal);
  const parecer = await organizar({ nomeOriginal, pesquisa, estilo, prefixoPedido });
  const resultado = { ...consolidar(nomeOriginal, pesquisa, parecer), em: new Date().toISOString() };
  await sql`INSERT INTO nomes_ia_cache (chave, resultado) VALUES (${chave}, ${JSON.stringify(resultado)}::jsonb)
    ON CONFLICT (chave) DO UPDATE SET resultado = EXCLUDED.resultado, criado_em = now()`;
  return resultado;
}

// Estilo do catálogo (a partir dos nomes ativos do Omie), em cache de uma hora na memória.
let estiloEmCache = null;
export async function estiloDoCatalogo(sql = sqlPadrao) {
  if (estiloEmCache && Date.now() - estiloEmCache.em < 3600000) return estiloEmCache.valor;
  const produtos = await sql`SELECT codigo, descricao FROM omie_produtos WHERE inativo = false AND length(descricao) > 0`;
  estiloEmCache = { em: Date.now(), valor: descobrirPadraoDeNomes(produtos) };
  return estiloEmCache.valor;
}

// Para todos os itens incluídos da solicitação (até o limite). Grava o resultado em cada item (nome_ia).
export async function sugerirNomesDaSolicitacao(sql, usuario, id, opcoes = {}) {
  const [s] = await sql`SELECT status, rota, prefixo_codigo, familia_prefixo FROM solicitacoes WHERE id = ${id}`;
  if (!s) throw new Error('Solicitação não encontrada.');
  if (!['aguardando_analise', 'recebida'].includes(s.status)) throw new Error('Esta solicitação já foi decidida.');
  const prefixo = s.prefixo_codigo || s.familia_prefixo;
  const itens = await sql`SELECT id, descricao, nome_original, nome_ia FROM solicitacao_itens WHERE solicitacao_id = ${id} AND incluido ORDER BY ordem LIMIT ${LIMITE_ITENS_POR_SOLICITACAO}`;
  const estilo = opcoes.estilo ?? (await estiloDoCatalogo(sql));
  const resumo = { total: itens.length, sugeridos: 0, naoIdentificados: 0, erros: [] };
  for (const i of itens) {
    try {
      const base = i.nome_original || i.descricao;
      const r = await sugerirNome(sql, base, prefixo, { ...opcoes, estilo });
      await sql`UPDATE solicitacao_itens SET nome_ia = ${JSON.stringify(r)}::jsonb WHERE id = ${i.id}`;
      if (r.estado === 'sugerido') resumo.sugeridos++; else resumo.naoIdentificados++;
    } catch (erro) {
      resumo.erros.push(`${i.descricao}: ${String(erro.message).slice(0, 160)}`);
      if (/Limite diário/.test(erro.message)) break;
    }
  }
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, ${usuario.email}, 'ia-sugeriu-nomes', ${JSON.stringify(resumo)}::jsonb)`;
  return resumo;
}
