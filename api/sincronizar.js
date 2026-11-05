// api/sincronizar.js — carga/atualização do espelho do catálogo do Omie.
//   GET   mostra o progresso
//   POST  trabalha por até ~40 s e devolve o progresso (a tela chama de novo até completar)
import { sql } from './_lib/db.js';
import { exigirUsuario } from './_lib/sessao.js';
import { garantirEsquema } from './_lib/schema.js';
import { garantirCatalogo, sincronizarCatalogo } from './_lib/catalogo.js';

export default async function handler(req, res) {
  try {
    if (!(await exigirUsuario(req, res))) return;
    await garantirEsquema();

    if (req.method === 'GET') return res.status(200).json(await garantirCatalogo(sql));
    if (req.method === 'POST') return res.status(200).json(await sincronizarCatalogo(sql));
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error('Erro na sincronização:', error.message);
    return res.status(500).json({ error: error.message || 'Erro ao sincronizar o catálogo do Omie.' });
  }
}
