// api/_lib/correcao.js — "Corrigir cadastro antigo": produto cadastrado no Omie com código fora do padrão (ex.: 10360).
// Renomeia para "CADASTRO ERRADO - <nome> (INATIVO)" e inativa. NUNCA é automático: propõe (só leitura), mostra antes/depois,
// bloqueia se houver estoque/reserva/pendência e só roda depois da aprovação de uma pessoa, com registro para desfazer.
//
// Limites honestos (docs do Omie): o Omie não filtra pedidos, notas e movimentações por produto. Por isso "pedidos/notas" e "movimentações"
// ficam como NÃO VERIFICADO e quem aprova precisa confirmar que conferiu no Omie. O saldo/reserva/pendente vêm de PosicaoEstoque.
// Todo o caminho de ESCRITA só funciona com OMIE_CORRECAO_ATIVA=1 (desligado por padrão) e deve ser testado primeiro num produto de teste.
import { sql as sqlPadrao } from './db.js';
import { alterarProdutoOmie, alterarSituacaoProdutoOmie, consultarProdutoOmie, posicaoEstoqueOmie } from './omie.js';
import { buscarSkuNexaas } from './nexaas.js';
import { salvarProdutos } from './catalogo.js';
import { situacaoDoCodigo } from '../../src/lib/solicitacoes.js';
import { avaliarSeguranca, camposDaCorrecao, camposParaDesfazer, PREFIXO_ERRADO } from '../../src/lib/correcao.js';

export const correcaoAtiva = () => process.env.OMIE_CORRECAO_ATIVA === '1';

// Campos do cadastro que acompanham a alteração (o Omie não documenta se omitir zera; então reenviamos o que já estava lá).
const MANTER = ['codigo_produto', 'codigo', 'unidade', 'ncm', 'valor_unitario', 'codigo_familia', 'tipoItem'];
const corpoDeAlteracao = (atual, mudar) => ({ ...Object.fromEntries(MANTER.filter((k) => atual[k] !== undefined && atual[k] !== null).map((k) => [k, atual[k]])), ...mudar });

const hoje = () => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());

