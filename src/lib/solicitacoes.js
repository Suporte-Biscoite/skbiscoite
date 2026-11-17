// Regras puras (sem rede, sem banco) para ler uma tarefa do ClickUp e decidir o que fazer com ela.
// Usadas no servidor (webhook / conferência) e testadas com tarefas reais anonimizadas.
import { FAMILIAS, normalizarTexto } from './familias.js';
import { LIMITE_DESCRICAO, padronizarNome } from './regras.js';

export const CONFIG_PADRAO = Object.freeze({
  modo: 'analisar', // analisar | simulacao (só avalia) | automatico (cria sozinho as pequenas e limpas aprovadas pela IA)
  pausado: false,
  limiteItensAuto: 10,
  limiteAutoPorDia: 20,
  intervaloMinutos: 10,
  espacoEntreItensSeg: 2,
  similaridadeMinima: 0.8,
});

// "Família de Produto" do formulário -> prefixo do código (o formulário não tem KITS/500).
export function prefixoDaFamiliaDoCampo(nome) {
  const t = normalizarTexto(nome);
  if (!t) return null;
  // O formulário traz o código da família entre parênteses: "INTERNO(400)", "ENVASE E MATERIA PRIMA(1010)".
  const entreParenteses = String(nome).match(/\((\d{3,4})\)/)?.[1];
  if (entreParenteses && FAMILIAS.some((x) => x.prefixo === entreParenteses)) return entreParenteses;
  const f = FAMILIAS.find((x) => x.grupo === t || normalizarTexto(x.familia) === t);
  return f ? f.prefixo : null;
}

// "Cód 7000 (mat de escritório)", "(item entra no cód 7000)", "(Cód 7000)" -> faixa de código "7000".
export function lerFaixaDoTitulo(titulo) {
  const m = String(titulo ?? '').match(/c[óo]d(?:igo)?\.?\s*(\d{3,4})\b/i);
  return m ? m[1] : null;
}

// Um código do Omie já escrito no texto ("... igual como está no omie ( 7004083 FORNO ...)").
export function lerCodigosExistentes(texto) {
  return [...new Set([...String(texto ?? '').matchAll(/(?<![\d.,-])(\d{7})(?![\d.,-])/g)].map((m) => m[1]))];
}

const MARCADOR = /^\s*(?:[-*•·▪►>]+|\d{1,3}[.)])\s+/;

