// api/_lib/existentes.js — antes de criar, procura o produto no Omie (SOMENTE LEITURA, no espelho local) por nome
// normalizado (sem acento, caixa, abreviações, ordem das palavras) e decide, item por item:
//   novo         -> não existe: cria normalmente
//   reaproveitar -> já existe com o código CERTO: não recadastra no Omie, só confere/cria no Nexaas
//   bloqueado    -> existe, mas o código está errado/em outra família: precisa de decisão de uma pessoa
import { chaveCanonica, situacaoDoCodigo } from '../../src/lib/solicitacoes.js';

export async function resolverExistentes(sql, itens, prefixo) {
  const ativos = await sql`SELECT codigo, descricao, codigo_produto FROM omie_produtos WHERE inativo = false AND length(descricao) > 0`;
  const porCodigo = new Map(ativos.map((p) => [String(p.codigo), p]));
  const porChave = new Map();
  for (const p of ativos) {
    const k = chaveCanonica(p.descricao);
    if (!k) continue;
    if (!porChave.has(k)) porChave.set(k, []);
    porChave.get(k).push(p);
  }
  const reaproveitar = (p, extra = {}) => ({ tipo: 'reaproveitar', codigo: String(p.codigo), descricao: p.descricao, codigoProduto: p.codigo_produto ? Number(p.codigo_produto) : null, ...extra });

  return itens.map((i) => {
    // Escolha de uma pessoa na tela ("Usar o código existente").
    if (i.usar_codigo) {
      const p = porCodigo.get(String(i.usar_codigo));
      if (!p) return { tipo: 'bloqueado', motivo: `o código ${i.usar_codigo} escolhido não está ativo no Omie.` };
      if (situacaoDoCodigo(p.codigo, prefixo) === 'fora_da_faixa') return { tipo: 'bloqueado', motivo: `o código ${p.codigo} está fora do padrão da família: corrija o cadastro antigo antes de usá-lo.` };
      return reaproveitar(p, { escolhido: true });
    }
    const iguais = porChave.get(chaveCanonica(i.descricao)) ?? [];
    if (iguais.length === 0) return { tipo: 'novo' };
    const certos = iguais.filter((p) => situacaoDoCodigo(p.codigo, prefixo) === 'correto');
    if (certos.length === 1) return reaproveitar(certos[0]);
    if (certos.length > 1) return { tipo: 'bloqueado', motivo: `há mais de um cadastro com este nome no Omie (${certos.map((p) => p.codigo).join(', ')}). Escolha qual usar.` };
    const p = iguais[0];
    return situacaoDoCodigo(p.codigo, prefixo) === 'outra_familia'
      ? { tipo: 'bloqueado', motivo: `já existe no Omie em outra família (código ${p.codigo}). Confira se é o mesmo produto; se for, use "Usar o código existente".` }
      : { tipo: 'bloqueado', motivo: `já existe no Omie com o código ${p.codigo}, fora do padrão da família. Corrija o cadastro antigo antes de criar o certo.`, codigoErrado: String(p.codigo) };
  });
}