async function log(sql, solicitacaoId, usuario, acao, detalhe) {
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${solicitacaoId ?? null}, ${usuario}, ${acao}, ${JSON.stringify(detalhe)}::jsonb)`;
}

// Códigos fora da faixa das famílias, ativos no Omie (podem incluir cadastros legítimos: serve de ponto de partida para olhar).
export const listarSuspeitos = (sql = sqlPadrao, { busca = '' } = {}) => sql`
  SELECT codigo, descricao FROM omie_produtos
  WHERE inativo = false AND descricao NOT LIKE ${PREFIXO_ERRADO + '%'}
    AND NOT (codigo ~ '^[0-9]{7}$' AND (codigo LIKE '200%' OR codigo LIKE '300%' OR codigo LIKE '400%' OR codigo LIKE '500%' OR codigo LIKE '700%' OR codigo LIKE '800%' OR codigo LIKE '1010%'))
    AND (${busca} = '' OR descricao ILIKE ${'%' + busca + '%'} OR codigo LIKE ${busca + '%'})
  ORDER BY codigo LIMIT 60`;

export const listarCorrecoes = (sql = sqlPadrao) => sql`
  SELECT id, codigo, solicitacao_id, estado, antes, depois, verificacoes, bloqueios, nao_verificado, nexaas, criado_por, criado_em, aprovado_por, aprovado_em, aplicado_em, desfeito_por, desfeito_em, erro
  FROM correcoes_cadastro ORDER BY id DESC LIMIT 50`;

// Só LEITURA no Omie e no Nexaas. Grava a proposta (com o estado anterior completo) e devolve para a tela mostrar.
export async function proporCorrecao(sql, usuario, codigo, { solicitacaoId = null, consultar = consultarProdutoOmie, estoque = posicaoEstoqueOmie, nexaas = buscarSkuNexaas } = {}) {
  codigo = String(codigo ?? '').trim();
  if (!codigo) throw new Error('Informe o código do cadastro antigo.');
  if (situacaoDoCodigo(codigo, null) !== 'fora_da_faixa') throw new Error(`O código ${codigo} segue o padrão de uma família: não é um cadastro fora da faixa.`);
  const [aberta] = await sql`SELECT id FROM correcoes_cadastro WHERE codigo = ${codigo} AND estado IN ('proposta', 'aplicando', 'aplicada', 'erro') ORDER BY id DESC LIMIT 1`;
  if (aberta) throw new Error(`Já existe uma correção (#${aberta.id}) para o código ${codigo}. Veja a lista de correções.`);

  const antes = await consultar({ codigo });
  if (!antes?.codigo_produto) throw new Error(`O Omie não devolveu o produto ${codigo}.`);
  if (String(antes.descricao ?? '').startsWith(PREFIXO_ERRADO)) throw new Error('Este cadastro já está marcado como errado.');
  if (antes.inativo === 'S') throw new Error('Este cadastro já está inativo.');

  const verificacoes = { estoque: null, movimentos: null, pedidos: null };
  try {
    const p = await estoque({ id_prod: Number(antes.codigo_produto), data: hoje() });
    verificacoes.estoque = { saldo: Number(p.saldo ?? p.nSaldo ?? 0), reservado: Number(p.reservado ?? 0), pendentes: Number(p.pendente ?? p.nPendente ?? 0) };
  } catch (erro) { verificacoes.erroEstoque = String(erro.message).slice(0, 200); }
  const lado = await nexaas(codigo).then((s) => ({ existe: !!s, id: s?.product_id ?? null, nome: s?.name ?? null })).catch((erro) => ({ existe: null, erro: String(erro.message).slice(0, 160) }));
  const seguranca = avaliarSeguranca(verificacoes);
  const depois = camposDaCorrecao(antes);
  const estado = seguranca.podeAplicar ? 'proposta' : 'bloqueada';
  const [linha] = await sql`INSERT INTO correcoes_cadastro (codigo, codigo_produto, solicitacao_id, estado, antes, depois, verificacoes, bloqueios, nao_verificado, nexaas, criado_por)
    VALUES (${codigo}, ${Number(antes.codigo_produto)}, ${solicitacaoId}, ${estado}, ${JSON.stringify(antes)}::jsonb, ${JSON.stringify(depois)}::jsonb, ${JSON.stringify(verificacoes)}::jsonb,
      ${JSON.stringify(seguranca.bloqueios)}::jsonb, ${JSON.stringify(seguranca.naoVerificado)}::jsonb, ${JSON.stringify(lado)}::jsonb, ${usuario.email}) RETURNING *`;
  await log(sql, solicitacaoId, usuario.email, 'correcao-proposta', { correcao: linha.id, codigo, estado });
  return { ...linha, correcaoAtiva: correcaoAtiva() };
}

