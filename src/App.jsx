import { useState } from 'react';

function App() {
  const [aba, setAba] = useState('individual'); 
  const [formData, setFormData] = useState({ descricao: '', unidade: 'UN', preco: '', prefixo: '', ncm: '' });
  
  const [csvFile, setCsvFile] = useState(null);
  const [logMassa, setLogMassa] = useState([]);
  
  const [carregando, setCarregando] = useState(false);
  const [statusTexto, setStatusTexto] = useState('');
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  // Tradutor Inteligente: Transforma o que a pessoa digitou na planilha no prefixo certo
  const traduzirCategoriaParaPrefixo = (textoDaPlanilha) => {
    const texto = textoDaPlanilha.toUpperCase().trim();
    if (texto.includes('EXTERNO') || texto === '300') return '300';
    if (texto.includes('INTERNO') || texto === '400') return '400';
    if (texto.includes('CESTA') || texto === '500') return '500';
    if (texto.includes('ENTRADA') || texto === '700') return '700';
    return ''; // Se não reconhecer nada, retorna vazio para dar erro avisando o usuário
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
      if (sufixos[i] === proximoNumeroLivre) { proximoNumeroLivre++; } 
      else if (sufixos[i] > proximoNumeroLivre) { break; }
    }

    const tamanhoIdealSufixo = Math.max(3, 7 - prefixoDesejado.length);
    return `${prefixoDesejado}${String(proximoNumeroLivre).padStart(tamanhoIdealSufixo, '0')}`;
  };

  const cadastrarProdutoIndividual = async (e) => {
    e.preventDefault();
    setCarregando(true);
    setErro(null); setSucesso(null);
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
        for (let i = 0; i < paginasPendentes.length; i += 3) {
          const promessas = paginasPendentes.slice(i, i + 3).map(p => fetch(`/api/codigos?pagina=${p}&t=${new Date().getTime()}`).then(res => res.json()));
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
          codigo: codigoGerado, descricao: formData.descricao,
          unidade: formData.unidade, preco: formData.preco, ncm: formData.ncm
        })
      });

      if (!resCadastro.ok) throw new Error((await resCadastro.json()).error || "Falha ao salvar no Omie.");

      setSucesso(`Produto criado com sucesso! SKU gerado: ${codigoGerado}`);
      setFormData({ descricao: '', unidade: 'UN', preco: '', prefixo: '', ncm: '' });

    } catch (error) { setErro(error.message || "Ocorreu um erro inesperado."); } 
    finally { setCarregando(false); setStatusTexto(''); }
  };

  const buscarGapsEmLote = async (prefixoDesejado, quantidadeNecessaria) => {
    let todosCodigos = [];
    const res1 = await fetch(`/api/codigos?pagina=1&t=${new Date().getTime()}`);
    const data1 = await res1.json();
    todosCodigos = [...data1.codigos];
    const totalPaginas = data1.total_paginas;

    if (totalPaginas > 1) {
      const paginas = [];
      for (let p = 2; p <= totalPaginas; p++) paginas.push(p);
      for (let i = 0; i < paginas.length; i += 3) {
        const promessas = paginas.slice(i, i + 3).map(p => fetch(`/api/codigos?pagina=${p}&t=${new Date().getTime()}`).then(r => r.json()));
        const res = await Promise.all(promessas);
        res.forEach(d => todosCodigos.push(...d.codigos));
      }
    }

    const codsFamilia = todosCodigos.filter(c => c.startsWith(prefixoDesejado));
    const sufixos = codsFamilia.map(c => parseInt(c.substring(prefixoDesejado.length), 10)).sort((a, b) => a - b);
    
    const gapsEncontrados = [];
    let tentativa = 1;
    while (gapsEncontrados.length < quantidadeNecessaria) {
      if (!sufixos.includes(tentativa)) {
        gapsEncontrados.push(`${prefixoDesejado}${String(tentativa).padStart(Math.max(3, 7 - prefixoDesejado.length), '0')}`);
      }
      tentativa++;
    }
    return gapsEncontrados;
  };

  const processarCadastroMassa = async () => {
    if (!csvFile) return alert("Selecione o arquivo CSV primeiro!");
    setCarregando(true);
    setErro(null); setSucesso(null); setLogMassa([]);

    const leitor = new FileReader();
    leitor.onload = async (e) => {
      const texto = e.target.result;
      const linhas = texto.split('\n').slice(1).filter(l => l.trim() !== ''); 
      
      try {
        const produtosParaCadastrar = linhas.map(linha => {
          const colunas = linha.split(',');
          return {
            descricao: (colunas[0] || "").trim(),
            unidade: (colunas[1] || "UN").trim(),
            preco: (colunas[2] || "0.00").trim(),
            ncm: (colunas[3] || "").trim(),
            // Passa o texto da planilha pelo tradutor pra virar 300, 400...
            prefixo: traduzirCategoriaParaPrefixo((colunas[4] || "")) 
          };
        }).filter(p => p.descricao !== '');

        const contagemPorPrefixo = {};
        produtosParaCadastrar.forEach(p => {
          if (p.prefixo) contagemPorPrefixo[p.prefixo] = (contagemPorPrefixo[p.prefixo] || 0) + 1;
        });

        const skusDisponiveis = {};
        const prefixosDetectados = Object.keys(contagemPorPrefixo);
        
        for (let i = 0; i < prefixosDetectados.length; i++) {
          const pref = prefixosDetectados[i];
          setStatusTexto(`Reservando SKUs para a categoria ${pref}...`);
          skusDisponiveis[pref] = await buscarGapsEmLote(pref, contagemPorPrefixo[pref]);
        }

        const novosLogs = [];
        for (let i = 0; i < produtosParaCadastrar.length; i++) {
          const prod = produtosParaCadastrar[i];
          
          if (!prod.prefixo || !skusDisponiveis[prod.prefixo]) {
            novosLogs.push({ sku: 'Falhou', descricao: prod.descricao, status: 'Erro: Categoria não reconhecida na planilha' });
            continue;
          }

          const skuParaUsar = skusDisponiveis[prod.prefixo].shift(); 
          setStatusTexto(`Cadastrando ${i + 1} de ${produtosParaCadastrar.length}: ${prod.descricao}...`);
          
          const res = await fetch('/api/cadastrar', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ codigo: skuParaUsar, descricao: prod.descricao, unidade: prod.unidade, preco: prod.preco, ncm: prod.ncm })
          });

          if (res.ok) {
            novosLogs.push({ sku: skuParaUsar, descricao: prod.descricao, status: 'Sucesso' });
          } else {
            const data = await res.json();
            novosLogs.push({ sku: 'Falhou', descricao: prod.descricao, status: `Erro: ${data.error}` });
          }
        }
        
        setLogMassa(novosLogs);
        
      } catch (err) { 
          alert("Ocorreu um erro crítico no processamento."); console.error(err);
      }
      setCarregando(false); setStatusTexto('');
    };
    leitor.readAsText(csvFile);
  };

  const baixarCsvModelo = () => {
    // Nova planilha com os nomes amigáveis nas categorias
    const cabecalhos = "Descricao,Unidade,Preco,NCM,Categoria\n";
    const exemplo1 = "CAIXA PAPELAO GRANDE,UN,5.50,48191000,EXTERNO\n";
    const exemplo2 = "MATERIAL DE ESCRITORIO,CX,12.00,39261000,INTERNO\n";
    const exemplo3 = "CESTA DE PASCOA,UN,150.00,19053200,CESTAS\n";
    const blob = new Blob([cabecalhos + exemplo1 + exemplo2 + exemplo3], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", "modelo_omie_biscoite.csv");
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // Calcula quantos deram certo no final
  const qtdSucesso = logMassa.filter(log => log.status === 'Sucesso').length;

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', padding: '40px 20px', fontFamily: '"Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: '800px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '12px', padding: '40px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ color: '#2c3e50', margin: '0 0 8px 0', fontSize: '28px' }}>📦 Cadastro de SKUs - Biscoitê</h1>
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '16px' }}>Gerador automático de numeração com integração Omie.</p>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '32px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
          <button onClick={() => { setAba('individual'); setErro(null); setSucesso(null); }} disabled={carregando} style={{ flex: 1, padding: '12px', cursor: carregando ? 'not-allowed' : 'pointer', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', backgroundColor: aba === 'individual' ? '#0070f3' : '#eee', color: aba === 'individual' ? '#fff' : '#333' }}>
            Cadastro Individual
          </button>
          <button onClick={() => { setAba('massa'); setErro(null); setSucesso(null); }} disabled={carregando} style={{ flex: 1, padding: '12px', cursor: carregando ? 'not-allowed' : 'pointer', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', backgroundColor: aba === 'massa' ? '#0070f3' : '#eee', color: aba === 'massa' ? '#fff' : '#333' }}>
            Cadastro em Massa (CSV)
          </button>
        </div>

        {erro && <div style={{ marginBottom: '24px', backgroundColor: '#fee2e2', color: '#b91c1c', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}><strong>Erro:</strong> {erro}</div>}
        {sucesso && <div style={{ marginBottom: '24px', backgroundColor: '#f0fdf4', color: '#15803d', border: '2px solid #22c55e', padding: '16px', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold' }}>✅ {sucesso}</div>}
        {carregando && <p style={{ textAlign: 'center', color: '#e67e22', fontWeight: 'bold', marginBottom: '24px', fontSize: '16px' }}>{statusTexto}</p>}

        {aba === 'individual' ? (
          <form onSubmit={cadastrarProdutoIndividual} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Campos da aba individual mantidos iguais ao seu projeto... */}
            <div>
              <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Descrição do Produto *</label>
              <input required type="text" name="descricao" value={formData.descricao} onChange={handleChange} disabled={carregando} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
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
                <input type="number" step="0.01" name="preco" value={formData.preco} onChange={handleChange} disabled={carregando} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '20px' }}>
              <div style={{ flex: 2 }}>
                <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Categoria *</label>
                <select required name="prefixo" value={formData.prefixo} onChange={handleChange} disabled={carregando} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', backgroundColor: '#fff' }} >
                  <option value="">Selecione...</option><option value="300">EXTERNO</option><option value="400">INTERNO</option><option value="500">CESTAS</option><option value="700">ENTRADA DE NOTAS</option>
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>NCM *</label>
                <input required type="text" name="ncm" value={formData.ncm} onChange={handleChange} disabled={carregando} style={{ width: '100%', padding: '12px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', boxSizing: 'border-box' }} />
              </div>
            </div>
            <button type="submit" disabled={carregando} style={{ marginTop: '10px', padding: '16px', backgroundColor: carregando ? '#bdc3c7' : '#0070f3', color: 'white', border: 'none', borderRadius: '8px', cursor: carregando ? 'wait' : 'pointer', fontSize: '18px', fontWeight: 'bold' }}> Cadastrar no Omie </button>
          </form>
        ) : (
          <div>
            <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '8px', marginBottom: '24px', border: '1px solid #e2e8f0' }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>Passo 1: Planilha Modelo</h3>
                <p style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#475569' }}>Escreva na coluna Categoria as palavras: <strong>EXTERNO, INTERNO, CESTAS ou ENTRADA DE NOTAS</strong>. O sistema traduz o código sozinho.</p>
                <button onClick={baixarCsvModelo} style={{ padding: '10px 20px', backgroundColor: '#334155', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>📥 Baixar Planilha Modelo (CSV)</button>
            </div>

            <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Passo 2: Envie o arquivo CSV salvo</label>
                <input type="file" accept=".csv" onChange={(e) => setCsvFile(e.target.files[0])} disabled={carregando} style={{ padding: '10px', border: '1px solid #cbd5e1', borderRadius: '8px', width: '100%', boxSizing: 'border-box' }} />
            </div>

            <button onClick={processarCadastroMassa} disabled={carregando || logMassa.length > 0} style={{ width: '100%', padding: '16px', backgroundColor: (carregando || logMassa.length > 0) ? '#bdc3c7' : '#22c55e', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px', cursor: (carregando || logMassa.length > 0) ? 'not-allowed' : 'pointer' }}> 
              {carregando ? 'Processando Lote...' : '🚀 Iniciar Cadastro Misto'} 
            </button>

            {/* PAINEL DE RESUMO FINAL */}
            {logMassa.length > 0 && (
                <div style={{ marginTop: '30px' }}>
                  <div style={{ padding: '20px', backgroundColor: qtdSucesso > 0 ? '#dcfce7' : '#fee2e2', borderRadius: '8px', textAlign: 'center', marginBottom: '20px', border: `2px solid ${qtdSucesso > 0 ? '#22c55e' : '#ef4444'}` }}>
                      <h2 style={{ margin: 0, color: '#0f172a' }}>Resultado do Lote</h2>
                      <p style={{ margin: '10px 0 0 0', fontSize: '18px' }}>
                        Foram cadastrados com sucesso: <strong>{qtdSucesso} de {logMassa.length} produtos!</strong>
                      </p>
                      <button onClick={() => {setLogMassa([]); setCsvFile(null);}} style={{ marginTop: '15px', padding: '8px 16px', borderRadius: '5px', cursor: 'pointer', border: '1px solid #94a3b8' }}>Fazer Novo Upload</button>
                  </div>

                  {/* Tabela de Produtos x Códigos Gerados */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid #cbd5e1', textAlign: 'left' }}>
                        <th style={{ padding: '12px' }}>Status</th>
                        <th style={{ padding: '12px' }}>Código Gerado (SKU)</th>
                        <th style={{ padding: '12px' }}>Produto Cadastrado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logMassa.map((log, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #e2e8f0', backgroundColor: log.status === 'Sucesso' ? '#fff' : '#fef2f2' }}>
                          <td style={{ padding: '12px', fontWeight: 'bold', color: log.status === 'Sucesso' ? '#166534' : '#b91c1c' }}>{log.status === 'Sucesso' ? '✅ OK' : '❌ ERRO'}</td>
                          <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: '16px', fontWeight: 'bold' }}>{log.sku}</td>
                          <td style={{ padding: '12px' }}>{log.descricao} <br/><span style={{fontSize: '11px', color: '#64748b'}}>{log.status !== 'Sucesso' ? log.status : ''}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;