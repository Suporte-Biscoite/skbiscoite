import { useState } from 'react';

function App() {
  const [aba, setAba] = useState('individual'); // 'individual' ou 'massa'
  
  // Estado do formulário individual
  const [formData, setFormData] = useState({ descricao: '', unidade: 'UN', preco: '', prefixo: '', ncm: '' });
  
  // Estado do cadastro em massa
  const [csvFile, setCsvFile] = useState(null);
  const [logMassa, setLogMassa] = useState([]);
  
  // Estados de controle de carregamento e mensagens
  const [carregando, setCarregando] = useState(false);
  const [statusTexto, setStatusTexto] = useState('');
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

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

  const cadastrarProdutoIndividual = async (e) => {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    setSucesso(null);
    let todosCodigosAcomulados = [];

    try {
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

      const codigoGerado = descobrirProximoCodigo(todosCodigosAcomulados, formData.prefixo);
      setStatusTexto(`Código ${codigoGerado} encontrado! Enviando para o Omie...`);

      const resCadastro = await fetch('/api/cadastrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: codigoGerado,
          descricao: formData.descricao,
          unidade: formData.unidade,
          preco: formData.preco,
          ncm: formData.ncm
        })
      });

      if (!resCadastro.ok) {
        const errData = await resCadastro.json();
        throw new Error(errData.error || "Falha ao salvar o produto no Omie.");
      }

      setSucesso(`Produto criado com sucesso! O SKU gerado foi: ${codigoGerado}`);
      setFormData({ descricao: '', unidade: 'UN', preco: '', prefixo: '', ncm: '' });

    } catch (error) {
      console.error(error);
      setErro(error.message || "Ocorreu um erro inesperado.");
    } finally {
      setCarregando(false);
      setStatusTexto('');
    }
  };

  const buscarGapsEmLote = async (prefixoDesejado, quantidadeNecessaria) => {
    setStatusTexto("Varrendo catálogo para reservar SKUs...");
    let todosCodigos = [];
    let pagina = 1;
    let total = 1;

    // Busca a primeira página
    const res1 = await fetch(`/api/codigos?pagina=1&t=${new Date().getTime()}`);
    const data1 = await res1.json();
    todosCodigos = [...data1.codigos];
    total = data1.total_paginas;

    // Busca o resto em paralelo
    if (total > 1) {
      const paginas = [];
      for (let p = 2; p <= totalPaginas; p++) paginas.push(p);
      const lotes = [];
      for (let i = 0; i < paginas.length; i += 3) {
        const promessas = paginas.slice(i, i + 3).map(p => fetch(`/api/codigos?pagina=${p}&t=${new Date().getTime()}`).then(r => r.json()));
        const res = await Promise.all(promessas);
        res.forEach(d => todosCodigos.push(...d.codigos));
      }
    }

    // Lógica de achar múltiplos gaps
    const codsFamilia = todosCodigos.filter(c => c.startsWith(prefixoDesejado));
    const sufixos = codsFamilia.map(c => parseInt(c.substring(prefixoDesejado.length), 10)).sort((a, b) => a - b);
    
    const gapsEncontrados = [];
    let tentativa = 1;
    while (gapsEncontrados.length < quantidadeNecessaria) {
      if (!sufixos.includes(tentativa)) {
        const formatado = String(tentativa).padStart(Math.max(3, 7 - prefixoDesejado.length), '0');
        gapsEncontrados.push(`${prefixoDesejado}${formatado}`);
      }
      tentativa++;
    }
    return gapsEncontrados;
  };

  const processarCadastroMassa = async () => {
    if (!csvFile || !formData.prefixo) return alert("Selecione o arquivo CSV e a Categoria do Produto!");
    setCarregando(true);
    setErro(null);
    setSucesso(null);
    setLogMassa([]);

    const leitor = new FileReader();
    leitor.onload = async (e) => {
      const texto = e.target.result;
      const linhas = texto.split('\n').slice(1).filter(l => l.trim() !== ''); // Ignora cabeçalho e linhas vazias
      
      try {
        const skusReservados = await buscarGapsEmLote(formData.prefixo, linhas.length);
        
        const novosLogs = [];
        for (let i = 0; i < linhas.length; i++) {
          const [descricao, unidade, preco, ncm] = linhas[i].split(',');
          const descricaoLimpa = (descricao || "").trim();
          if (!descricaoLimpa) continue;
          
          setStatusTexto(`Cadastrando ${i + 1} de ${linhas.length}: ${descricaoLimpa}...`);
          
          const res = await fetch('/api/cadastrar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              codigo: skusReservados[i], 
              descricao: descricaoLimpa, 
              unidade: (unidade || "UN").trim(), 
              preco: (preco || "0.00").trim(), 
              ncm: (ncm || "").trim() 
            })
          });

          const data = await res.json();
          novosLogs.push({ sku: skusReservados[i], descricao: descricaoLimpa, status: res.ok ? '✅ Sucesso' : `❌ Erro: ${data.error}` });
        }
        setSucesso("Processo de cadastro em massa concluído.");
        setLogMassa(novosLogs);
        
      } catch (err) { 
          alert("Ocorreu um erro crítico no processamento em massa."); 
          console.error(err);
      }
      setCarregando(false);
      setStatusTexto('');
    };
    leitor.readAsText(csvFile);
  };

  // Função para baixar a planilha modelo (CSV)
  const baixarCsvModelo = () => {
    const cabecalhos = "Descricao,Unidade,Preco,NCM\n";
    const exemplo1 = "EXEMPLO PRODUTO A,UN,10.50,19053100\n";
    const exemplo2 = "EXEMPLO KIT B,CX,50.00,19053200\n";
    const blob = new Blob([cabecalhos + exemplo1 + exemplo2], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", "modelo_cadastro_massa_omie.csv");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', padding: '40px 20px', fontFamily: '"Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '700px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '12px', padding: '40px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ color: '#2c3e50', margin: '0 0 8px 0', fontSize: '28px' }}>📦 Cadastro de SKUs - Biscoitê</h1>
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '16px' }}>Escolha o método de cadastro para obter o próximo código livre e criar o produto no Omie.</p>
        </div>

        {/* Abas */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '32px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
          <button 
            onClick={() => { setAba('individual'); setErro(null); setSucesso(null); }} 
            disabled={carregando}
            style={{ 
              flex: 1, padding: '12px', cursor: carregando ? 'not-allowed' : 'pointer', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold',
              backgroundColor: aba === 'individual' ? '#0070f3' : '#eee', color: aba === 'individual' ? '#fff' : '#333'
            }}
          >
            Cadastro Individual
          </button>
          <button 
            onClick={() => { setAba('massa'); setErro(null); setSucesso(null); setFormData({ ...formData, prefixo: '' }); }} 
            disabled={carregando}
            style={{ 
              flex: 1, padding: '12px', cursor: carregando ? 'not-allowed' : 'pointer', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold',
              backgroundColor: aba === 'massa' ? '#0070f3' : '#eee', color: aba === 'massa' ? '#fff' : '#333'
            }}
          >
            Cadastro em Massa (CSV)
          </button>
        </div>

        {/* Mensagens de Erro e Sucesso */}
        {erro && <div style={{ marginBottom: '24px', backgroundColor: '#fee2e2', color: '#b91c1c', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}><strong>Erro:</strong> {erro}</div>}
        {sucesso && <div style={{ marginBottom: '24px', backgroundColor: '#f0fdf4', color: '#15803d', border: '2px solid #22c55e', padding: '16px', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold' }}>✅ {sucesso}</div>}
        {carregando && <p style={{ textAlign: 'center', color: '#e67e22', fontWeight: 'bold', marginBottom: '24px', fontSize: '16px' }}>{statusTexto}</p>}

        {aba === 'individual' ? (
          /* FORMULÁRIO INDIVIDUAL COMPLETO E FUNCIONAL */
          <form onSubmit={cadastrarProdutoIndividual} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Descrição do Produto *</label>
              <input required type="text" name="descricao" value={formData.descricao} onChange={handleChange} placeholder="Ex: LEITE A XANDO INTEGRAL 1 LITRO" disabled={carregando} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'flex', gap: '20px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Unidade *</label>
                <select required name="unidade" value={formData.unidade} onChange={handleChange} disabled={carregando} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }} >
                  <option value="UN">UN</option><option value="CX">CX</option><option value="KG">KG</option><option value="PC">PC</option><option value="LT">LT</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Preço de Venda</label>
                <input type="number" step="0.01" name="preco" value={formData.preco} onChange={handleChange} placeholder="0.00" disabled={carregando} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '20px' }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Família / Categoria *</label>
                <select required name="prefixo" value={formData.prefixo} onChange={handleChange} disabled={carregando} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }} >
                  <option value="">Selecione...</option><option value="300">EXTERNO</option><option value="400">INTERNO</option><option value="500">CESTAS</option><option value="700">ENTRADA DE NOTAS</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>NCM *</label>
                <input required type="text" name="ncm" value={formData.ncm} onChange={handleChange} placeholder="19053100" disabled={carregando} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
              </div>
            </div>
            <button type="submit" disabled={carregando} style={{ marginTop: '10px', padding: '16px', backgroundColor: carregando ? '#bdc3c7' : '#0070f3', color: 'white', border: 'none', borderRadius: '8px', cursor: carregando ? 'wait' : 'pointer', fontSize: '18px', fontWeight: 'bold' }}> {carregando ? '⏳ Processando...' : 'Cadastrar no Omie'} </button>
          </form>
        ) : (
          /* ABA EM MASSA - NOVA E FUNCIONAL */
          <div>
            <h3>Passo 1: Baixe a Planilha Modelo</h3>
            <p style={{ fontSize: '14px', color: '#666', marginBottom: '16px' }}>Use este arquivo para preencher os dados de TODOS os produtos que deseja cadastrar. Não modifique os cabeçalhos.</p>
            <button onClick={baixarCsvModelo} style={{ padding: '10px 20px', backgroundColor: '#555', color: '#fff', border: 'none', borderRadius: '5px', cursor: 'pointer', marginBottom: '32px', fontWeight: 'bold' }}>📥 Baixar Planilha Modelo (CSV)</button>
            
            <h3>Passo 2: Preencha e Faça o Upload</h3>
            <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Selecione o arquivo CSV preenchido:</label>
                <input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files[0])} disabled={carregando} style={{ padding: '10px', border: '1px solid #cbd5e1', borderRadius: '8px', width: '100%', boxSizing: 'border-box' }} />
            </div>

            <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Categoria para TODOS os produtos da planilha:</label>
                <select required name="prefixo" value={formData.prefixo} onChange={handleChange} disabled={carregando} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }} >
                  <option value="">Selecione...</option><option value="300">EXTERNO</option><option value="400">INTERNO</option><option value="500">CESTAS</option><option value="700">ENTRADA DE NOTAS</option>
                </select>
            </div>

            <button onClick={processarCadastroMassa} disabled={carregando} style={{ width: '100%', padding: '16px', backgroundColor: carregando ? '#bdc3c7' : '#22c55e', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px', cursor: carregando ? 'wait' : 'pointer' }}> {carregando ? statusTexto : '🚀 Iniciar Cadastro em Lote'} </button>

            {logMassa.length > 0 && (
                <div style={{ marginTop: '30px', maxHeight: '250px', overflowY: 'auto', border: '1px solid #eee', padding: '15px', borderRadius: '8px', backgroundColor: '#fdfdfd' }}>
                  <h4 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #eee', paddingBottom: '8px' }}>Relatório de Processamento</h4>
                  {logMassa.map((log, i) => (
                    <div key={i} style={{ fontSize: '13px', padding: '8px 0', borderBottom: '1px solid #f9f9f9', display: 'flex', justifyContent: 'space-between', color: log.status.includes('Sucesso') ? '#166534' : '#b91c1c' }}>
                      <span style={{ fontWeight: '500' }}>SKU: {log.sku} - {log.descricao}</span>
                      <span style={{ fontWeight: 'bold' }}>{log.status}</span>
                    </div>
                  ))}
                </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;