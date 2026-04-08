import { useState, useEffect } from 'react';
import ExcelJS from 'exceljs';

function App() {
  // --- ESTADOS DE AUTENTICAÇÃO E HISTÓRICO ---
  const [usuarioLogado, setUsuarioLogado] = useState(null);
  const [nomeInput, setNomeInput] = useState('');
  const [mostrarHistorico, setMostrarHistorico] = useState(false);
  const [historicoLocal, setHistoricoLocal] = useState([]);

  // --- ESTADOS DO SISTEMA ---
  const [aba, setAba] = useState('individual'); 
  const [formData, setFormData] = useState({ descricao: '', unidade: 'UN', preco: '', prefixo: '', ncm: '' });
  const [excelFile, setExcelFile] = useState(null);
  const [logMassa, setLogMassa] = useState([]);
  
  const [carregando, setCarregando] = useState(false);
  const [statusTexto, setStatusTexto] = useState('');
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  // Carrega usuário e histórico ao abrir o site
  useEffect(() => {
    const userSalvo = localStorage.getItem('biscoite_user');
    const histSalvo = localStorage.getItem('biscoite_historico');
    if (userSalvo) setUsuarioLogado(userSalvo);
    if (histSalvo) setHistoricoLocal(JSON.parse(histSalvo));
  }, []);

  // --- FUNÇÕES DE LOGIN / HISTÓRICO ---
  const fazerLogin = (e) => {
    e.preventDefault();
    if (!nomeInput.trim()) return;
    localStorage.setItem('biscoite_user', nomeInput.trim());
    setUsuarioLogado(nomeInput.trim());
  };

  const fazerLogout = () => {
    localStorage.removeItem('biscoite_user');
    setUsuarioLogado(null);
    setNomeInput('');
  };

  const salvarNoHistorico = (tipo, logs) => {
    const novoRegistro = {
      id: Date.now(),
      dataHora: new Date().toLocaleString('pt-BR'),
      usuario: usuarioLogado,
      tipo: tipo, // 'Individual' ou 'Em Massa'
      quantidade: logs.filter(l => l.status.includes('Sucesso') || l.status === 'OK').length,
      detalhes: logs
    };
    const novoHistorico = [novoRegistro, ...historicoLocal].slice(0, 50); // Guarda os últimos 50
    setHistoricoLocal(novoHistorico);
    localStorage.setItem('biscoite_historico', JSON.stringify(novoHistorico));
  };

  // --- FUNÇÕES DO SISTEMA OMIE ---
  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const traduzirCategoriaParaPrefixo = (textoDaPlanilha) => {
    if (!textoDaPlanilha) return '';
    const texto = String(textoDaPlanilha).toUpperCase().trim();
    if (texto.includes('EXTERNO') || texto === '300') return '300';
    if (texto.includes('INTERNO') || texto === '400') return '400';
    if (texto.includes('CESTA') || texto === '500') return '500';
    if (texto.includes('NOTAS') || texto.includes('ENTRADA') || texto === '700') return '700';
    return ''; 
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

  const cadastrarProdutoIndividual = async (e) => {
    e.preventDefault();
    setCarregando(true); setErro(null); setSucesso(null);
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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo: codigoGerado, descricao: formData.descricao,
          unidade: formData.unidade, preco: formData.preco, ncm: formData.ncm
        })
      });

      if (!resCadastro.ok) throw new Error((await resCadastro.json()).error || "Falha ao salvar no Omie.");

      setSucesso(`Produto criado com sucesso! SKU gerado: ${codigoGerado}`);
      
      // REGISTRA NO HISTÓRICO
      salvarNoHistorico('Individual', [{ sku: codigoGerado, descricao: formData.descricao, status: 'OK' }]);
      
      setFormData({ descricao: '', unidade: 'UN', preco: '', prefixo: '', ncm: '' });

    } catch (error) { setErro(error.message || "Ocorreu um erro inesperado."); } 
    finally { setCarregando(false); setStatusTexto(''); }
  };

  const baixarExcelModelo = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Importacao_Produtos');

    worksheet.columns = [ { width: 45 }, { width: 15 }, { width: 25 }, { width: 20 }, { width: 25 } ];

    const rowInstrucoes = worksheet.addRow([
      '(obrigatório)\nPreencha aqui a descrição do produto',
      '(obrigatório)\nTrata-se da unidade',
      '(opcional)\nInforme o preço de venda padrão',
      '(obrigatório)\nInforme o código NCM',
      '(obrigatório)\nEXTERNO, INTERNO, CESTAS ou NOTAS' // <-- Mudou para NOTAS
    ]);
    rowInstrucoes.height = 45;
    rowInstrucoes.font = { color: { argb: 'FF666666' }, size: 9, italic: true };
    rowInstrucoes.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    rowInstrucoes.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }; });

    const rowCabecalho = worksheet.addRow([
      'Descrição do Produto *', 'Unidade *', 'Preço Unitário de Venda', 'Código NCM *', 'Família / Categoria *'
    ]);
    rowCabecalho.height = 25;
    rowCabecalho.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    rowCabecalho.alignment = { vertical: 'middle', horizontal: 'center' };
    rowCabecalho.eachCell((cell) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF343A40' } }; });

    // Removidas as linhas de exemplo (planilha em branco)
    worksheet.eachRow((row, rowNumber) => {
      row.eachCell((cell) => {
        cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "Planilha_Modelo_Biscoite.xlsx";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const processarCadastroMassa = async () => {
    if (!excelFile) return alert("Selecione o arquivo Excel (.xlsx) primeiro!");
    setCarregando(true); setErro(null); setSucesso(null); setLogMassa([]);

    try {
      const workbook = new ExcelJS.Workbook();
      const arrayBuffer = await excelFile.arrayBuffer();
      await workbook.xlsx.load(arrayBuffer);
      const worksheet = workbook.worksheets[0];

      const produtosParaCadastrar = [];

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 2) {
          const descricao = row.getCell(1).value?.toString().trim() || "";
          if (descricao) {
            produtosParaCadastrar.push({
              descricao: descricao,
              unidade: row.getCell(2).value?.toString().trim() || "UN",
              preco: row.getCell(3).value?.toString().trim() || "0.00",
              ncm: row.getCell(4).value?.toString().trim() || "",
              prefixo: traduzirCategoriaParaPrefixo(row.getCell(5).value?.toString() || "")
            });
          }
        }
      });

      if(produtosParaCadastrar.length === 0) throw new Error("A planilha está vazia.");

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
          novosLogs.push({ sku: 'Falhou', descricao: prod.descricao, status: 'Erro: Categoria não reconhecida' });
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
      salvarNoHistorico('Em Massa', novosLogs); // SALVA O LOTE NO HISTÓRICO
      
    } catch (err) { alert(err.message || "Ocorreu um erro ao ler a planilha Excel."); }
    setCarregando(false); setStatusTexto('');
  };

  const qtdSucesso = logMassa.filter(log => log.status === 'Sucesso').length;

  // ================= TELA DE LOGIN =================
  if (!usuarioLogado) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Segoe UI", sans-serif' }}>
        <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px', textAlign: 'center' }}>
          <h1 style={{ color: '#2c3e50', marginBottom: '10px' }}>📦 Validador Omie</h1>
          <p style={{ color: '#7f8c8d', marginBottom: '30px' }}>Faça login para acessar o sistema Biscoitê.</p>
          <form onSubmit={fazerLogin}>
            <input 
              type="text" placeholder="Digite seu Nome ou Setor" required
              value={nomeInput} onChange={(e) => setNomeInput(e.target.value)}
              style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '8px', border: '1px solid #cbd5e1', marginBottom: '20px', boxSizing: 'border-box' }}
            />
            <button type="submit" style={{ width: '100%', padding: '14px', backgroundColor: '#0070f3', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer' }}>
              Entrar no Sistema
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ================= TELA PRINCIPAL =================
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', padding: '20px', fontFamily: '"Segoe UI", sans-serif' }}>
      
      {/* BARRA SUPERIOR (HEADER) */}
      <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', backgroundColor: '#fff', padding: '15px 20px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
        <div>
          <span style={{ fontWeight: 'bold', color: '#334155' }}>👤 Olá, {usuarioLogado}</span>
        </div>
        <div style={{ display: 'flex', gap: '15px' }}>
          <button onClick={() => setMostrarHistorico(true)} style={{ backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
            🕒 Ver Histórico
          </button>
          <button onClick={fazerLogout} style={{ backgroundColor: '#fee2e2', color: '#b91c1c', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
            Sair
          </button>
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '12px', padding: '40px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{ color: '#2c3e50', margin: '0 0 8px 0', fontSize: '28px' }}>📦 Cadastro de SKUs - Biscoitê</h1>
          <p style={{ color: '#7f8c8d', margin: 0, fontSize: '16px' }}>Gerador automático de numeração com integração Omie.</p>
        </div>

        <div style={{ display: 'flex', gap: '10px', marginBottom: '32px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}>
          <button onClick={() => { setAba('individual'); setErro(null); setSucesso(null); }} disabled={carregando} style={{ flex: 1, padding: '12px', cursor: carregando ? 'not-allowed' : 'pointer', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', backgroundColor: aba === 'individual' ? '#0070f3' : '#eee', color: aba === 'individual' ? '#fff' : '#333' }}>
            Cadastro Individual
          </button>
          <button onClick={() => { setAba('massa'); setErro(null); setSucesso(null); }} disabled={carregando} style={{ flex: 1, padding: '12px', cursor: carregando ? 'not-allowed' : 'pointer', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', backgroundColor: aba === 'massa' ? '#10b981' : '#eee', color: aba === 'massa' ? '#fff' : '#333' }}>
            Cadastro em Massa (Excel)
          </button>
        </div>

        {erro && <div style={{ marginBottom: '24px', backgroundColor: '#fee2e2', color: '#b91c1c', padding: '16px', borderRadius: '8px', borderLeft: '4px solid #ef4444' }}><strong>Erro:</strong> {erro}</div>}
        {sucesso && <div style={{ marginBottom: '24px', backgroundColor: '#f0fdf4', color: '#15803d', border: '2px solid #22c55e', padding: '16px', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold' }}>✅ {sucesso}</div>}
        {carregando && <p style={{ textAlign: 'center', color: '#e67e22', fontWeight: 'bold', marginBottom: '24px', fontSize: '16px' }}>{statusTexto}</p>}

        {aba === 'individual' ? (
          <form onSubmit={cadastrarProdutoIndividual} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
                  <option value="">Selecione...</option><option value="300">EXTERNO</option><option value="400">INTERNO</option><option value="500">CESTAS</option><option value="700">NOTAS</option>
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
            <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '8px', marginBottom: '24px', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '18px' }}>Passo 1: Planilha Modelo (Excel)</h3>
                <button onClick={baixarExcelModelo} style={{ padding: '12px 24px', backgroundColor: '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '16px' }}>📥 Baixar Planilha Modelo (.xlsx)</button>
            </div>

            <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontWeight: '600', color: '#34495e', marginBottom: '8px' }}>Passo 2: Envie a Planilha Preenchida (.xlsx)</label>
                <input type="file" accept=".xlsx, .xls" onChange={(e) => setExcelFile(e.target.files[0])} disabled={carregando} style={{ padding: '10px', border: '1px solid #cbd5e1', borderRadius: '8px', width: '100%', boxSizing: 'border-box', backgroundColor: '#f8fafc' }} />
            </div>

            <button onClick={processarCadastroMassa} disabled={carregando || logMassa.length > 0} style={{ width: '100%', padding: '16px', backgroundColor: (carregando || logMassa.length > 0) ? '#bdc3c7' : '#2563eb', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '18px', cursor: (carregando || logMassa.length > 0) ? 'not-allowed' : 'pointer' }}> 
              {carregando ? 'Processando Lote...' : '🚀 Iniciar Cadastro via Excel'} 
            </button>

            {logMassa.length > 0 && (
                <div style={{ marginTop: '30px' }}>
                  <div style={{ padding: '20px', backgroundColor: qtdSucesso > 0 ? '#dcfce7' : '#fee2e2', borderRadius: '8px', textAlign: 'center', marginBottom: '20px', border: `2px solid ${qtdSucesso > 0 ? '#22c55e' : '#ef4444'}` }}>
                      <h2 style={{ margin: 0, color: '#0f172a' }}>Resultado do Lote</h2>
                      <p style={{ margin: '10px 0 0 0', fontSize: '18px' }}>
                        Foram cadastrados com sucesso: <strong>{qtdSucesso} de {logMassa.length} produtos!</strong>
                      </p>
                      <button onClick={() => {setLogMassa([]); setExcelFile(null);}} style={{ marginTop: '15px', padding: '8px 16px', borderRadius: '5px', cursor: 'pointer', border: '1px solid #94a3b8' }}>Fazer Novo Upload</button>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <thead>
                      <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '2px solid #cbd5e1', textAlign: 'left' }}>
                        <th style={{ padding: '12px' }}>Status</th><th style={{ padding: '12px' }}>Código Gerado (SKU)</th><th style={{ padding: '12px' }}>Produto</th>
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

      {/* ================= MODAL DE HISTÓRICO ================= */}
      {mostrarHistorico && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div style={{ backgroundColor: '#fff', width: '90%', maxWidth: '800px', maxHeight: '80vh', borderRadius: '12px', padding: '30px', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '15px', marginBottom: '20px' }}>
              <h2 style={{ margin: 0, color: '#1e293b' }}>🕒 Histórico de Cadastros</h2>
              <button onClick={() => setMostrarHistorico(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: '#64748b' }}>&times;</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              {historicoLocal.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#64748b', marginTop: '40px' }}>Nenhum cadastro realizado ainda neste navegador.</p>
              ) : (
                historicoLocal.map((registro) => (
                  <div key={registro.id} style={{ backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '15px', marginBottom: '15px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <span style={{ fontWeight: 'bold', color: '#0f172a' }}>{registro.dataHora}</span>
                      <span style={{ backgroundColor: '#e0e7ff', color: '#4338ca', padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>Lote: {registro.tipo}</span>
                    </div>
                    <div style={{ fontSize: '14px', color: '#475569', marginBottom: '10px' }}>
                      <strong>Usuário:</strong> {registro.usuario} <br/>
                      <strong>Produtos Salvos:</strong> {registro.quantidade}
                    </div>
                    <details style={{ fontSize: '13px', color: '#64748b', cursor: 'pointer' }}>
                      <summary style={{ outline: 'none', fontWeight: 'bold', color: '#0070f3' }}>Ver produtos gerados</summary>
                      <ul style={{ marginTop: '10px', paddingLeft: '20px' }}>
                        {registro.detalhes.map((item, idx) => (
                          <li key={idx} style={{ marginBottom: '4px' }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{item.sku}</span> - {item.descricao}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                ))
              )}
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default App;