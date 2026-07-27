import { useState } from 'react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import './App.css';

function App() {
  // ================= ESTADOS DO SISTEMA DE USUÁRIOS =================
  const [listaUsuarios, setListaUsuarios] = useState(() => {
    const salvos = localStorage.getItem('usuarios_biscoite');
    return salvos ? JSON.parse(salvos) : [];
  });

  const [usuarioLogado, setUsuarioLogado] = useState(null);
  const [credenciais, setCredenciais] = useState({ email: '', senha: '' });
  const [erroLogin, setErroLogin] = useState('');
  const [menuAberto, setMenuAberto] = useState(false);

  // Estados do formulário de criação de usuário
  const [formUsuario, setFormUsuario] = useState({
    nome: '', login: '', senha: '', confirmaSenha: '', email: '', setor: ''
  });
  const [erroFormUser, setErroFormUser] = useState('');
  const [sucessoFormUser, setSucessoFormUser] = useState('');

  // ================= ESTADOS CORE =================
  const [modo, setModo] = useState('individual'); // individual | massa | historico | usuarios
  const [formInd, setFormInd] = useState({ categoria: '', descricao: '', ncm: '' });
  const [procInd, setProcInd] = useState(false);
  const [skuGerado, setSkuGerado] = useState(null);
  const [erroInd, setErroInd] = useState(null);

  const [dadosPlanilha, setDadosPlanilha] = useState([]);
  const [procMassa, setProcMassa] = useState(false);
  const [logsMassa, setLogsMassa] = useState([]);

  const [historico, setHistorico] = useState(() => {
    const salvo = localStorage.getItem('historico_skus');
    return salvo ? JSON.parse(salvo) : [];
  });

  // ================= LÓGICA DE USUÁRIOS & LOGIN =================
  const handleLogin = (e) => {
    e.preventDefault();
    
    // Acesso Mestre (Hardcoded para você nunca ficar trancado de fora)
    if (credenciais.email === 'ti' && credenciais.senha === 'ti123') {
      setUsuarioLogado('Acesso Mestre TI');
      setErroLogin('');
      return;
    }

    // Verifica no banco de dados local (localStorage)
    const usuarioEncontrado = listaUsuarios.find(u => 
      (u.email === credenciais.email || u.login === credenciais.email) && u.senha === credenciais.senha
    );

    if (usuarioEncontrado) {
      setUsuarioLogado(usuarioEncontrado.nome);
      setErroLogin('');
    } else {
      setErroLogin('Login, E-mail ou Senha incorretos.');
    }
  };

  const handleLogout = () => {
    setUsuarioLogado(null);
    setCredenciais({ email: '', senha: '' });
    setMenuAberto(false);
    setModo('individual');
  };

  const handleChangeUsuario = (e) => setFormUsuario({ ...formUsuario, [e.target.name]: e.target.value });

  const registrarNovoUsuario = (e) => {
    e.preventDefault();
    setErroFormUser('');
    setSucessoFormUser('');

    if (formUsuario.senha !== formUsuario.confirmaSenha) {
      setErroFormUser('As senhas não coincidem!');
      return;
    }

    // Verifica se login ou e-mail já existem
    const jaExiste = listaUsuarios.some(u => u.email === formUsuario.email || u.login === formUsuario.login);
    if (jaExiste) {
      setErroFormUser('Este e-mail ou login já está cadastrado.');
      return;
    }

    const novoUsuario = { ...formUsuario, id: Date.now() };
    const atualizados = [...listaUsuarios, novoUsuario];
    
    setListaUsuarios(atualizados);
    localStorage.setItem('usuarios_biscoite', JSON.stringify(atualizados));
    
    setSucessoFormUser(`Usuário ${formUsuario.nome} criado com sucesso!`);
    setFormUsuario({ nome: '', login: '', senha: '', confirmaSenha: '', email: '', setor: '' });
  };


  // ================= LÓGICA CORE DO OMIE (Mantida intacta) =================
  const registrarHistorico = (sku, descricao) => {
    const novoRegistro = {
      id: Date.now() + Math.random(),
      email: usuarioLogado,
      sku: sku,
      descricao: descricao,
      data: new Date().toLocaleDateString('pt-BR'),
      hora: new Date().toLocaleTimeString('pt-BR')
    };
    setHistorico(prev => {
      const atualizado = [novoRegistro, ...prev];
      localStorage.setItem('historico_skus', JSON.stringify(atualizado));
      return atualizado;
    });
  };

  const limparHistorico = () => {
    if (window.confirm('Tem a certeza que deseja limpar o histórico deste navegador?')) {
      setHistorico([]);
      localStorage.removeItem('historico_skus');
    }
  };

  const buscarTodosCodigosOmie = async () => {
    const res1 = await fetch(`/api/codigos?pagina=1`);
    if (!res1.ok) throw new Error('Falha ao comunicar.');
    const data1 = await res1.json();
    let todosCodigos = [...data1.codigos];
    const totalPaginas = data1.total_paginas;

    if (totalPaginas > 1) {
      const promessas = [];
      for (let p = 2; p <= totalPaginas; p++) promessas.push(fetch(`/api/codigos?pagina=${p}`).then(r => r.json()));
      const resultados = await Promise.all(promessas);
      resultados.forEach(req => { if (req.codigos) todosCodigos = [...todosCodigos, ...req.codigos]; });
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
      const produtoExistente = produtosDaCategoria.find(prod => String(typeof prod === 'string' ? prod : prod.codigo).trim() === codigoTestado);

      if (!produtoExistente) return { codigo: codigoTestado, acao: 'IncluirProduto' };
      
      const desc = (produtoExistente.descricao || '').toUpperCase().trim();
      if (descricoesStandBy.includes(desc)) return { codigo: codigoTestado, acao: 'AlterarProduto' };
      
      proximaSequencia++;
    }
  };

  const cadastrarNoOmie = async (codigo, descricao, ncm, acao) => {
    const ncmFormatado = ncm && ncm.toString().trim() !== '' ? ncm.toString().trim() : '1905.90.20';
    const res = await fetch('/api/cadastrar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo, descricao, unidade: "UN", preco: 0, ncm: ncmFormatado, acao })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro no Omie.');
    return data;
  };

  const handleChangeInd = (e) => setFormInd({ ...formInd, [e.target.name]: e.target.value });

  const gerarECadastrarIndividual = async (e) => {
    e.preventDefault();
    setProcInd(true); setSkuGerado(null); setErroInd(null);

    try {
      const descFormatada = formInd.descricao.toUpperCase().trim();
      const todosCodigos = await buscarTodosCodigosOmie();
      if (todosCodigos.find(prod => (prod.descricao || '').toUpperCase().trim() === descFormatada)) throw new Error(`Já existe um produto com o nome "${descFormatada}".`);

      const vaga = encontrarProximaVaga(todosCodigos, formInd.categoria);
      await cadastrarNoOmie(vaga.codigo, descFormatada, formInd.ncm, vaga.acao);
      
      setSkuGerado(vaga.codigo);
      registrarHistorico(vaga.codigo, descFormatada); 
      setFormInd({ categoria: '', descricao: '', ncm: '' }); 
    } catch (err) { setErroInd(err.message); } finally { setProcInd(false); }
  };

  const baixarPlanilhaModelo = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Modelo SKU Biscoitê');
    // ... Layout da planilha preservado ...
    worksheet.mergeCells('A1:C1');
    worksheet.getCell('A1').value = 'Planilha de Importação de SKUs';
    worksheet.getCell('A1').font = { name: 'Arial', size: 16, color: { argb: 'FFFFFFFF' }, bold: true };
    worksheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF4B4B' } };
    
    worksheet.mergeCells('A2:C2');
    worksheet.getCell('A2').value = 'Módulo: Gestão de Produtos Biscoitê';
    worksheet.getCell('A2').font = { name: 'Arial', size: 11, color: { argb: 'FFFFFFFF' } };
    worksheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF4B4B' } };
    
    worksheet.addRow(['(obrigatório)\nPrefixo numérico\n(ex: 400)', '(obrigatório)\nNome em maiúsculas', '(opcional)\nNCM']).height = 60;
    worksheet.addRow(['CATEGORIA', 'DESCRICAO', 'NCM']).font = { bold: true };
    worksheet.addRow(['400', 'PRODUTO DE TESTE', '1905.90.20']);
    worksheet.getColumn(1).width = 25; worksheet.getColumn(2).width = 50; worksheet.getColumn(3).width = 25;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Modelo_SKUs.xlsx'; anchor.click();
  };

  const lerArquivoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      setDadosPlanilha(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { range: 3 }));
      setLogsMassa([]); 
    };
    reader.readAsArrayBuffer(file);
  };

  const processarEmMassa = async () => {
    if (dadosPlanilha.length === 0) return alert("Envie uma planilha válida.");
    setProcMassa(true); setLogsMassa([]);

    try {
      const todosCodigos = await buscarTodosCodigosOmie();

      for (let i = 0; i < dadosPlanilha.length; i++) {
        const linha = dadosPlanilha[i];
        const catStr = String(linha.CATEGORIA || '').trim();
        const descStr = String(linha.DESCRICAO || '').toUpperCase().trim();
        const ncmStr = linha.NCM ? String(linha.NCM).trim() : '';

        if (!catStr || !descStr) { setLogsMassa(prev => [...prev, { status: 'Erro', msg: `Linha ${i+1}: Faltam dados.` }]); continue; }
        if (todosCodigos.find(prod => (prod.descricao || '').toUpperCase().trim() === descStr)) { setLogsMassa(prev => [...prev, { status: 'Erro', desc: descStr, msg: 'Já existe no Omie.' }]); continue; }

        const vaga = encontrarProximaVaga(todosCodigos, catStr);
        try {
          await cadastrarNoOmie(vaga.codigo, descStr, ncmStr, vaga.acao);
          if (vaga.acao === 'IncluirProduto') todosCodigos.push({ codigo: vaga.codigo, descricao: descStr });
          else { const p = todosCodigos.find(x => x.codigo === vaga.codigo); if (p) p.descricao = descStr; }
          setLogsMassa(prev => [...prev, { sku: vaga.codigo, desc: descStr, status: vaga.acao === 'AlterarProduto' ? 'Sucesso (Sobrescrito)' : 'Sucesso' }]);
          registrarHistorico(vaga.codigo, descStr); 
        } catch (err) { setLogsMassa(prev => [...prev, { sku: vaga.codigo, desc: descStr, status: 'Erro', msg: err.message }]); }
      }
    } catch (err) { alert("Erro crítico: " + err.message); } finally { setProcMassa(false); setDadosPlanilha([]); }
  };

  // ================= TELA DE LOGIN =================
  if (!usuarioLogado) {
    return (
      <div className="app-container">
        <div className="main-card" style={{ maxWidth: '420px', margin: '0 auto', padding: '50px 40px' }}>
          <div style={{ textAlign: 'center', marginBottom: '35px' }}>
            <h2 className="header-title" style={{ marginBottom: '8px' }}>Acesso Restrito</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: 0, fontWeight: '500' }}>Gerador de SKUs - Biscoitê</p>
          </div>
          {erroLogin && <div className="alert-error" style={{ marginBottom: '20px' }}>⚠️ {erroLogin}</div>}
          <form className="form-group" onSubmit={handleLogin}>
            <div className="input-wrapper">
              <label className="input-label">E-mail ou Login</label>
              <input type="text" name="email" value={credenciais.email} onChange={(e) => setCredenciais({...credenciais, email: e.target.value})} placeholder="nome@biscoite.com.br" className="input-field" required />
            </div>
            <div className="input-wrapper">
              <label className="input-label">Senha de Acesso</label>
              <input type="password" name="senha" value={credenciais.senha} onChange={(e) => setCredenciais({...credenciais, senha: e.target.value})} placeholder="••••••••" className="input-field" required />
            </div>
            <button type="submit" className="btn-primary" style={{ marginTop: '16px' }}>Entrar no Sistema</button>
          </form>
          <div style={{ textAlign: 'center', marginTop: '20px' }}>
            <small style={{ color: 'var(--text-muted)' }}>Para o acesso mestre, use: ti / ti123</small>
          </div>
        </div>
      </div>
    );
  }

  // ================= TELA PRINCIPAL =================
  return (
    <>
      <div className="user-menu-fixed">
        <button className="avatar-btn" onClick={() => setMenuAberto(!menuAberto)}>👤</button>
        {menuAberto && (
          <>
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} onClick={() => setMenuAberto(false)} />
            <div className="dropdown-menu" style={{ zIndex: 999 }}>
              <div className="dropdown-header">{usuarioLogado}</div>
              
              <button className="dropdown-item" onClick={() => { setModo('usuarios'); setMenuAberto(false); }}>
                👥 Criar Novo Usuário
              </button>
              <button className="dropdown-item" onClick={() => { setModo('historico'); setMenuAberto(false); }}>
                📄 Ver Histórico
              </button>
              <button className="dropdown-item danger" onClick={handleLogout}>
                🚪 Sair do Sistema
              </button>
            </div>
          </>
        )}
      </div>

      <div className="app-container">
        <div className="main-card">
          
          {/* HEADER CONDICIONAL */}
          {['individual', 'massa'].includes(modo) ? (
            <header className="header-section">
              <h2 className="header-title">Gerador de SKU</h2>
              <div className="segmented-control">
                <button className={`tab-btn ${modo === 'individual' ? 'active' : ''}`} onClick={() => setModo('individual')}>Individual</button>
                <button className={`tab-btn ${modo === 'massa' ? 'active' : ''}`} onClick={() => setModo('massa')}>Em Massa (Planilha)</button>
              </div>
            </header>
          ) : modo === 'historico' ? (
            <header style={{ marginBottom: '40px' }}>
              <button className="btn-back" onClick={() => setModo('individual')}>⬅ Voltar para o Gerador</button>
              <h2 className="header-title" style={{ textAlign: 'left', margin: 0 }}>Histórico de Criação</h2>
            </header>
          ) : (
            <header style={{ marginBottom: '40px' }}>
              <button className="btn-back" onClick={() => setModo('individual')}>⬅ Voltar para o Gerador</button>
              <h2 className="header-title" style={{ textAlign: 'left', margin: 0 }}>Gestão de Usuários</h2>
            </header>
          )}

          {/* ABA INDIVIDUAL */}
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
                <div className="success-card"><p>Sucesso! Novo produto registado:</p><h1>{skuGerado}</h1></div>
              )}
            </div>
          )}

          {/* ABA MASSA */}
          {modo === 'massa' && (
            <div className="tab-content">
              <div className="step-container">
                <div className="step-text">
                  <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: 'var(--navy-main)' }}>Passo 1: Baixe o modelo padrão</p>
                  <small style={{ color: 'var(--text-muted)' }}>A nossa planilha modelo agora é estruturada com cabeçalhos informativos idênticos ao padrão do ERP Omie.</small>
                </div>
                <button onClick={baixarPlanilhaModelo} className="btn-secondary" style={{ flexShrink: 0 }}>Baixar Modelo</button>
              </div>
              <div className="input-wrapper" style={{ marginBottom: '24px' }}>
                <label className="input-label" style={{ marginBottom: '10px' }}>Passo 2: Anexe o Arquivo .XLSX</label>
                <div className="upload-area">
                  <input type="file" accept=".xlsx, .xls" onChange={lerArquivoUpload} className="upload-input" />
                </div>
              </div>
              {dadosPlanilha.length > 0 && (
                <button onClick={processarEmMassa} disabled={procMassa} className="btn-primary">
                  {procMassa ? `A integrar ${dadosPlanilha.length} linhas...` : `Iniciar Criação em Massa (${dadosPlanilha.length})`}
                </button>
              )}
              {logsMassa.length > 0 && (
                <div className="logs-container">
                  <label className="input-label" style={{ fontSize: '1rem', marginBottom: '16px' }}>Status do Processamento</label>
                  <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                    {logsMassa.map((log, i) => (
                      <div key={i} className={`log-item ${log.status.includes('Sucesso') ? 'log-success' : 'log-error'}`}>
                        <span><strong>{log.status.includes('Sucesso') ? '✅' : '❌'} {log.sku || 'Falha'}</strong> - {log.desc}</span>
                        {log.msg && <span style={{ opacity: 0.8, fontSize: '0.8rem' }}>{log.msg}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ABA HISTÓRICO */}
          {modo === 'historico' && (
            <div className="tab-content">
              <div className="step-container" style={{ marginBottom: '24px' }}>
                <div className="step-text">
                  <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: 'var(--navy-main)' }}>Registos Locais</p>
                  <small style={{ color: 'var(--text-muted)' }}>Exibindo os SKUs gerados recentemente a partir deste navegador.</small>
                </div>
                <button onClick={limparHistorico} className="btn-secondary" style={{ flexShrink: 0, color: '#EF4444', borderColor: '#FECACA', backgroundColor: '#FEF2F2' }}>Limpar Registo</button>
              </div>
              {historico.length === 0 ? (
                <div className="upload-area" style={{ cursor: 'default' }}><p style={{ color: 'var(--text-muted)' }}>Nenhum SKU gerado neste navegador ainda.</p></div>
              ) : (
                <div className="logs-container" style={{ marginTop: '0' }}>
                  <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                    {historico.map((item) => (
                      <div key={item.id} className="log-item" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--gray-border)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', borderBottom: '1px solid #E2E8F0', paddingBottom: '8px' }}>
                          <span style={{ color: 'var(--navy-main)' }}><strong>SKU: {item.sku}</strong></span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{item.data} às {item.hora}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.85rem' }}>
                          <span style={{ color: 'var(--text-main)', fontWeight: '500' }}>{item.descricao}</span>
                          <span style={{ color: 'var(--gold-main)', fontWeight: '600' }}>👤 {item.email}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* NOVA ABA: CRIAR USUÁRIO */}
          {modo === 'usuarios' && (
            <div className="tab-content">
              {erroFormUser && <div className="alert-error">⚠️ {erroFormUser}</div>}
              {sucessoFormUser && <div className="alert-success">✅ {sucessoFormUser}</div>}

              <form onSubmit={registrarNovoUsuario} className="form-group">
                
                {/* Linha 1: Nome e Login */}
                <div className="form-row">
                  <div className="input-wrapper">
                    <label className="input-label">Nome *</label>
                    <input type="text" name="nome" value={formUsuario.nome} onChange={handleChangeUsuario} required className="input-field" placeholder="Nome completo" />
                  </div>
                  <div className="input-wrapper">
                    <label className="input-label">Login *</label>
                    <input type="text" name="login" value={formUsuario.login} onChange={handleChangeUsuario} required className="input-field" placeholder="Ex: kaua.menezes" />
                  </div>
                </div>

                {/* Linha 2: Senha e Confirmação */}
                <div className="form-row">
                  <div className="input-wrapper">
                    <label className="input-label">Senha *</label>
                    <input type="password" name="senha" value={formUsuario.senha} onChange={handleChangeUsuario} required className="input-field" placeholder="••••••••" />
                  </div>
                  <div className="input-wrapper">
                    <label className="input-label">Confirme a senha *</label>
                    <input type="password" name="confirmaSenha" value={formUsuario.confirmaSenha} onChange={handleChangeUsuario} required className="input-field" placeholder="••••••••" />
                  </div>
                </div>

                {/* Linha 3: E-mail e Setor */}
                <div className="form-row">
                  <div className="input-wrapper">
                    <label className="input-label">E-mail *</label>
                    <input type="email" name="email" value={formUsuario.email} onChange={handleChangeUsuario} required className="input-field" placeholder="nome@biscoite.com.br" />
                  </div>
                  <div className="input-wrapper">
                    <label className="input-label">Setor *</label>
                    <select name="setor" value={formUsuario.setor} onChange={handleChangeUsuario} required className="input-field">
                      <option value="">Selecione...</option>
                      <option value="TI">TI</option>
                      <option value="Fabrica">Fábrica</option>
                      <option value="Produtos">Produtos</option>
                      <option value="Comercial">Comercial</option>
                    </select>
                  </div>
                </div>
                
                <button type="submit" className="btn-primary" style={{ marginTop: '20px' }}>
                  Registrar Usuário
                </button>
              </form>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

export default App;