// Aprovação de uma pessoa. Cada passo no Omie roda uma vez só (os já feitos ficam marcados), então repetir após erro é seguro.
export async function aplicarCorrecao(sql, usuario, id, { confirmouConferencia = false, consultar = consultarProdutoOmie, alterar = alterarProdutoOmie, situacao = alterarSituacaoProdutoOmie } = {}) {
  if (!correcaoAtiva()) throw new Error('A correção de cadastros no Omie está desligada (OMIE_CORRECAO_ATIVA). Ligue só depois de testar com um produto de teste.');
  const [c] = await sql`SELECT * FROM correcoes_cadastro WHERE id = ${id}`;
  if (!c) throw new Error('Correção não encontrada.');
  if (c.estado === 'aplicada') return c;
  if (!['proposta', 'erro'].includes(c.estado)) throw new Error(`Esta correção está "${c.estado}" e não pode ser aplicada.`);
  if ((c.bloqueios || []).length) throw new Error(`Bloqueada: ${c.bloqueios.join(' ')}`);
  if ((c.nao_verificado || []).length && !confirmouConferencia) throw new Error(`Confirme que conferiu no Omie (${c.nao_verificado.join(', ')}) antes de aplicar.`);

  const [trava] = await sql`UPDATE correcoes_cadastro SET estado = 'aplicando', aprovado_por = COALESCE(aprovado_por, ${usuario.email}), aprovado_em = COALESCE(aprovado_em, now()), erro = NULL WHERE id = ${id} AND estado IN ('proposta', 'erro') RETURNING passos`;
  if (!trava) throw new Error('Esta correção já está em andamento.');
  const passos = { ...(trava.passos || {}) };
  try {
    // Antes de mexer, confere se o cadastro continua como estava na prévia.
    if (!passos.renomeado) {
      const agora = await consultar({ codigo_produto: Number(c.codigo_produto) });
      if (agora.descricao !== c.antes.descricao || (agora.inativo === 'S') !== (c.antes.inativo === 'S')) throw new Error('O cadastro mudou no Omie depois da prévia. Gere uma nova proposta.');
      await alterar(corpoDeAlteracao(c.antes, { descricao: c.depois.descricao }));
      passos.renomeado = true;
      await sql`UPDATE correcoes_cadastro SET passos = ${JSON.stringify(passos)}::jsonb WHERE id = ${id}`;
    }
    if (!passos.inativado) {
      await situacao({ codigo_produto: Number(c.codigo_produto), inativo: 'S' });
      passos.inativado = true;
      await sql`UPDATE correcoes_cadastro SET passos = ${JSON.stringify(passos)}::jsonb WHERE id = ${id}`;
    }
  } catch (erro) {
    await sql`UPDATE correcoes_cadastro SET estado = 'erro', erro = ${String(erro.message).slice(0, 300)} WHERE id = ${id}`;
    await log(sql, c.solicitacao_id, usuario.email, 'correcao-falhou', { correcao: id, passos, erro: String(erro.message).slice(0, 200) });
    throw erro;
  }
  await salvarProdutos(sql, [{ codigo: c.codigo, descricao: c.depois.descricao, codigo_produto: c.codigo_produto, inativo: true }]);
  const [feita] = await sql`UPDATE correcoes_cadastro SET estado = 'aplicada', aplicado_em = now() WHERE id = ${id} RETURNING *`;
  await log(sql, c.solicitacao_id, usuario.email, 'correcao-aplicada', { correcao: id, codigo: c.codigo, de: c.antes.descricao, para: c.depois.descricao });
  return feita;
}

// Desfazer: devolve o nome e a situação de antes (do registro completo guardado na proposta).
export async function desfazerCorrecao(sql, usuario, id, { alterar = alterarProdutoOmie, situacao = alterarSituacaoProdutoOmie } = {}) {
  if (!correcaoAtiva()) throw new Error('A correção de cadastros no Omie está desligada (OMIE_CORRECAO_ATIVA).');
  const [c] = await sql`SELECT * FROM correcoes_cadastro WHERE id = ${id}`;
  if (!c) throw new Error('Correção não encontrada.');
  if (c.estado !== 'aplicada') throw new Error('Só dá para desfazer uma correção já aplicada.');
  const volta = camposParaDesfazer(c.antes);
  await alterar(corpoDeAlteracao(c.antes, { descricao: volta.descricao }));
  await situacao({ codigo_produto: Number(c.codigo_produto), inativo: volta.inativo });
  await salvarProdutos(sql, [{ codigo: c.codigo, descricao: volta.descricao, codigo_produto: c.codigo_produto, inativo: volta.inativo === 'S' }]);
  const [feita] = await sql`UPDATE correcoes_cadastro SET estado = 'desfeita', desfeito_por = ${usuario.email}, desfeito_em = now() WHERE id = ${id} AND estado = 'aplicada' RETURNING *`;
  await log(sql, c.solicitacao_id, usuario.email, 'correcao-desfeita', { correcao: id, codigo: c.codigo });
  return feita;
}
