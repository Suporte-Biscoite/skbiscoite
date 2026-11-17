// api/_lib/nota.js — lê a nota fiscal (PDF) anexada na tarefa do ClickUp e SUGERE o NCM de cada produto.
// Ordem: 1) texto do PDF + leitura direta das linhas (sem IA);  2) o que não ligar com segurança vai para a IA (OpenAI),
// e a resposta dela só vale se o NCM existir no texto da nota;  3) a pessoa confere e aprova: nada é criado por aqui.
import { extractText, getDocumentProxy } from 'unpdf';
import { sql as sqlPadrao } from './db.js';
import { baixarArquivo, buscarTarefa } from './clickup.js';
import { lerItensDaNota, ligarProdutosAosItensDaNota, trechoDosProdutos, validarRespostaDaIA } from '../../src/lib/nota.js';

const MAX_PDFS = 3;
const MAX_BYTES = 8 * 1024 * 1024;

export async function textoDoPdf(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text ?? '');
}

// Pergunta à IA o NCM dos produtos que a leitura direta não ligou. Devolve [{ produto, ncm }] (sem validar).
export async function perguntarIA(produtos, trecho, { chave = process.env.OPENAI_API_KEY, modelo = process.env.OPENAI_MODELO || 'gpt-4o-mini', buscar = fetch } = {}) {
  if (!chave) throw new Error('OPENAI_API_KEY não configurada.');
  const resposta = await buscar('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      model: modelo,
      temperature: 0,
      messages: [
        { role: 'system', content: 'Você lê o quadro de produtos de uma nota fiscal brasileira (DANFE). Para cada produto pedido, devolva o NCM (8 dígitos) da linha da nota que for esse produto. Copie o NCM exatamente como está na nota. Se não tiver certeza ou o produto não estiver na nota, devolva null. Nunca invente.' },
        { role: 'user', content: JSON.stringify({ produtos_pedidos: produtos, quadro_de_produtos_da_nota: trecho }) },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ncms', strict: true,
          schema: { type: 'object', additionalProperties: false, required: ['itens'], properties: { itens: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['produto', 'ncm'], properties: { produto: { type: 'string' }, ncm: { type: ['string', 'null'] } } } } } },
        },
      },
    }),
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(`OpenAI respondeu ${resposta.status}: ${dados.error?.message ?? 'erro'}`.slice(0, 200));
  return JSON.parse(dados.choices?.[0]?.message?.content ?? '{"itens":[]}').itens ?? [];
}

const ESTADOS = ['recebida', 'aguardando_analise'];

export async function lerNotaDaSolicitacao(sql = sqlPadrao, usuario, id, { buscarDaTarefa = buscarTarefa, baixar = baixarArquivo, ia = perguntarIA, lerPdf = textoDoPdf } = {}) {
  const [s] = await sql`SELECT id, clickup_task_id, status, lote_id FROM solicitacoes WHERE id = ${id}`;
  if (!s) throw new Error('Solicitação não encontrada.');
  if (!(ESTADOS.includes(s.status) || (s.status === 'aprovada' && !s.lote_id))) throw new Error('Esta solicitação já foi para a fila: não dá mais para mudar o NCM.');
  const itens = await sql`SELECT id, descricao FROM solicitacao_itens WHERE solicitacao_id = ${id} AND incluido ORDER BY ordem`;
  if (!itens.length) throw new Error('Não há produtos nesta solicitação.');

  const tarefa = await buscarDaTarefa(s.clickup_task_id);
  const pdfs = (tarefa.attachments || []).filter((a) => /pdf/i.test(`${a.extension ?? ''} ${a.mimetype ?? ''} ${a.title ?? ''}`)).slice(0, MAX_PDFS);
  if (!pdfs.length) throw new Error('A tarefa não tem nota em PDF anexada.');

  const info = { arquivos: pdfs.map((p) => p.title), itensNota: [], erroIA: null };
  let trechos = '';
  for (const pdf of pdfs) {
    const buffer = await baixar(pdf.url, MAX_BYTES);
    const texto = await lerPdf(buffer);
    const lidos = lerItensDaNota(texto);
    if (!lidos.length && !texto.trim()) throw new Error(`O PDF ${pdf.title} não tem texto (parece uma imagem escaneada). Informe o NCM manualmente.`);
    info.itensNota.push(...lidos.map((i) => ({ ...i, arquivo: pdf.title })));
    trechos += `${trechoDosProdutos(texto)}\n`;
  }

  const ligados = ligarProdutosAosItensDaNota(itens.map((i) => i.descricao), info.itensNota);
  const sugestoes = ligados.map((l) => (l.ncm ? { ncm: l.ncm, fonte: `Nota, linha ${l.linha}: ${l.linhaDaNota}`.slice(0, 200) } : { ncm: null, fonte: l.motivo }));

  // O que a leitura direta não resolveu vai para a IA (se houver chave); a resposta é validada contra o texto da nota.
  const faltando = sugestoes.map((x, k) => (x.ncm ? -1 : k)).filter((k) => k >= 0);
  if (faltando.length && process.env.OPENAI_API_KEY) {
    try {
      const respostas = await ia(faltando.map((k) => itens[k].descricao), trechos);
      for (const k of faltando) {
        const r = respostas.find((x) => String(x.produto).trim().toUpperCase() === itens[k].descricao.trim().toUpperCase());
        const ncm = validarRespostaDaIA(r, trechos);
        if (ncm) sugestoes[k] = { ncm, fonte: 'Sugerido pela IA a partir da nota: confira.' };
      }
    } catch (erro) {
      info.erroIA = String(erro.message).slice(0, 200);
    }
  }

  for (const [k, item] of itens.entries()) {
    await sql`UPDATE solicitacao_itens SET ncm_sugerido = ${sugestoes[k].ncm}, ncm_fonte = ${sugestoes[k].fonte} WHERE id = ${item.id}`;
  }
  await sql`UPDATE solicitacoes SET nota_info = ${JSON.stringify(info)}::jsonb, atualizado_em = now() WHERE id = ${id}`;
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${id}, ${usuario.email}, 'leu-nota', ${JSON.stringify({ arquivos: info.arquivos, achados: sugestoes.filter((x) => x.ncm).length, de: itens.length, erroIA: info.erroIA })}::jsonb)`;
  return { achados: sugestoes.filter((x) => x.ncm).length, total: itens.length, erroIA: info.erroIA };
}
