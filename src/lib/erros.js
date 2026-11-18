// Traduz mensagens técnicas (ClickUp, Omie, Nexaas, IA) em "o que houve" + "o que fazer", em português simples.
// A mensagem original nunca se perde: a tela a mostra em "Detalhe técnico".
const REGRAS = [
  [/task status invalid|status.*(invalid|inv[aá]lido)|n[aã]o tem o status/i, 'O ClickUp não aceitou o status final da tarefa.', 'Clique em "Tentar de novo". Se repetir, confira se a lista do ClickUp tem o status "finalizado".'],
  [/incorrect api key|api key|401|invalid_api_key/i, 'A chave de acesso do serviço foi recusada.', 'Avise o TI: a chave precisa ser conferida no servidor.'],
  [/429|rate limit|limite|consumo redundante|muitas requisi/i, 'O serviço pediu para esperar um pouco (limite de uso).', 'Aguarde alguns minutos e clique em "Tentar de novo".'],
  [/timeout|timed out|fetch failed|ECONN|ENOTFOUND|network|aborted/i, 'Não consegui falar com o serviço agora (conexão ou lentidão).', 'Tente de novo em instantes. Nada foi duplicado.'],
  [/ncm/i, 'O NCM do produto está faltando ou inválido.', 'Preencha o NCM de 8 dígitos no produto e aprove de novo.'],
  [/j[aá] existe|duplicad|already exist/i, 'Este produto já existe.', 'Use "usar código existente" no item em vez de criar de novo.'],
  [/openai|ia indispon/i, 'A IA não respondeu.', 'O pedido segue para análise de uma pessoa. Pode tentar "Conferir família com a IA" depois.'],
  [/nexaas/i, 'O Nexaas recusou ou não respondeu.', 'Clique em "Tentar de novo". Se persistir, veja o detalhe técnico e avise o TI.'],
  [/omie/i, 'O Omie recusou ou não respondeu.', 'Clique em "Tentar de novo". O sistema não duplica códigos ao repetir.'],
];

export function explicarErro(mensagem) {
  const bruta = String(mensagem ?? '').trim();
  if (!bruta) return null;
  for (const [regex, oQue, oQueFazer] of REGRAS) if (regex.test(bruta)) return { oQue, oQueFazer, detalhe: bruta };
  return { oQue: 'Algo não saiu como esperado nesta etapa.', oQueFazer: 'Clique em "Tentar de novo". Se repetir, avise o TI com o detalhe técnico.', detalhe: bruta };
}
