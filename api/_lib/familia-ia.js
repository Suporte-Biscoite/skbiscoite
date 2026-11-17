// api/_lib/familia-ia.js — a IA confere se cada produto pedido combina com a FAMÍLIA escolhida no formulário.
// Ex.: "GAVETEIRO" pedido como SUPRIMENTOS (700) é móvel/equipamento = ATIVO (800). A IA só ALERTA e sugere; quem decide é a pessoa.
import crypto from 'node:crypto';
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
700 SUPRIMENTOS: SOMENTE itens de consumo e uso geral que NÃO são comida nem ingrediente: papel higiênico, produtos de limpeza, panos, material de escritório, copos, descartáveis, EPI, uniformes. Alimento, ingrediente, cobertura, recheio, massa, chocolate, cacau, mescla, ganache ou qualquer insumo usado para fazer ou envasar produto NUNCA é 700 (é 1010 ou produto pronto).
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
        { role: 'user', content: JSON.stringify({ titulo_do_pedido: titulo, familia_escolhida_no_formulario: familiaEscolhida, produtos: descricoes.map((nome, indice) => ({ indice, nome })) }) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'familias', strict: true,
          schema: {
            type: 'object', additionalProperties: false, required: ['itens'],
            properties: { itens: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['indice', 'nome', 'prefixo', 'confianca', 'motivo'], properties: { indice: { type: 'integer' }, nome: { type: 'string' }, prefixo: { type: 'string', enum: PREFIXOS }, confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] }, motivo: { type: 'string' } } } } },
          },
        },
      },
    }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(`OpenAI respondeu ${resposta.status}: ${dados.error?.message ?? 'erro'}`.slice(0, 200));
  const lista = JSON.parse(dados.choices?.[0]?.message?.content ?? '{}').itens ?? [];
  return descricoes.map((descricao, k) => {
    // Liga pelo NOME devolvido (a IA às vezes conta a partir de 1); só se o nome não vier usa a posição.
    const chaveNome = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
    const r = lista.find((x) => chaveNome(x.nome) === chaveNome(descricao)) ?? (lista.every((x) => !x.nome) ? lista.find((x) => x.indice === k) : null);
    return r ? { descricao, prefixo: r.prefixo, confianca: r.confianca, motivo: String(r.motivo ?? '').slice(0, 200) } : null;
  });
}

// Quais itens divergem da família escolhida (só com confiança alta ou média).
export function acharDivergencias(prefixoEscolhido, pareceres) {
  if (!prefixoEscolhido) return [];
  return pareceres.filter((p) => p && p.confianca !== 'baixa' && AREA(p.prefixo) !== AREA(prefixoEscolhido));
}

// Um comentário por dúvida: a trava (hash) impede repetir o mesmo, e só um conteúdo novo gera outro comentário.
async function comentarDuvida(sql, id, prefixo, diverge, comentar) {
  const hash = crypto.createHash('sha256').update(JSON.stringify([prefixo, diverge.map((d) => [d.descricao, d.prefixo]).sort()])).digest('hex').slice(0, 24);
  const [anterior] = await sql`SELECT ia_comentado_hash FROM solicitacoes WHERE id = ${id}`;
  const trava = await sql`UPDATE solicitacoes SET ia_comentado_hash = ${hash} WHERE id = ${id} AND ia_comentado_hash IS DISTINCT FROM ${hash} RETURNING id`;
  if (!trava.length) return { enviado: false, motivo: 'Esta dúvida já foi comentada.' };
  const registrar = (acao, detalhe) => sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, 'sistema', ${acao}, ${JSON.stringify(detalhe)}::jsonb)`;
  try {
    const r = await comentar(sql, id, textoDaDuvida(id, prefixo, diverge));
    if (!r.enviado) { await sql`UPDATE solicitacoes SET ia_comentado_hash = ${anterior?.ia_comentado_hash ?? null} WHERE id = ${id}`; return r; }
    await registrar('ia-comentou-duvida', { itens: diverge.map((d) => d.descricao) });
    return { enviado: true };
  } catch (erro) {
    await sql`UPDATE solicitacoes SET ia_comentado_hash = ${anterior?.ia_comentado_hash ?? null} WHERE id = ${id}`;
    await registrar('ia-comentario-falhou', { erro: String(erro.message).slice(0, 200) });
    return { enviado: false, motivo: String(erro.message).slice(0, 200) };
  }
}

// Confere a solicitação: grava o parecer, avisa nos itens e nos motivos e manda para análise se houver divergência.
// Seguro para repetir: os avisos da IA anteriores são trocados pelos novos.
// Texto da dúvida que a IA deixa na tarefa do ClickUp (em forma de pergunta; quem decide é a equipe).
export function textoDaDuvida(id, prefixoPedido, divergentes) {
  const linhas = divergentes.map((d) => `• ${d.descricao}: parece ser ${nomeDaFamilia(d.prefixo)}.${d.motivo ? ' ' + d.motivo : ''}`);
  const explicacao = {
    700: 'Suprimentos (700) são itens de consumo e uso geral, como papel, produtos de limpeza e pano. Alimentos e insumos de produção ficam em matéria-prima/envase (1010) ou produto pronto; móveis e equipamentos são ativos (800).',
    800: 'Ativos (800) são bens duráveis, como móveis e equipamentos. Itens de consumo e limpeza são suprimentos (700).',
  }[String(prefixoPedido)] ?? 'Confira se a família escolhida no formulário é a certa para estes produtos.';
  return `Dúvida sobre a família deste pedido (solicitação #${id} · IA do SKBiscoitê):\n\n${linhas.join('\n')}\n\nO pedido veio como ${nomeDaFamilia(prefixoPedido)}. ${explicacao}\n\nÉ isso mesmo ou o pedido deve ir para outra família? Pode responder aqui na tarefa. A equipe de TI confere antes de criar qualquer código.`;
}

// Confere a solicitação: grava o parecer, avisa nos itens e nos motivos e manda para análise se houver divergência.
// `comentar(sql, id, texto)` (opcional) deixa a dúvida na tarefa do ClickUp; devolve { enviado, motivo }.
export async function conferirFamilia(sql = sqlPadrao, id, { ia = perguntarFamiliaIA, comentar = null } = {}) {
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
  let comentario = null;
  if (diverge.length && comentar) comentario = await comentarDuvida(sql, id, prefixo, diverge, comentar);
  return { conferida: true, divergencias: diverge.length, parecer, comentario };
}
