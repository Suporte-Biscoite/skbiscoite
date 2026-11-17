// Uso único: move para "Outras tarefas" os pedidos ABERTOS que são alteração de nome / ativar códigos.
// Só muda a classificação (rota/motivos); não toca no Omie, no Nexaas nem no ClickUp.
import { sql } from '../api/_lib/db.js';
import { garantirEsquema } from '../api/_lib/schema.js';
import { ehPedidoDeAlteracao } from '../src/lib/solicitacoes.js';

await garantirEsquema();
const abertas = await sql`SELECT s.id, s.titulo, s.rota, (SELECT original FROM solicitacao_itens i WHERE i.solicitacao_id = s.id ORDER BY ordem LIMIT 1) AS primeira
  FROM solicitacoes s WHERE s.status IN ('aguardando_analise', 'recebida') AND s.lote_id IS NULL AND s.rota <> 'alteracao'`;
const motivo = JSON.stringify(['Pedido de alteração (nome, ativar ou inativar códigos): não é produto novo, por isso fica em "Outras tarefas".']);
let n = 0;
for (const s of abertas) {
  if (!ehPedidoDeAlteracao(s.titulo)) continue;
  await sql`UPDATE solicitacoes SET rota = 'alteracao', sugestao = 'analise', motivos = ${motivo}::jsonb, atualizado_em = now() WHERE id = ${s.id}`;
  await sql`INSERT INTO solicitacoes_log (solicitacao_id, usuario, acao, detalhe) VALUES (${s.id}, 'sistema', 'reclassificada', ${JSON.stringify({ para: 'alteracao' })}::jsonb)`;
  console.log('  →', s.id, s.titulo);
  n++;
}
console.log(n + ' pedido(s) movidos para "Outras tarefas" (de ' + abertas.length + ' abertos).');
process.exit(0);
