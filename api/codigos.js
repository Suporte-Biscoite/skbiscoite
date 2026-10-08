import axios from 'axios';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });

  const APP_KEY = process.env.OMIE_APP_KEY;
  const APP_SECRET = process.env.OMIE_APP_SECRET;

  // Lê a página da URL (ex: ?pagina=2), se não tiver, vai na 1
  const pagina = parseInt(req.query.pagina) || 1;

  if (!APP_KEY || !APP_SECRET) {
    return res.status(500).json({ error: 'Credenciais ausentes.' });
  }

  try {
    const response = await axios.post('https://app.omie.com.br/api/v1/geral/produtos/', {
      call: "ListarProdutos",
      app_key: APP_KEY,
      app_secret: APP_SECRET,
      param: [{
        pagina: pagina,
        registros_por_pagina: 500,
        apenas_importado_api: "N",
        filtrar_apenas_omiepdv: "N"
      }]
    });

    const data = response.data;
    const produtos = [];

    if (data.produto_servico_cadastro) {
      data.produto_servico_cadastro.forEach(prod => {
        // "codigo" é o SKU; "codigo_produto" é o ID interno do Omie (necessário para AlterarProduto)
        if (prod.codigo) {
          produtos.push({
            codigo: String(prod.codigo).trim(),
            descricao: String(prod.descricao || '').trim(),
            codigo_produto: prod.codigo_produto
          });
        }
      });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(200).json({
      pagina_atual: data.pagina,
      total_paginas: data.total_de_paginas,
      produtos,
      codigos: produtos.map(p => p.codigo) // mantido por compatibilidade
    });

  } catch (error) {
    const msgErroOmie = error.response?.data?.faultstring || "Erro ao buscar dados do Omie";
    console.error("Erro no Omie:", msgErroOmie);
    res.status(500).json({ error: msgErroOmie });
  }
}
