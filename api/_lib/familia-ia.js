// api/_lib/familia-ia.js — a IA confere se cada produto pedido combina com a FAMÍLIA escolhida no formulário.
// Ex.: "GAVETEIRO" pedido como SUPRIMENTOS (700) é móvel/equipamento = ATIVO (800). A IA só ALERTA e sugere; quem decide é a pessoa.
import { sql as sqlPadrao } from './db.js';

const PREFIXOS = ['200', '300', '400', '500', '700', '800', '1010'];
const NOMES = { 200: 'EMBALAGEM', 300: 'EXTERNO (revenda)', 400: 'INTERNO (produção própria)', 500: 'KITS/CESTAS', 700: 'SUPRIMENTOS', 800: 'ATIVO', 1010: 'ENVASE E MATÉRIA-PRIMA' };
// Comida pronta de produção própria x revenda não se distingue só pelo nome: 300 e 400 contam como a mesma "área".
const AREA = (p) => (['300', '400'].includes(String(p)) ? '300/400' : String(p));
export const nomeDaFamilia = (p) => `${NOMES[p] ?? p} (${p})`;

const REGRAS = `Famílias de produto de uma fábrica/loja de biscoitos:
200 EMBALAGEM: caixas, sacos, fitas, etiquetas, potes e embalagens do produto.
300 EXTERNO: produto pronto comprado de terceiros para revenda.
400 INTERNO: produto pronto de produção própria (biscoitos, bolos, ganaches, kits de venda).
500 KITS/CESTAS.
700 SUPRIMENTOS: itens de consumo e uso geral: papel higiênico, material de limpeza, produtos de limpeza, material de escritório, copos, descartáveis, EPI, uniformes.
800 ATIVO: bens duráveis: móveis, armários, gaveteiros, prateleiras, organizadores, equipamentos, máquinas, utensílios duráveis, eletrodomésticos, ferramentas.
1010 ENVASE E MATÉRIA-PRIMA: ingredientes e insumos usados na produção ou no envase.
Para cada produto, diga a família MAIS PROVÁVEL pelo que o produto é. confianca: "alta" só quando é claro.`;

// Pergunta à IA. Devolve [{ descricao, prefixo, confianca, motivo }] na mesma ordem.
export async function perguntarFamiliaIA(titulo, familiaEscolhida, descricoes, { chave = process.env.OPENAI_API_KEY, modelo = process.env.OPENAI_MODELO || 'gpt-4o-mini', buscar = fetch, timeoutMs = 20000 } = {}) {
  if (!chave) throw new Error('OPENAI_API_KEY não configurada.');
  const resposta = await buscar('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model: modelo,
      temperature: 0,
      messages: [
        { role: 'system', content: REGRAS },
        { role: 'user', content: JSON.stringify({ titulo_do_pedido: titulo, familia_escolhida_no_formulario: familiaEscolhida, produtos: descricoes }) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'familias', strict: true,
          schema: {
            type: 'object', additionalProperties: false, required: ['itens'],
            properties: { itens: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['indice', 'prefixo', 'confianca', 'motivo'], properties: { indice: { type: 'integer' }, prefixo: { type: 'string', enum: PREFIXOS }, confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] }, motivo: { type: 'string' } } } } },
          },
        },
      },
    }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(`OpenAI respondeu ${resposta.status}: ${dados.error?.message ?? 'erro'}`.slice(0, 200));
  const lista = JSON.parse(dados.choices?.[0]?.message?.content ?? '{}').itens ?? [];
  return descricoes.map((descricao, k) => {
    const r = lista.find((x) => x.indice === k);
    return r ? { descricao, prefixo: r.prefixo, confianca: r.confianca, motivo: String(r.motivo ?? '').slice(0, 200) } : null;
  });
}

// Quais itens divergem da família escolhida (só com confiança alta ou média).
export function acharDivergencias(prefixoEscolhido, pareceres) {
  if (!prefixoEscolhido) return [];
  return pareceres.filter((p) => p && p.confianca !== 'baixa' && AREA(p.prefixo) !== AREA(prefixoEscolhido));
}

// Confere a solicitação: grava o parecer, avisa nos itens e nos motivos e manda para análise se houver divergência.
// Seguro para repetir: os avisos da IA anteriores são trocados pelos novos.
export async function conferirFamilia(sql = sqlPadrao, id, { ia = perguntarFamiliaIA } = {}) {
  const [s] = await sql`SELECT id, titulo, status, rota, familia_campo, prefixo_codigo, familia_prefixo, motivos FROM solicitacoes WHERE id = ${id}`;
  if (!s) throw new Error('Solicitação não encontrada.');
  if (s.rota === 'alteracao') return { conferida: false, motivo: 'Pedido de alteração: não há família a conferir.' };
  const itens = await sql`SELECT id, descricao, avisos FROM solicitacao_itens WHERE solicitacao_id = ${id} AND incluido ORDER BY ordem`;
  if (itens.length === 0) return { conferida: false, motivo: 'Sem produtos.' };
  const prefixo = s.prefixo_codigo || s.familia_prefixo;
  const pareceres = await ia(s.titulo, s.familia_campo, itens.map((i) => i.descricao));
  const diverge = acharDivergencias(prefixo, pareceres);

  const ehAvisoIA = (t) => typeof t === 'string' && t.startsWith('IA: ');
  for (const [k, i] of itens.entries()) {
    const p = pareceres[k];
    const novos = (i.avisos || []).filter((a) => !ehAvisoIA(a));
    if (p && diverge.includes(p)) novos.push(`IA: parece ${nomeDaFamilia(p.prefixo)}, não ${nomeDaFamilia(prefixo)}. ${p.motivo}`.trim());
    await sql`UPDATE solicitacao_itens SET avisos = ${JSON.stringify(novos)}::jsonb WHERE id = ${i.id}`;
  }
  const motivos = (s.motivos || []).filter((m) => !ehAvisoIA(m));
  if (diverge.length) motivos.push(`IA: ${diverge.length === 1 ? 'um produto parece' : `${diverge.length} produtos parecem`} de outra família (${[...new Set(diverge.map((d) => nomeDaFamilia(d.prefixo)))].join(', ')}), e o pedido veio como ${nomeDaFamilia(prefixo)}. Confira antes de aprovar.`);
  const parecer = { em: new Date().toISOString(), familia_pedida: prefixo, itens: pareceres.filter(Boolean).map((p) => ({ ...p, diverge: diverge.includes(p) })) };
  await sql`UPDATE solicitacoes SET ia_familia = ${JSON.stringify(parecer)}::jsonb, motivos = ${JSON.stringify(motivos)}::jsonb, sugestao = ${motivos.length ? 'analise' : 'automatica'}, atualizado_em = now() WHERE id = ${id}`;
  return { conferida: true, divergencias: diverge.length, parecer };
}
