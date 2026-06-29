import { useState } from 'react';
import * as XLSX from 'xlsx';
import './App.css'; // O CSS da Biscoitê

function App() {
  const [modo, setModo] = useState('individual'); 
  
  // ================= ESTADOS =================
  const [formInd, setFormInd] = useState({ categoria: '', descricao: '', ncm: '' });
  const [procInd, setProcInd] = useState(false);
  const [skuGerado, setSkuGerado] = useState(null);
  const [erroInd, setErroInd] = useState(null);

  const [dadosPlanilha, setDadosPlanilha] = useState([]);
  const [procMassa, setProcMassa] = useState(false);
  const [logsMassa, setLogsMassa] = useState([]);

  // ================= LÓGICA CORE =================
  const buscarTodosCodigosOmie = async () => {
    const res1 = await fetch(`/api/codigos?pagina=1`);
    if (!res1.ok) throw new Error('Falha ao comunicar com a API do Omie.');
    
    const data1 = await res1.json();
    let todosCodigos = [...data1.codigos];
    const totalPaginas = data1.total_paginas;

    if (totalPaginas > 1) {
      const promessas = [];
      for (let p = 2; p <= totalPaginas; p++) {
        promessas.push(fetch(`/api/codigos?pagina=${p}`).then(r => r.json()));
      }
      const resultados = await Promise.all(promessas);
      resultados.forEach(req => {
        if (req.codigos) todosCodigos = [...todosCodigos, ...req.codigos];
      });
    }
    return todosCodigos;
  };

  const encontrarProximaVaga = (todosCodigos, prefixo) => {
    const prefixoStr = String(prefixo).trim(); 
    const numDigitosSequencia = 7 - prefixoStr.length; 
    const regex = new RegExp(`^${prefixoStr}\\d{${numDigitosSequencia}}$`);
    const descricoesStandBy = ['PRODUTO INDEFINIDO', 'PRODUTO INDENIDO', 'CÓDIGO EM STAND-BY'];

    const produtosDaCategoria = todosCodigos.filter(prod => {
      const cod = typeof prod === 'string' ? prod : prod.codigo;
      return cod && regex.test(String(cod).trim());
    });

    let proximaSequencia = 1; 

    while (true) {
      const codigoTestado = prefixoStr + proximaSequencia.toString().padStart(numDigitosSequencia, '0');
      
      const produtoExistente = produtosDaCategoria.find(prod => {
        const cod = typeof prod === 'string' ? prod : prod.codigo;
        return String(cod).trim() === codigoTestado;
      });

      if (!produtoExistente) {
        return { codigo: codigoTestado, acao: 'IncluirProduto' };
      } else {
        const desc = (produtoExistente.descricao || '').toUpperCase().trim();
        if (descricoesStandBy.includes(desc)) {
          return { codigo: codigoTestado, acao: 'AlterarProduto' };
        }
      }
      proximaSequencia++;
    }
  };

  const cadastrarNoOmie = async (codigo, descricao, ncm, acao) => {
    const ncmFormatado = ncm && ncm.toString().trim() !== '' ? ncm.toString().trim() : '1905.90.20';
    const res = await fetch('/api/cadastrar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo: codigo,
        descricao: descricao, 
        unidade: "UN",
        preco: 0,
        ncm: ncmFormatado,
        acao: acao 
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'O Omie recusou o cadastro.');
    return data;
  };

  // ================= HANDLERS =================
  const handleChangeInd = (e) => setFormInd({ ...formInd, [e.target.name]: e.target.value });

  const gerarECadastrarIndividual = async (e) => {
    e.preventDefault();
    setProcInd(true);
    setSkuGerado(null);
    setErroInd(null);

    try {
      const descFormatada = formInd.descricao.toUpperCase().trim();
      const todosCodigos = await buscarTodosCodigosOmie();
      
      const produtoExistente = todosCodigos.find(prod => (prod.descricao || '').toUpperCase().trim() === descFormatada);
      if (produtoExistente) throw new Error(`Já existe um produto com o nome "${descFormatada}".`);

      const vaga = encontrarProximaVaga(todosCodigos, formInd.categoria);
      await cadastrarNoOmie(vaga.codigo, descFormatada, formInd.ncm, vaga.acao);
      
      setSkuGerado(vaga.codigo);
      setFormInd({ categoria: '', descricao: '', ncm: '' }); 
    } catch (err) {
      setErroInd(err.message);
    } finally {
      setProcInd(false);
    }
  };

  const baixarPlanilhaModelo = () => {
    const dadosModelo = [{ CATEGORIA: "400", DESCRICAO: "PRODUTO DE TESTE EM STAND-BY", NCM: "1905.90.20" }];
    const ws = XLSX.utils.json_to_sheet(dadosModelo);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Modelo SKU");
    XLSX.writeFile(wb, "Modelo_Criacao_SKUs.xlsx");
  };

  const lerArquivoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      setDadosPlanilha(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]));
      setLogsMassa([]); 
    };
    reader.readAsArrayBuffer(file);
  };

  const processarEmMassa = async () => {
    if (dadosPlanilha.length === 0) return alert("Por favor, envie uma planilha válida.");
    setProcMassa(true);
    setLogsMassa([]);

    try {
      const todosCodigos = await buscarTodosCodigosOmie();

      for (let i = 0; i < dadosPlanilha.length; i++) {
        const linha = dadosPlanilha[i];
        const catStr = String(linha.CATEGORIA || '').trim();
        const descStr = String(linha.DESCRICAO || '').toUpperCase().trim();
        const ncmStr = linha.NCM ? String(linha.NCM).trim() : '';

        if (!catStr || !descStr) {
          setLogsMassa(prev => [...prev, { status: 'Erro', msg: `Linha ${i+1}: Faltam dados.` }]);
          continue;
        }

        const produtoExistente = todosCodigos.find(prod => (prod.descricao || '').toUpperCase().trim() === descStr);
        if (produtoExistente) {
          setLogsMassa(prev => [...prev, { status: 'Erro', desc: descStr, msg: 'Bloqueado. Já existe no Omie.' }]);
          continue;
        }

        const vaga = encontrarProximaVaga(todosCodigos, catStr);

        try {
          await cadastrarNoOmie(vaga.codigo, descStr, ncmStr, vaga.acao);
          
          if (vaga.acao === 'IncluirProduto') {
            todosCodigos.push({ codigo: vaga.codigo, descricao: descStr });
          } else {
            const p = todosCodigos.find(x => x.codigo === vaga.codigo);
            if (p) p.descricao = descStr;
          }

          const statusTxt = vaga.acao === 'AlterarProduto' ? 'Sucesso (Sobrescrito)' : 'Sucesso';
          setLogsMassa(prev => [...prev, { sku: vaga.codigo, desc: descStr, status: statusTxt }]);
        } catch (err) {
          setLogsMassa(prev => [...prev, { sku: vaga.codigo, desc: descStr, status: 'Erro', msg: err.message }]);
        }
      }
    } catch (err) {
      alert("Erro crítico: " + err.message);
    } finally {
      setProcMassa(false);
      setDadosPlanilha([]); 
    }
  };

  // ================= UI / RENDER (LIMPO) =================
  return (
    <div className="app-container">
      <div className="main-card">
        
        <header className="header-section">
          <h2 className="header-title">Gerador de SKU</h2>
          <div className="segmented-control">
            <button 
              className={`tab-btn ${modo === 'individual' ? 'active' : ''}`} 
              onClick={() => setModo('individual')}
            >
              Individual
            </button>
            <button 
              className={`tab-btn ${modo === 'massa' ? 'active' : ''}`} 
              onClick={() => setModo('massa')}
            >
              Em Massa (Planilha)
            </button>
          </div>
        </header>

        {modo === 'individual' && (
          <div className="tab-content">
            {erroInd && <div className="alert-error">⚠️ {erroInd}</div>}

            <form onSubmit={gerarECadastrarIndividual} className="form-group">
              <div className="input-wrapper">
                <label className="input-label">Prefixo (Categoria) *</label>
                <select name="categoria" value={formInd.categoria} onChange={handleChangeInd} required className="input-field">
                  <option value="">Selecione a raiz do código...</option>
                  <option value="200">200 - EMBALAGEM</option>
                  <option value="300">300 - EXTERNO</option>
                  <option value="400">400 - INTERNO</option>
                  <option value="500">500 - CESTAS</option>
                  <option value="1010">1010 - PRODUTO ENVASE</option>
                </select>
              </div>
              
              <div className="input-wrapper">
                <label className="input-label">Descrição Provisória / Final *</label>
                <input type="text" name="descricao" value={formInd.descricao} onChange={handleChangeInd} required placeholder="SERÁ CONVERTIDO PARA MAIÚSCULAS" className="input-field" style={{ textTransform: 'uppercase' }} />
              </div>

              <div className="input-wrapper">
                <label className="input-label">NCM (Opcional)</label>
                <input type="text" name="ncm" value={formInd.ncm} onChange={handleChangeInd} placeholder="Padrão automático: 1905.90.20" className="input-field" />
              </div>
              
              <button type="submit" disabled={procInd} className="btn-primary">
                {procInd ? 'A Processar Integração...' : 'Descobrir Próximo SKU e Registar'}
              </button>
            </form>

            {skuGerado && (
              <div className="success-card">
                <p>Sucesso! Novo produto registado:</p>
                <h1>{skuGerado}</h1>
              </div>
            )}
          </div>
        )}

        {modo === 'massa' && (
          <div className="tab-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
              <div className="input-wrapper">
                <label className="input-label">Passo 1: Prepare a Planilha</label>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Colunas obrigatórias: CATEGORIA, DESCRICAO, NCM</span>
              </div>
              <button onClick={baixarPlanilhaModelo} className="btn-secondary">
                Baixar Modelo
              </button>
            </div>

            <div className="input-wrapper">
              <label className="input-label" style={{ marginBottom: '10px' }}>Passo 2: Anexe o Arquivo .XLSX</label>
              <div className="upload-area">
                <input type="file" accept=".xlsx, .xls" onChange={lerArquivoUpload} className="upload-input" />
              </div>
            </div>

            {dadosPlanilha.length > 0 && (
              <button onClick={processarEmMassa} disabled={procMassa} className="btn-primary" style={{ marginTop: '20px' }}>
                {procMassa ? `A integrar ${dadosPlanilha.length} linhas...` : `Iniciar Criação em Massa (${dadosPlanilha.length})`}
              </button>
            )}

            {logsMassa.length > 0 && (
              <div className="logs-container">
                <label className="input-label">Status do Processamento</label>
                <div style={{ maxHeight: '250px', overflowY: 'auto', marginTop: '16px' }}>
                  {logsMassa.map((log, i) => (
                    <div key={i} className={`log-item ${log.status.includes('Sucesso') ? 'log-success' : 'log-error'}`}>
                      <span><strong>{log.status.includes('Sucesso') ? '✅' : '❌'} {log.sku || 'Falha'}</strong> - {log.desc}</span>
                      {log.msg && <span style={{ opacity: 0.8, fontSize: '0.8rem' }}>({log.msg})</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

export default App;