// Descrição da tarefa -> uma linha por produto. Regras: uma linha = um produto; tira marcadores e numeração;
// ignora linhas vazias, separadores e cabeçalhos ("Produtos:"); junta espaços; avisa sobre duplicadas.
export function lerLinhasDaDescricao(texto) {
  const itens = [];
  const vistos = new Map();
  const ignoradas = [];
  const linhasBrutas = String(texto ?? '').replace(/\r/g, '').split('\n');
  linhasBrutas.forEach((bruta, i) => {
    let t = bruta.replace(MARCADOR, '').replace(/\s+/g, ' ').trim();
    if (!t || /^[-_=*#.\s]+$/.test(t)) return;
    if (/:$/.test(t)) { ignoradas.push({ linha: i + 1, texto: t, motivo: 'cabeçalho' }); return; }
    t = t.replace(/^#+\s*/, '');
    const avisos = [];
    const chave = normalizarTexto(t);
    if (vistos.has(chave)) { ignoradas.push({ linha: i + 1, texto: t, motivo: `repetida (igual à linha ${vistos.get(chave)})` }); return; }
    vistos.set(chave, i + 1);
    if (t.length < 4 || !/[A-Za-zÀ-ÿ]{2}/.test(t)) avisos.push('Texto curto demais para ser um produto.');
    if (t.length > LIMITE_DESCRICAO) avisos.push(`Mais de ${LIMITE_DESCRICAO} caracteres (limite do Omie).`);
    if (/[;|\t]/.test(bruta) || /\s{3,}/.test(bruta.trim())) avisos.push('Pode haver mais de um produto nesta linha.');
    const codigos = lerCodigosExistentes(t);
    if (codigos.length) avisos.push(`Cita o código ${codigos.join(', ')}: pode ser um produto que já existe.`);
    itens.push({ linha: i + 1, original: bruta.trim(), descricao: padronizarNome(t), avisos, codigoExistente: codigos[0] ?? null });
  });
  return { itens, ignoradas };
}

const tokens = (s) => new Set(normalizarTexto(s).split(/[^A-Z0-9]+/).filter((p) => p.length > 1));

// Prepara o catálogo (lista { codigo, descricao }) para comparar nomes rapidamente.
export const prepararCatalogo = (produtos) => produtos.map((p) => ({ codigo: p.codigo, descricao: p.descricao, norm: normalizarTexto(p.descricao), t: tokens(p.descricao) }));

// Produtos do Omie com nome igual ou muito parecido (Jaccard de palavras). Igual = exato = 1.
export function acharParecidos(descricao, catalogoPreparado, minimo = CONFIG_PADRAO.similaridadeMinima, max = 3) {
  const norm = normalizarTexto(descricao);
  const t = tokens(descricao);
  if (t.size === 0) return [];
  const saida = [];
  for (const p of catalogoPreparado) {
    let sim;
    if (p.norm === norm) sim = 1;
    else {
      if (p.t.size === 0) continue;
      let inter = 0;
      for (const x of t) if (p.t.has(x)) inter++;
      sim = inter / (t.size + p.t.size - inter);
    }
    if (sim >= minimo) saida.push({ codigo: p.codigo, descricao: p.descricao, similaridade: Math.round(sim * 100) / 100 });
  }
  return saida.sort((a, b) => b.similaridade - a.similaridade).slice(0, max);
}

// Lê os campos da tarefa (formato da API do ClickUp). Devolve só o que o sistema usa.
export function lerTarefaClickUp(tarefa) {
  // A API de lista devolve TODOS os campos definidos (inclusive vazios) e pode haver vários com o mesmo nome
  // (ex.: três "Família de Produto"): vale o que tem valor.
  const temValor = (c) => c.value !== undefined && c.value !== null && c.value !== '' && !(Array.isArray(c.value) && c.value.length === 0);
  const campo = (nome) => {
    const iguais = (tarefa.custom_fields || []).filter((c) => normalizarTexto(c.name) === normalizarTexto(nome));
    return iguais.find(temValor);
  };
  const valorDoDropdown = (c) => {
    if (typeof c.value === 'object') return c.value.name ?? '';
    const op = (c.type_config?.options || []).find((o) => o.orderindex === c.value || o.id === c.value);
    return op?.name ?? '';
  };
  const dropdown = (nome) => { const c = campo(nome); return c ? valorDoDropdown(c) : ''; };
  // Cada campo é uma instância com ID próprio (há dois "Família de Produto"): olhamos TODAS as preenchidas.
  const todasPreenchidas = (nome) => (tarefa.custom_fields || [])
    .filter((c) => normalizarTexto(c.name) === normalizarTexto(nome) && temValor(c))
    .map((c) => ({ id: c.id, valor: valorDoDropdown(c) })).filter((x) => x.valor);
  const solicitante = campo('Quem está solicitando')?.value?.[0];
  const descricao = tarefa.text_content ?? tarefa.description ?? tarefa.markdown_description ?? '';
  const familiaCampo = dropdown('Família de Produto');
  const tipoIdentificacao = dropdown('Tipo de Identificação');
  const familiasPreenchidas = todasPreenchidas('Família de Produto');
  const familiasDivergentes = [...new Set(familiasPreenchidas.map((x) => x.valor))].length > 1 ? familiasPreenchidas : [];
  const statusNome = typeof tarefa.status === 'string' ? tarefa.status : tarefa.status?.status ?? '';
  const statusTipo = typeof tarefa.status === 'object' ? tarefa.status?.type ?? '' : '';
  // "finalizado" (closed) e "cancelado"/"projetos" (done) tiram a tarefa da fila de análise.
  const encerramento = /cancel/i.test(statusNome) ? 'cancelada' : ['closed', 'done'].includes(statusTipo) || /finaliz|conclu/i.test(statusNome) ? 'finalizada' : null;
  return {
    taskId: String(tarefa.id),
    titulo: String(tarefa.name ?? ''),
    descricao: String(descricao),
    url: tarefa.url || `https://app.clickup.com/t/${tarefa.id}`,
    statusClickUp: statusNome,
    encerramento,
    familiaCampo,
    familiasDivergentes,
    tipoIdentificacao,
    solicitante: solicitante?.username ?? tarefa.creator?.username ?? '',
    atualizadoEm: Number(tarefa.date_updated) || 0,
    ehCadastro: !!familiaCampo && !!tipoIdentificacao, // só o formulário de cadastro preenche os dois
  };
}

// Pedido de ALTERAÇÃO (renomear, ativar/inativar códigos...) não é produto novo: vai para a área "Outras tarefas".
// Olha o título e a primeira linha da descrição ("Alteração de nome Mães 2027", "Ativar códigos da linha X").
const PEDIDO_DE_ALTERACAO = /\b(altera[cç][aã]o|alterar|altere|renomear|renomea[cç][aã]o|mudan[cç]a de nome|mudar (o )?nome|troca de nome|trocar (o )?nome|corre[cç][aã]o de nome|corrigir (o )?nome|ajuste de nome|ajustar (o )?nome|atualiza[cç][aã]o de nome|atualizar (o )?nome|reativar|reativa[cç][aã]o|ativar|ativa[cç][aã]o|inativar|inativa[cç][aã]o|desativar|desativa[cç][aã]o)\b/i;
export function ehPedidoDeAlteracao(titulo, descricao = '') {
  const primeiraLinha = String(descricao ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return PEDIDO_DE_ALTERACAO.test(normalizarTexto(String(titulo ?? '')).toLowerCase()) || PEDIDO_DE_ALTERACAO.test(normalizarTexto(primeiraLinha).toLowerCase());
}

// Analisa uma tarefa já lida. `catalogo`: resultado de prepararCatalogo (pode ser []).
// Devolve { itens, ignoradas, faixa, familiaPrefixo, prefixoCodigo, rota, sugestao, motivos }.
//   sugestao: 'automatica' (pequena, limpa) | 'analise' (alguém do time precisa olhar)
export function analisarSolicitacao(tarefa, catalogo = [], config = CONFIG_PADRAO) {
  const motivos = [];
  const { itens, ignoradas } = lerLinhasDaDescricao(tarefa.descricao);
  const faixa = lerFaixaDoTitulo(tarefa.titulo);
  const familiaPrefixo = prefixoDaFamiliaDoCampo(tarefa.familiaCampo);
  const faixaPrefixo = faixa ? FAMILIAS.map((f) => f.prefixo).sort((a, b) => b.length - a.length).find((p) => faixa.startsWith(p)) ?? null : null;

  // Texto sem descrição: o título é o produto (ex.: "CNEUTRE CX/3 RF 500ML (item entra no cód 7000)").
  let usouTitulo = false;
  if (itens.length === 0 && tarefa.titulo) {
    const limpo = tarefa.titulo.replace(/\(?\s*(?:item entra no\s*)?c[óo]d(?:igo)?\.?\s*\d{3,4}[^)]*\)?/ig, '').replace(/\s+/g, ' ').trim();
    if (limpo) { itens.push(...lerLinhasDaDescricao(limpo).itens.map((i) => ({ ...i, linha: 0 }))); usouTitulo = true; }
  }

  const todosAvisos = itens.flatMap((i) => i.avisos);
  for (const item of itens) {
    item.parecidos = acharParecidos(item.descricao, catalogo, config.similaridadeMinima);
    if (item.parecidos.length) item.avisos.push(item.parecidos[0].similaridade === 1
      ? `Já existe no Omie com este nome (${item.parecidos[0].codigo}).`
      : `Parecido com ${item.parecidos[0].codigo} - ${item.parecidos[0].descricao}.`);
  }

  let rota = 'criar';
  if (!tarefa.ehCadastro) motivos.push('A tarefa não tem os campos do formulário de cadastro (Família de Produto / Tipo de Identificação).');
  if (/EAN/i.test(tarefa.tipoIdentificacao)) motivos.push('Tipo de identificação é EAN: o pedido não é de código novo.');
  if (!familiaPrefixo) motivos.push('Família de Produto não informada ou não reconhecida.');
  if (faixa && !faixaPrefixo) motivos.push(`O código ${faixa} do título não corresponde a nenhuma família conhecida.`);
  if (faixaPrefixo && familiaPrefixo && faixaPrefixo !== familiaPrefixo) motivos.push(`Conflito: o título pede o código ${faixa} (família ${faixaPrefixo}) mas o campo Família de Produto é ${tarefa.familiaCampo} (${familiaPrefixo}).`);
  if (tarefa.familiasDivergentes?.length) motivos.push(`Dois campos "Família de Produto" preenchidos com valores diferentes (${tarefa.familiasDivergentes.map((x) => x.valor).join(' x ')}).`);
  if (itens.length === 0) motivos.push('Nenhum produto encontrado na descrição nem no título.');
  if (itens.length > config.limiteItensAuto) motivos.push(`${itens.length} itens (o automático vai até ${config.limiteItensAuto}).`);
  if (itens.some((i) => i.codigoExistente)) { rota = 'importar'; motivos.push('Cita código que já existe no Omie: provavelmente é para levar ao Nexaas (aba Importar do Omie), não criar código novo.'); }
  if (todosAvisos.length) motivos.push('Linhas com problema de leitura (veja os avisos).');
  if (itens.some((i) => i.parecidos.length)) motivos.push('Há produto igual ou parecido já cadastrado no Omie.');
  if (usouTitulo) motivos.push('Sem descrição: o produto foi lido do título.');
  const repetidas = ignoradas.filter((i) => i.motivo.startsWith('repetida'));
  if (repetidas.length) motivos.push(`${repetidas.length} linha(s) repetida(s) foram juntadas em uma só.`);

  // Alteração de nome / ativar códigos: não cria código novo. Os outros alertas deixam de fazer sentido.
  if (ehPedidoDeAlteracao(tarefa.titulo, tarefa.descricao)) {
    rota = 'alteracao';
    motivos.splice(0, motivos.length, 'Pedido de alteração (nome, ativar ou inativar códigos): não é produto novo, por isso fica em "Outras tarefas".');
  }

  return {
    itens, ignoradas, faixa, familiaPrefixo, prefixoCodigo: familiaPrefixo, rota,
    sugestao: motivos.length === 0 ? 'automatica' : 'analise', motivos,
  };
}
