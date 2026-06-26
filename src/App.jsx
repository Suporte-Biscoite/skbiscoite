import { useState } from 'react';

function App() {
  const [form, setForm] = useState({ categoria: '', descricao: '' });
  const [processando, setProcessando] = useState(false);
  const [skuGerado, setSkuGerado] = useState(null);
  const [erro, setErro] = useState(null);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const gerarECadastrar = async (e) => {
    e.preventDefault();
    setProcessando(true);
    setSkuGerado(null);
    setErro(null);

    try {
      const prefixo = form.categoria; // Ex: "400"
      let todosCodigos = [];
      let paginaAtual = 1;
      let totalPaginas = 1;

      // 1. Busca todos os SKUs do Omie passando por todas as páginas
      do {
        const res = await fetch(`/api/codigos?pagina=${paginaAtual}`);
        if (!res.ok) throw new Error('Falha ao comunicar com a API de listagem do Omie.');
        
        const data = await res.json();
        todosCodigos = [...todosCodigos, ...data.codigos];
        totalPaginas = data.total_paginas;
        paginaAtual++;
      } while (paginaAtual <= totalPaginas);

      // 2. Filtra os SKUs pela categoria escolhida e descobre o maior
      const codigosDaCategoria = todosCodigos
        .filter(codigo => codigo.startsWith(prefixo))
        .map(codigo => parseInt(codigo, 10))
        .filter(num => !isNaN(num)); // Garante que só temos números válidos

      let proximoNumero;
      if (codigosDaCategoria.length > 0) {
        const maiorCodigo = Math.max(...codigosDaCategoria);
        proximoNumero = maiorCodigo + 1; // Pega o maior e soma 1 na sequência
      } else {
        // Se não existir NENHUM produto com esse prefixo, cria o primeiro
        proximoNumero = parseInt(prefixo + "0001", 10);
      }

      const novoSKU = proximoNumero.toString();

      // 3. Envia o novo SKU gerado para a rota de cadastro no Omie
      const resCadastro = await fetch('/api/cadastrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: novoSKU,
          descricao: form.descricao,
          unidade: "UN", // Padrão
          preco: 0,
          ncm: "" 
        })
      });

      const dataCadastro = await resCadastro.json();
      
      if (!resCadastro.ok) {
        throw new Error(dataCadastro.error || 'O Omie recusou o cadastro do produto.');
      }

      // Tudo deu certo!
      setSkuGerado(novoSKU);

    } catch (err) {
      console.error(err);
      setErro(err.message);
    } finally {
      setProcessando(false);
    }
  };

  return (
    <div style={{ backgroundColor: '#F8F6F0', minHeight: '100vh', padding: '40px 20px', fontFamily: 'sans-serif' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#fff', padding: '30px', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', border: '1px solid #E5E0D8' }}>
        
        <div style={{ marginBottom: '30px', borderBottom: '2px solid #F0ECE4', paddingBottom: '15px' }}>
          <h2 style={{ margin: 0, color: '#0F2041' }}>Gerador de SKU - TI</h2>
        </div>

        {erro && (
          <div style={{ backgroundColor: '#fee2e2', color: '#dc2626', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontWeight: 'bold' }}>
            Erro: {erro}
          </div>
        )}

        <form onSubmit={gerarECadastrar} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label style={{ fontWeight: 'bold', color: '#333' }}>Prefixo (Categoria)</label>
            <select name="categoria" value={form.categoria} onChange={handleChange} required style={{ width: '100%', padding: '12px', marginTop: '8px', borderRadius: '8px', border: '1px solid #ccc' }}>
              <option value="">Selecione a raiz do código...</option>
              <option value="300">300 - EXTERNO</option>
              <option value="400">400 - INTERNO</option>
              <option value="500">500 - CESTAS</option>
            </select>
          </div>
          
          <div>
            <label style={{ fontWeight: 'bold', color: '#333' }}>Descrição Provisória / Final</label>
            <input type="text" name="descricao" value={form.descricao} onChange={handleChange} required placeholder="Ex: CÓDIGO EM STAND-BY" style={{ width: '100%', padding: '12px', marginTop: '8px', borderRadius: '8px', border: '1px solid #ccc', boxSizing: 'border-box' }} />
          </div>
          
          <button type="submit" disabled={processando} style={{ backgroundColor: '#F2A900', color: '#0F2041', padding: '16px', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer', marginTop: '10px' }}>
            {processando ? 'A varrer o Omie e calcular sequência...' : 'Descobrir Próximo SKU e Registar'}
          </button>
        </form>

        {skuGerado && (
          <div style={{ marginTop: '25px', padding: '20px', backgroundColor: '#0F2041', color: '#fff', borderRadius: '12px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 10px 0', color: '#F2A900' }}>Sucesso! Novo produto registado no Omie:</p>
            <h1 style={{ margin: 0, fontSize: '32px' }}>{skuGerado}</h1>
          </div>
        )}
        
      </div>
    </div>
  );
}

export default App;