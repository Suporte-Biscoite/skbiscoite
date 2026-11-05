// api/familias.js — o que a tela mostra para escolher: as 7 famílias-base (com prefixo) e as
// famílias sazonais (NATAL, PÁSCOA...), lidas ao vivo do Omie e do Nexaas.
import { sql } from './_lib/db.js';
import { exigirUsuario } from './_lib/sessao.js';
import { garantirEsquema } from './_lib/schema.js';
import { FAMILIAS } from '../src/lib/familias.js';
import { listarFamiliasSazonais } from './_lib/cadastros.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido.' });
  try {
    if (!(await exigirUsuario(req, res))) return;
    await garantirEsquema();
    const sazonais = await listarFamiliasSazonais(sql);
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.status(200).json({ base: FAMILIAS, sazonais });
  } catch (error) {
    console.error('Erro ao listar famílias:', error.message);
    return res.status(500).json({ error: error.message || 'Erro ao consultar as famílias.' });
  }
}
