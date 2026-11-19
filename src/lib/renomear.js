// "Renomear códigos": regras puras. A pessoa cola linhas "código; novo nome" e o servidor propõe, mostra a prévia e só altera após aprovação.
import { LIMITE_DESCRICAO, padronizarNome } from './regras.js';

export const MAX_LINHAS = 50;

// Aceita separadores ; tab , ou " - " (planilha colada tem tab). O código é a primeira palavra (só letras/números).
export function lerLinhasDeRenomeacao(texto) {
  const vistos = new Map();
  const linhas = [];
  String(texto ?? '').split(/\r?\n/).forEach((bruta, i) => {
    const linha = bruta.trim();
    if (!linha) return;
    const m = linha.match(/^([A-Za-z0-9]+)\s*(?:[;\t,]|\s-\s|\s)\s*(.+)$/);
    const item = { linha: i + 1, original: linha };
    if (!m) return linhas.push({ ...item, erro: 'Use o formato "código; novo nome".' });
    const codigo = m[1].toUpperCase();
    const nome = padronizarNome(m[2]);
    if (!nome) return linhas.push({ ...item, codigo, erro: 'Falta o novo nome.' });
    if (nome.length > LIMITE_DESCRICAO) return linhas.push({ ...item, codigo, erro: `Nome com mais de ${LIMITE_DESCRICAO} caracteres.` });
    if (vistos.has(codigo)) return linhas.push({ ...item, codigo, erro: `Código repetido (já aparece na linha ${vistos.get(codigo)}).` });
    vistos.set(codigo, i + 1);
    linhas.push({ ...item, codigo, nome });
  });
  if (linhas.length > MAX_LINHAS) throw new Error(`No máximo ${MAX_LINHAS} códigos por vez (você colou ${linhas.length}).`);
  return linhas;
}

// Avisos e situação de UMA linha, a partir do que o servidor leu no Omie e no Nexaas. Só puro: não fala com nada.
// omie: registro do ConsultarProduto (ou null). nexaas: { existe, productId, nomeProduto } | null. outroComNome: código de outro produto ativo com o nome novo.
export function avaliarRenomeacao({ codigo, nome, omie, nexaas, outroComNome }) {
  const avisos = [];
  if (!omie?.codigo_produto) return { estado: 'invalida', avisos: [`O código ${codigo} não foi encontrado no Omie.`] };
  if (String(omie.descricao ?? '').trim() === nome) return { estado: 'sem_mudanca', avisos: ['O nome novo é igual ao atual no Omie.'] };
  if (omie.inativo === 'S') avisos.push('Este código está inativo no Omie.');
  if (outroComNome && String(outroComNome) !== String(codigo)) avisos.push(`Já existe outro produto ativo com este nome (${outroComNome}).`);
  if (!nexaas?.existe) avisos.push(nexaas?.existe === false ? 'Não existe no Nexaas: só o Omie será alterado.' : 'Não foi possível conferir o Nexaas: só o Omie será alterado.');
  else if (nexaas.nomeProduto && padronizarNome(nexaas.nomeProduto) !== padronizarNome(omie.descricao)) avisos.push(`O nome no Nexaas (${nexaas.nomeProduto}) já era diferente do Omie.`);
  return { estado: 'proposta', avisos };
}

// Corpo do AlterarProduto: o que já estava no cadastro + a descrição nova (o Omie não documenta se omitir campos zera).
const MANTER = ['codigo_produto', 'codigo', 'unidade', 'ncm', 'valor_unitario', 'codigo_familia', 'tipoItem'];
export const corpoDeRenomeacao = (atual, descricao) => ({ ...Object.fromEntries(MANTER.filter((k) => atual[k] !== undefined && atual[k] !== null).map((k) => [k, atual[k]])), descricao });
