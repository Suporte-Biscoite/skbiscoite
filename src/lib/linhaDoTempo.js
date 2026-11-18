// Textos para pessoas: o histórico técnico vira uma linha do tempo ("quem fez o quê") e o pedido ganha um resumo.
const ACOES = {
  recebida: 'Pedido recebido do ClickUp',
  reanalisada: 'Pedido analisado de novo', reanalisou: 'Pedido analisado de novo', reaberta: 'Pedido reaberto',
  editou: 'Itens editados', 'leu-nota': 'Nota fiscal lida', 'ncm-conferido': 'NCM conferido', 'ncm-corrigido': 'NCM corrigido', 'ncm-padrao': 'NCM padrão da família alterado',
  'ia-sugeriu-nomes': 'IA sugeriu nomes (nada foi trocado sozinho)',
  aprovada: 'Pedido aprovado', 'auto-aprovou': 'Aprovado automaticamente (pedido simples e sem alertas)', 'auto-simulou': 'Simulação: seria aprovado automaticamente',
  'auto-enviou-para-analise': 'Enviado para análise de uma pessoa', 'codigo-gerado': 'Código criado',
  'comentou-no-clickup': 'Comentário com os códigos enviado ao ClickUp', 'status-atualizado': 'Tarefa movida para finalizado no ClickUp', 'status-falhou': 'Não consegui mover a tarefa no ClickUp',
  'tentar-de-novo': 'Nova tentativa de uma etapa', finalizada_clickup: 'Tarefa finalizada no ClickUp', reclassificada: 'Reclassificado como alteração', config: 'Configuração da automação alterada',
};

export function quemFez(usuario) {
  const u = String(usuario ?? '');
  if (u === 'automatico' || u.startsWith('automatico@')) return { tipo: 'robo', nome: 'Robô' };
  if (u === 'sistema' || u === 'clickup' || u === '') return { tipo: 'sistema', nome: 'Sistema' };
  return { tipo: 'pessoa', nome: u };
}

export const descreverAcao = (acao) => ACOES[acao] || String(acao ?? '').replace(/[-_]/g, ' ');

// Junta as etapas de criação e o histórico em uma só lista, do mais novo para o mais antigo.
export function montarLinhaDoTempo(historico = []) {
  return [...historico].sort((a, b) => new Date(b.em) - new Date(a.em)).map((h) => ({ ...quemFez(h.usuario), texto: descreverAcao(h.acao), em: h.em, acao: h.acao }));
}

// Resumo no topo do pedido: o que o sistema encontrou, o que precisa de uma pessoa e o que acontece ao aprovar.
export function resumoDoPedido(s) {
  const itens = (s.itens || []).filter((i) => i.incluido !== false && String(i.descricao || '').trim());
  const reaproveitados = itens.filter((i) => i.usar_codigo || i.codigo_existente);
  const novos = itens.length - reaproveitados.length;
  const semNcm = itens.filter((i) => !reaproveitados.includes(i) && !String(i.ncm || '').replace(/\D/g, '')).length;
  const avisos = itens.reduce((n, i) => n + (i.avisos?.length || 0), 0) + (s.motivos?.length || 0);
  const encontrou = [`${itens.length} produto(s) lido(s)`, novos ? `${novos} novo(s)` : null, reaproveitados.length ? `${reaproveitados.length} já cadastrado(s) no Omie` : null].filter(Boolean).join(', ') + '.';
  const precisa = [semNcm ? `Preencher o NCM de ${semNcm} item(ns).` : null, avisos ? `Ler ${avisos} aviso(s).` : null].filter(Boolean);
  const aprovar = `${novos ? `Cria ${novos} código(s) no Omie e no Nexaas` : 'Não cria códigos novos'}${reaproveitados.length ? `, reaproveita ${reaproveitados.length}` : ''}, comenta na tarefa do ClickUp e a move para finalizado.`;
  return { encontrou, precisa: precisa.length ? precisa : ['Nada além de conferir os nomes.'], aprovar };
}
