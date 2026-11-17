// Regras puras da "Corrigir cadastro antigo": um produto cadastrado com código fora do padrão (ex.: 10360) é
// renomeado para "CADASTRO ERRADO - <nome> (INATIVO)" e inativado; o produto certo nasce depois, na sequência da família.
// Nada aqui fala com o Omie: o servidor lê o produto, monta as verificações e chama estas funções.
import { LIMITE_DESCRICAO } from './regras.js';

export const PREFIXO_ERRADO = 'CADASTRO ERRADO - ';
export const SUFIXO_ERRADO = ' (INATIVO)';

// Nome novo do cadastro antigo. Cabe no limite do Omie cortando o nome original, nunca o prefixo/sufixo.
export function nomeDoCadastroErrado(descricaoOriginal) {
  const original = String(descricaoOriginal ?? '').trim();
  if (original.startsWith(PREFIXO_ERRADO)) return original; // já corrigido antes: não acumula prefixos
  const sobra = LIMITE_DESCRICAO - PREFIXO_ERRADO.length - SUFIXO_ERRADO.length;
  return `${PREFIXO_ERRADO}${original.slice(0, sobra).trim()}${SUFIXO_ERRADO}`;
}

// verificacoes: { estoque: { saldo, reservado, pendentes } | null, movimentos: número | null, pedidos: número | null }
// `null` = não foi possível verificar (a tela exige confirmação manual de quem aprova).
// Devolve { bloqueios: [...], naoVerificado: [...], podeAplicar }.
export function avaliarSeguranca(verificacoes = {}) {
  const bloqueios = [];
  const naoVerificado = [];
  const { estoque, movimentos, pedidos } = verificacoes;
  if (estoque == null) naoVerificado.push('estoque');
  else {
    if (Number(estoque.saldo) !== 0) bloqueios.push(`Tem saldo em estoque (${estoque.saldo}).`);
    if (Number(estoque.reservado) > 0) bloqueios.push(`Tem quantidade reservada (${estoque.reservado}).`);
    if (Number(estoque.pendentes) > 0) bloqueios.push(`Tem entrada ou saída pendente (${estoque.pendentes}).`);
  }
  if (movimentos == null) naoVerificado.push('movimentações');
  else if (movimentos > 0) bloqueios.push(`Tem ${movimentos} movimentação(ões) de estoque.`);
  if (pedidos == null) naoVerificado.push('pedidos e notas');
  else if (pedidos > 0) bloqueios.push(`Aparece em ${pedidos} pedido(s) ou nota(s).`);
  return { bloqueios, naoVerificado, podeAplicar: bloqueios.length === 0 };
}

// Campos que serão enviados ao Omie (só estes: nada mais do cadastro é tocado).
export const camposDaCorrecao = (antes) => ({ descricao: nomeDoCadastroErrado(antes.descricao), inativo: 'S' });
export const camposParaDesfazer = (antes) => ({ descricao: antes.descricao, inativo: antes.inativo === 'S' ? 'S' : 'N' });
