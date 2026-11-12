// Verifica a importação Omie -> Nexaas SEM criar nada: analisa uma amostra de códigos reais.
// Uso: npm run verificar-importacao [-- cod1 cod2 ...]   (sem códigos, pega 12 de grupos variados)
import { sql } from '../api/_lib/db.js';
import { garantirEsquema } from '../api/_lib/schema.js';
import { analisarCodigos } from '../api/_lib/importacao.js';

await garantirEsquema();
let codigos = process.argv.slice(2);
if (codigos.length === 0) {
  const linhas = await sql`SELECT codigo FROM (SELECT codigo, row_number() OVER (PARTITION BY left(codigo, 3) ORDER BY random()) n FROM omie_produtos WHERE length(codigo) = 7) t WHERE n <= 2 ORDER BY codigo`;
  codigos = linhas.map((l) => l.codigo);
}
const t = performance.now();
const itens = await analisarCodigos(sql, codigos);
console.log(`${itens.length} códigos em ${((performance.now() - t) / 1000).toFixed(1)} s`);
for (const i of itens) console.log(`${i.codigo} | ${i.estado.padEnd(12)} | loja: ${i.entraNaLoja === undefined ? '-' : i.entraNaLoja ? 'sim' : 'não'} | ${i.categoriaNexaas ?? '-'} | ${i.descricao ?? ''} ${i.erros ? '| ' + i.erros.join('; ') : ''}${i.aviso ? ' | aviso: ' + i.aviso : ''}`);
process.exit(0);
