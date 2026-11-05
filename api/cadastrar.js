import axios from 'axios';
import { exigirUsuario } from './_lib/sessao.js';

const OMIE_URL = 'https://app.omie.com.br/api/v1/geral';

const normalizar = (txt) =>
  String(txt ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();

// Cache em memória (vale enquanto a função da Vercel estiver "quente"): nome da família -> código no Omie
let cacheFamilias = null;

async function buscarCodigoFamilia(nomeFamilia, auth) {
  if (!nomeFamilia) return null;

  if (!cacheFamilias) {
    const mapa = {};
    let pagina = 1;
    let totalPaginas = 1;
    do {
      const { data } = await axios.post(`${OMIE_URL}/familias/`, {
        call: 'PesquisarFamilias',
        ...auth,
        param: [{ pagina, registros_por_pagina: 100 }]
      });
      (data.famCadastro || []).forEach(f => {
        if (!f.nomeFamilia || !f.codigo || f.inativo === 'S') return;
        const chave = normalizar(f.nomeFamilia);
        // Nome repetido no Omie = ambíguo: não escolhemos família por palpite.
        mapa[chave] = chave in mapa ? null : f.codigo;
      });
      totalPaginas = data.total_de_paginas || 1;
      pagina++;
    } while (pagina <= totalPaginas);
    cacheFamilias = mapa;
  }

  return cacheFamilias[normalizar(nomeFamilia)] || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  // Só quem está logado no SKBiscoitê pode usar a integração com o Omie.
  if (!(await exigirUsuario(req, res))) return;

  const APP_KEY = process.env.OMIE_APP_KEY;
  const APP_SECRET = process.env.OMIE_APP_SECRET;

  if (!APP_KEY || !APP_SECRET) return res.status(500).json({ error: 'Credenciais ausentes na Vercel.' });

  const { codigo, descricao, preco, ncm, acao, familia, codigo_produto } = req.body;
  const omieCall = acao || "IncluirProduto";
  const auth = { app_key: APP_KEY, app_secret: APP_SECRET };

  // Resolve o código da família no Omie pelo nome. Sem família, NÃO cadastra:
  // criar produto incompleto obrigava a corrigir à mão depois.
  let codigoFamilia = null;
  try {
    codigoFamilia = await buscarCodigoFamilia(familia, auth);
  } catch (err) {
    console.error('Não foi possível listar as famílias do Omie:', err.response?.data?.faultstring || err.message);
    return res.status(502).json({ error: 'Não consegui consultar as famílias no Omie. Tente de novo em instantes.' });
  }
  if (!codigoFamilia) {
    return res.status(422).json({ error: `Família "${familia}" não encontrada (ou repetida) no Omie. O produto NÃO foi criado.` });
  }

  const produto = {
    codigo: codigo,
    descricao: descricao,
    unidade: "UN", // Unidade padrão exigida
    valor_unitario: parseFloat(preco) || 0,
    ncm: ncm || ""
  };
  if (familia) produto.descricao_familia = familia;
  if (codigoFamilia) produto.codigo_familia = codigoFamilia;

  // Reaproveitar um código em stand-by: o Omie identifica o produto pelo ID interno.
  // Produto criado direto no Omie não tem código de integração, então só mandamos um dos dois.
  if (omieCall === 'AlterarProduto' && codigo_produto) {
    produto.codigo_produto = codigo_produto;
  } else {
    produto.codigo_produto_integracao = codigo;
  }

  try {
    const response = await axios.post(`${OMIE_URL}/produtos/`, {
      call: omieCall,
      ...auth,
      param: [produto]
    });

    res.status(200).json({
      sucesso: true,
      omie_id: response.data.codigo_produto,
      familia_id: codigoFamilia
    });

  } catch (error) {
    const msgErroOmie = error.response?.data?.faultstring || "O Omie recusou a operação.";
    console.error("Erro no Omie:", msgErroOmie);
    res.status(500).json({ error: msgErroOmie });
  }
}
