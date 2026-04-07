import { useState } from 'react';

function App() {
  // Estado do formulário
  const [formData, setFormData] = useState({
    descricao: '',
    unidade: 'UN',
    preco: '',
    prefixo: ''
  });

  const [carregando, setCarregando] = useState(false);
  const [statusTexto, setStatusTexto] = useState('');
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const descobrirProximoCodigo = (todosCodigos, prefixoDesejado) => {
    const codigosDaFamilia = todosCodigos.filter(c => c.startsWith(prefixoDesejado));
    const sufixos = codigosDaFamilia
      .map(c => c.substring(prefixoDesejado.length))
      .filter(s => /^\d+$/.test(s))
      .map(s => parseInt(s, 10))
      .sort((a, b) => a - b);

    let proximoNumeroLivre = 1;
    for (let i = 0; i < sufixos.length; i++) {
      if (sufixos[i] === proximoNumeroLivre) {
        proximoNumeroLivre++;
      } else if (sufixos[i] > proximoNumeroLivre) {
        break;
      }
    }

    const tamanhoIdealSufixo = Math.max(3, 7 - prefixoDesejado.length);
    const numeroFormatado = String(proximoNumeroLivre).padStart(tamanhoIdealSufixo, '0');
    return `${prefixoDesejado}${numeroFormatado}`;
  };

  const cadastrarProduto = async (e) => {
    e.preventDefault(); // Evita recarregar a página
    setCarregando(true);
    setErro(null);
    setSucesso(null);
    let todosCodigosAcomulados = [];

    try {
      // 1. Busca as páginas para achar o gap (mesma lógica super rápida de antes)
      setStatusTexto("Calculando próximo SKU livre...");
      const res1 = await fetch(`/api/codigos?pagina=1&t=${new Date().getTime()}`);
      if (!res1.ok) throw new Error("Erro na varredura inicial do Omie");
      
      const data1 = await res1.json();
      todosCodigosAcomulados = [...data1.codigos];
      const totalPaginas = data1.total_paginas;

      if (totalPaginas > 1) {
        const paginasPendentes = [];
        for (let p = 2; p <= totalPaginas; p++) paginasPendentes.push(p);
        const tamanhoLote = 3; 
        
        for (let i = 0; i < paginasPendentes.length; i += tamanhoLote) {
          const lote = paginasPendentes.slice(i, i + tamanhoLote);
          const promessas = lote.map(p => fetch(`/api/codigos?pagina=${p}&t=${new Date().getTime()}`).then(res => res.json()));
          const resultadosLote = await Promise.all(promessas);
          resultadosLote.forEach(res => { todosCodigosAcomulados = [...todosCodigosAcomulados, ...res.codigos]; });
        }
      }

      // 2. Acha o código exato
      const codigoGerado = descobrirProximoCodigo(todosCodigosAcomulados, formData.prefixo);
      setStatusTexto(`Código ${codigoGerado} encontrado! Enviando para o Omie...`);

      // 3. Manda os dados preenchidos para a nossa NOVA API de cadastro
      const resCadastro = await fetch('/api/cadastrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: codigoGerado,
          descricao: formData.descricao,
          unidade: formData.unidade,
          preco: formData.preco
        })
      });

      if (!resCadastro.ok) throw new Error("Falha ao salvar o produto no Omie.");

      // Sucesso total! Limpa o formulário.
      setSucesso(`Produto criado com sucesso! O SKU gerado foi: ${codigoGerado}`);
      setFormData({ descricao: '', unidade: 'UN', preco: '', prefixo: '' });

    } catch (error) {
      console.error(error);
      setErro(error.message || "Ocorreu um erro inesperado.");
    } finally {
      setCarregando(false);
      setStatusTexto('');
    }
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', padding: '40px 20px', fontFamily: '"Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '12px', padding: '40px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ color: '#2c3e50', margin: '0 0 8px 0', fontSize: '28px' }}>📦 Cadastro Rápido - Biscoitê</h1>
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '16px' }}>Preencha os dados e o sistema criará o produto no Omie com a numeração correta.</p>
        </div>

        <form onSubmit={cadastrarProduto} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          <div>
            <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Descrição do Produto *</label>
            <input 
              required
              type="text" name="descricao" value={formData.descricao} onChange={handleChange}
              placeholder="Ex: LEITE A XANDO INTEGRAL 1 LITRO" disabled={carregando}
              style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '20px' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Unidade *</label>
              <select 
                required name="unidade" value={formData.unidade} onChange={handleChange} disabled={carregando}
                style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }}
              >
                <option value="UN">UN (Unidade)</option>
                <option value="CX">CX (Caixa)</option>
                <option value="KG">KG (Quilo)</option>
                <option value="PC">PC (Peça)</option>
                <option value="LT">LT (Litro)</option>
              </select>
            </div>

            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Preço de Venda</label>
              <input 
                type="number" step="0.01" name="preco" value={formData.preco} onChange={handleChange}
                placeholder="0.00" disabled={carregando}
                style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Família / Categoria *</label>
            <select 
              required name="prefixo" value={formData.prefixo} onChange={handleChange} disabled={carregando}
              style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }}
            >
              <option value="">Selecione uma categoria...</option>
              <option value="300">EXTERNO</option>
              <option value="400">INTERNO</option>
              <option value="500">CESTAS</option>
              <option value="700">ENTRADA DE NOTAS</option>
            </select>
          </div>
          
          <button 
            type="submit" disabled={carregando}
            style={{ marginTop: '10px', padding: '16px', backgroundColor: carregando ? '#bdc3c7' : '#0070f3', color: 'white', border: 'none', borderRadius: '8px', cursor: carregando ? 'wait' : 'pointer', fontSize: '18px', fontWeight: 'bold' }}
          >
            {carregando ? '⏳ Processando...' : 'Cadastrar no Omie'}
          </button>
        </form>

        {carregando && <p style={{ textAlign: 'center', color: '#e67e22', fontWeight: 'bold', marginTop: '20px' }}>{statusTexto}</p>}
        {erro && <div style={{ marginTop: '20px', backgroundColor: '#fee2e2', color: '#b91c1c', padding: '16px', borderRadius: '4px' }}><strong>Erro:</strong> {erro}</div>}
        {sucesso && <div style={{ marginTop: '20px', backgroundColor: '#f0fdf4', color: '#15803d', border: '2px solid #22c55e', padding: '16px', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold', fontSize: '18px' }}>✅ {sucesso}</div>}

      </div>
    </div>
  );
}

export default App;