import { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import './App.css';

// ================= CONEXÃO SUPABASE =================
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function App() {
  // ================= ESTADOS DE USUÁRIOS E LOGIN =================
  const [usuarioLogado, setUsuarioLogado] = useState(null); 
  const [credenciais, setCredenciais] = useState({ email: '', senha: '' });
  const [erroLogin, setErroLogin] = useState('');
  const [sucessoLogin, setSucessoLogin] = useState(''); 
  const [carregandoLogin, setCarregandoLogin] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);

  const [telaLogin, setTelaLogin] = useState('login'); 
  const [emailRecuperacao, setEmailRecuperacao] = useState('');
  
  // Controle do "Olhinho"
  const [mostrarSenhaLogin, setMostrarSenhaLogin] = useState(false);
  const [mostrarSenhaForm, setMostrarSenhaForm] = useState(false);

  // ================= ESTADOS DO DASHBOARD DE USUÁRIOS =================
  const [usuariosCadastrados, setUsuariosCadastrados] = useState([]);
  const [abaGestao, setAbaGestao] = useState('lista'); // 'lista' | 'criar'
  const [idEditandoSenha, setIdEditandoSenha] = useState(null);
  const [novaSenhaEditada, setNovaSenhaEditada] = useState('');

  const [formUsuario, setFormUsuario] = useState({ nome: '', login: '', senha: '', confirmaSenha: '', email: '', setor: '' });
  const [erroFormUser, setErroFormUser] = useState('');
  const [sucessoFormUser, setSucessoFormUser] = useState('');
  const [carregandoRegistro, setCarregandoRegistro] = useState(false);

  // ================= ESTADOS CORE DO OMIE =================
  const [modo, setModo] = useState('individual'); 
  const [formInd, setFormInd] = useState({ categoria: '', descricao: '', ncm: '' });
  const [procInd, setProcInd] = useState(false);
  const [skuGerado, setSkuGerado] = useState(null);
  const [erroInd, setErroInd] = useState(null);

  const [dadosPlanilha, setDadosPlanilha] = useState([]);
  const [procMassa, setProcMassa] = useState(false);
  const [logsMassa, setLogsMassa] = useState([]);

  const [historico, setHistorico] = useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  // ================= LÓGICA DE USUÁRIOS (DASHBOARD) =================
  const carregarUsuarios = async () => {
    const { data, error } = await supabase
      .from('usuarios')
      .select('*')
      .order('nome', { ascending: true });
    if (data) setUsuariosCadastrados(data);
  };

  useEffect(() => {
    if (modo === 'usuarios' && abaGestao === 'lista') {
      carregarUsuarios();
    }
  }, [modo, abaGestao]);

  const salvarNovaSenha = async (idUsuario) => {
    if (novaSenhaEditada.trim() === '') return alert('A senha não pode ser vazia.');
    try {
      const { error } = await supabase
        .from('usuarios')
        .update({ senha: novaSenhaEditada })
        .eq('id', idUsuario);
      
      if (error) throw error;
      alert('Senha atualizada com sucesso!');
      setIdEditandoSenha(null);
      setNovaSenhaEditada('');
      carregarUsuarios();
    } catch (err) {
      alert('Erro ao atualizar senha.');
    }
  };

  // ================= LÓGICA DE LOGIN & RECUPERAÇÃO =================
  const gerarSenhaAleatoria = () => `Biscoite${Math.floor(1000 + Math.random() * 9000)}`;

  const handleRecuperarSenha = async (e) => {
    e.preventDefault();
    setCarregandoLogin(true);
    setErroLogin('');
    setSucessoLogin('');

    try {
      const { data: usuario, error: erroBusca } = await supabase
        .from('usuarios')
        .select('id, nome, email')
        .eq('email', emailRecuperacao)
        .single();

      if (!usuario) {
        setErroLogin('Este e-mail não foi encontrado no sistema.');
        setCarregandoLogin(false);
        return;
      }

      const novaSenha = gerarSenhaAleatoria();
      const { error: erroUpdate } = await supabase
        .from('usuarios')
        .update({ senha: novaSenha })
        .eq('email', emailRecuperacao);

      if (erroUpdate) throw erroUpdate;

      alert(`[SIMULAÇÃO DE E-MAIL]\n\nPara: ${usuario.nome} (${usuario.email})\n\nSua senha foi redefinida com sucesso.\nSua nova senha de acesso é: ${novaSenha}`);

      setTelaLogin('login');
      setSucessoLogin('Sua nova senha foi gerada. Verifique seu e-mail (ou o alerta na tela).');
      setEmailRecuperacao('');
      
    } catch (err) {
      setErroLogin('Erro ao processar a recuperação de senha.');
    } finally {
      setCarregandoLogin(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    
    // ACESSO MESTRE DE EMERGÊNCIA
    if (credenciais.email === 'ti' && credenciais.senha === 'ti123') {
      setUsuarioLogado({ nome: 'Mestre TI', email: 'ti@biscoite.com.br', setor: 'TI' });
      setErroLogin('');
      setCredenciais({ email: '', senha: '' });
      return;
    }

    setCarregandoLogin(true);
    setErroLogin('');
    setSucessoLogin('');

    try {
      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .or(`email.eq.${credenciais.email},login.eq.${credenciais.email}`)
        .eq('senha', credenciais.senha)
        .single();

      if (data) {
        setUsuarioLogado(data);
        setCredenciais({ email: '', senha: '' });
      } else {
        setErroLogin('Login, E-mail ou Senha incorretos.');
      }
    } catch (err) {
      setErroLogin('Erro de comunicação com o servidor. Verifique a conexão.');
    } finally {
      setCarregandoLogin(false);
    }
  };

  const handleLogout = () => {
    setUsuarioLogado(null);
    setMenuAberto(false);
    setModo('individual');
    setTelaLogin('login');
  };

  const registrarNovoUsuario = async (e) => {
    e.preventDefault();
    setErroFormUser(''); setSucessoFormUser(''); setCarregandoRegistro(true);

    if (formUsuario.senha !== formUsuario.confirmaSenha) {
      setCarregandoRegistro(false);
      return setErroFormUser('As senhas não coincidem!');
    }

    try {
      const { data: existente } = await supabase
        .from('usuarios')
        .select('id')
        .or(`email.eq.${formUsuario.email},login.eq.${formUsuario.login}`);

      if (existente && existente.length > 0) {
        setCarregandoRegistro(false);
        return setErroFormUser('Este e-mail ou login já está cadastrado.');
      }

      const { error } = await supabase.from('usuarios').insert([{
        nome: formUsuario.nome,
        login: formUsuario.login,
        senha: formUsuario.senha,
        email: formUsuario.email,
        setor: formUsuario.setor
      }]);

      if (error) throw error;

      setSucessoFormUser(`Usuário ${formUsuario.nome} criado com sucesso!`);
      setFormUsuario({ nome: '', login: '', senha: '', confirmaSenha: '', email: '', setor: '' });
      setTimeout(() => { 
        setAbaGestao('lista'); 
        setSucessoFormUser(''); 
      }, 2000); // Volta pra lista após 2s
    } catch (error) {
      setErroFormUser('Erro ao criar usuário: ' + error.message);
    } finally {
      setCarregandoRegistro(false);
    }
  };

  // ================= LÓGICA DE HISTÓRICO =================
  const registrarHistorico = async (sku, descricao) => {
    if (!usuarioLogado) return;
    await supabase.from('historico_skus').insert([{
      email_usuario: usuarioLogado.email,
      sku: sku,
      descricao: descricao
    }]);
  };

  const carregarHistorico = async () => {
    setCarregandoHistorico(true);
    const { data, error } = await supabase
      .from('historico_skus')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(100); 
    
    if (data) setHistorico(data);
    setCarregandoHistorico(false);
  };

  useEffect(() => {
    if (modo === 'historico') carregarHistorico();
  }, [modo]);

  const limparHistorico = async () => {
    if (window.confirm('Tem a certeza que deseja APAGAR TODO o histórico da nuvem para toda a equipe?')) {
      await supabase.from('historico_skus').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      carregarHistorico();
    }
  };

  // ================= LÓGICA CORE DO OMIE =================
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
      await registrarHistorico(vaga.codigo, descFormatada); 
      setFormInd({ categoria: '', descricao: '', ncm: '' }); 
    } catch (err) { setErroInd(err.message); } finally { setProcInd(false); }
  };

  const baixarPlanilhaModelo = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Modelo SKU Biscoitê');
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
          await registrarHistorico(vaga.codigo, descStr); 
        } catch (err) { setLogsMassa(prev => [...prev, { sku: vaga.codigo, desc: descStr, status: 'Erro', msg: err.message }]); }
      }
    } catch (err) { alert("Erro crítico: " + err.message); } finally { setProcMassa(false); setDadosPlanilha([]); }
  };

  // ================= TELA DE LOGIN / RECUPERAÇÃO =================
  if (!usuarioLogado) {
    return (
      <div className="app-container">
        <div className="main-card" style={{ maxWidth: '420px', margin: '0 auto', padding: '50px 40px' }}>
          <div style={{ textAlign: 'center', marginBottom: '35px' }}>
            <h2 className="header-title" style={{ marginBottom: '8px' }}>Acesso Restrito</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: 0, fontWeight: '500' }}>
              Gerador de SKUs - Biscoitê
            </p>
          </div>
          
          {erroLogin && <div className="alert-error" style={{ marginBottom: '20px' }}>⚠️ {erroLogin}</div>}
          {sucessoLogin && <div className="alert-success" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', color: '#15803D', padding: '16px', borderRadius: '10px', marginBottom: '24px', fontWeight: '600', fontSize: '0.9rem', textAlign: 'center' }}>✅ {sucessoLogin}</div>}

          {telaLogin === 'login' ? (
            <form className="form-group" onSubmit={handleLogin}>
              <div className="input-wrapper">
                <label className="input-label">E-mail ou Login</label>
                <input type="text" name="email" value={credenciais.email} onChange={(e) => setCredenciais({...credenciais, email: e.target.value})} placeholder="nome@biscoite.com.br" className="input-field" required />
              </div>
              <div className="input-wrapper">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="input-label">Senha de Acesso</label>
                  <button type="button" onClick={() => { setTelaLogin('recuperar'); setErroLogin(''); setSucessoLogin(''); }} style={{ background: 'none', border: 'none', color: 'var(--gold-main)', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer', padding: 0 }}>
                    Esqueceu a senha?
                  </button>
                </div>
                <div className="password-container">
                  <input type={mostrarSenhaLogin ? "text" : "password"} name="senha" value={credenciais.senha} onChange={(e) => setCredenciais({...credenciais, senha: e.target.value})} placeholder="••••••••" className="input-field" required />
                  <button type="button" className="eye-button" onClick={() => setMostrarSenhaLogin(!mostrarSenhaLogin)}>
                    {mostrarSenhaLogin ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={carregandoLogin} className="btn-primary" style={{ marginTop: '16px' }}>
                {carregandoLogin ? 'Autenticando...' : 'Entrar no Sistema'}
              </button>
            </form>
          ) : (
            <form className="form-group" onSubmit={handleRecuperarSenha}>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-main)', marginBottom: '10px', textAlign: 'center' }}>
                Digite seu e-mail cadastrado. Enviaremos uma nova senha de acesso para você.
              </p>
              <div className="input-wrapper">
                <label className="input-label">E-mail Corporativo</label>
                <input type="email" value={emailRecuperacao} onChange={(e) => setEmailRecuperacao(e.target.value)} placeholder="nome@biscoite.com.br" className="input-field" required />
              </div>
              <button type="submit" disabled={carregandoLogin} className="btn-primary" style={{ marginTop: '16px' }}>
                {carregandoLogin ? 'A processar...' : 'Gerar Nova Senha'}
              </button>
              <button type="button" onClick={() => { setTelaLogin('login'); setErroLogin(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.9rem', fontWeight: '600', cursor: 'pointer', marginTop: '15px', width: '100%' }}>
                Voltar para o Login
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // ================= TELA PRINCIPAL (APÓS LOGIN) =================
  return (
    <>
      <div className="user-menu-fixed">
        <button className="avatar-btn" onClick={() => setMenuAberto(!menuAberto)}>👤</button>
        {menuAberto && (
          <>
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} onClick={() => setMenuAberto(false)} />
            <div className="dropdown-menu" style={{ zIndex: 999 }}>
              <div className="dropdown-header">{usuarioLogado.nome}</div>
              
              <button className="dropdown-item" onClick={() => { setModo('usuarios'); setAbaGestao('lista'); setMenuAberto(false); }}>
                👥 Gestão de Equipe
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
              <h2 className="header-title" style={{ textAlign: 'left', margin: 0 }}>Histórico da Nuvem</h2>
            </header>
          ) : null}

          {/* === MODO INDIVIDUAL === */}
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

          {/* === MODO MASSA === */}
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

          {/* === MODO HISTÓRICO === */}
          {modo === 'historico' && (
            <div className="tab-content">
              <div className="step-container" style={{ marginBottom: '24px' }}>
                <div className="step-text">
                  <p style={{ margin: '0 0 6px 0', fontWeight: '700', color: 'var(--navy-main)' }}>Registos Corporativos</p>
                  <small style={{ color: 'var(--text-muted)' }}>Exibindo os SKUs gerados por toda a equipe (sincronizado via Supabase).</small>
                </div>
                <button onClick={limparHistorico} className="btn-secondary" style={{ flexShrink: 0, color: '#EF4444', borderColor: '#FECACA', backgroundColor: '#FEF2F2' }}>Limpar Registo</button>
              </div>
              
              {carregandoHistorico ? (
                <div className="upload-area" style={{ cursor: 'default' }}><p style={{ color: 'var(--text-muted)' }}>A carregar dados da nuvem...</p></div>
              ) : historico.length === 0 ? (
                <div className="upload-area" style={{ cursor: 'default' }}><p style={{ color: 'var(--text-muted)' }}>Nenhum SKU gerado ainda.</p></div>
              ) : (
                <div className="logs-container" style={{ marginTop: '0' }}>
                  <div style={{ maxHeight: '400px', overflowY: 'auto', paddingRight: '10px' }}>
                    {historico.map((item) => {
                      const dataFormatada = new Date(item.criado_em).toLocaleDateString('pt-BR');
                      const horaFormatada = new Date(item.criado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
                      
                      return (
                        <div key={item.id} className="log-item" style={{ backgroundColor: '#FAFAFA', border: '1px solid var(--gray-border)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', borderBottom: '1px solid #E2E8F0', paddingBottom: '8px' }}>
                            <span style={{ color: 'var(--navy-main)' }}><strong>SKU: {item.sku}</strong></span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{dataFormatada} às {horaFormatada}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--text-main)', fontWeight: '500' }}>{item.descricao}</span>
                            <span style={{ color: 'var(--gold-main)', fontWeight: '600' }}>👤 {item.email_usuario}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === MODO GESTÃO DE USUÁRIOS (DASHBOARD) === */}
          {modo === 'usuarios' && (
            <div className="tab-content">
              <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px' }}>
                <div>
                  <button className="btn-back" onClick={() => setModo('individual')} style={{ padding: 0, marginBottom: '10px' }}>⬅ Voltar para SKUs</button>
                  <h2 className="header-title" style={{ margin: 0 }}>Gestão de Pessoas</h2>
                </div>
                {abaGestao === 'lista' ? (
                  <button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }} onClick={() => setAbaGestao('criar')}>+ Novo Usuário</button>
                ) : (
                  <button className="btn-secondary" style={{ width: 'auto', padding: '10px 20px' }} onClick={() => setAbaGestao('lista')}>Ver Tabela</button>
                )}
              </header>

              {abaGestao === 'lista' ? (
                <div className="table-container">
                  <table className="aesthetic-table">
                    <thead>
                      <tr>
                        <th>Colaborador</th>
                        <th>Setor</th>
                        <th>Login / E-mail</th>
                        <th>Segurança</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usuariosCadastrados.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>👤</div>
                              <span style={{ fontWeight: '600' }}>{user.nome}</span>
                            </div>
                          </td>
                          <td><span className="badge-setor">{user.setor}</span></td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: '500' }}>{user.login}</span>
                              <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{user.email}</span>
                            </div>
                          </td>
                          <td>
                            {idEditandoSenha === user.id ? (
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <input type="text" placeholder="Nova senha" value={novaSenhaEditada} onChange={(e) => setNovaSenhaEditada(e.target.value)} style={{ padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: '6px', fontSize: '0.85rem' }} />
                                <button onClick={() => salvarNovaSenha(user.id)} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontWeight: 'bold' }}>Salvar</button>
                                <button onClick={() => { setIdEditandoSenha(null); setNovaSenhaEditada(''); }} style={{ background: '#f1f5f9', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}>Cancelar</button>
                              </div>
                            ) : (
                              <button onClick={() => setIdEditandoSenha(user.id)} style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 12px', color: '#64748b', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600' }}>✏️ Redefinir Senha</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ maxWidth: '600px', margin: '0 auto', background: '#f8fafc', padding: '30px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                  {erroFormUser && <div className="alert-error">⚠️ {erroFormUser}</div>}
                  {sucessoFormUser && <div className="alert-success" style={{ backgroundColor: '#F0FDF4', border: '1px solid #BBF7D0', color: '#15803D', padding: '16px', borderRadius: '10px', marginBottom: '24px', fontWeight: '600', fontSize: '0.9rem', textAlign: 'center' }}>✅ {sucessoFormUser}</div>}
                  <form onSubmit={registrarNovoUsuario} className="form-group">
                    <div className="form-row">
                      <div className="input-wrapper">
                        <label className="input-label">Nome Completo *</label>
                        <input type="text" name="nome" value={formUsuario.nome} onChange={(e) => setFormUsuario({...formUsuario, nome: e.target.value})} required className="input-field" placeholder="Ex: Kauã Menezes" />
                      </div>
                      <div className="input-wrapper">
                        <label className="input-label">E-mail Corporativo *</label>
                        <input type="email" name="email" value={formUsuario.email} onChange={(e) => setFormUsuario({...formUsuario, email: e.target.value})} required className="input-field" placeholder="kaua.menezes@biscoite.com" />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="input-wrapper">
                        <label className="input-label">Login *</label>
                        <input type="text" name="login" value={formUsuario.login} onChange={(e) => setFormUsuario({...formUsuario, login: e.target.value})} required className="input-field" placeholder="kaua.menezes" />
                      </div>
                      <div className="input-wrapper">
                        <label className="input-label">Setor *</label>
                        <select name="setor" value={formUsuario.setor} onChange={(e) => setFormUsuario({...formUsuario, setor: e.target.value})} required className="input-field">
                          <option value="">Selecione...</option>
                          <option value="TI">TI</option>
                          <option value="Fabrica">Fábrica</option>
                          <option value="Produtos">Produtos</option>
                          <option value="Comercial">Comercial</option>
                        </select>
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="input-wrapper">
                        <label className="input-label">Senha *</label>
                        <div className="password-container">
                          <input type={mostrarSenhaForm ? "text" : "password"} name="senha" value={formUsuario.senha} onChange={(e) => setFormUsuario({...formUsuario, senha: e.target.value})} required className="input-field" placeholder="••••••••" />
                          <button type="button" className="eye-button" onClick={() => setMostrarSenhaForm(!mostrarSenhaForm)}>
                            {mostrarSenhaForm ? '🙈' : '👁️'}
                          </button>
                        </div>
                      </div>
                      <div className="input-wrapper">
                        <label className="input-label">Confirme a Senha *</label>
                        <div className="password-container">
                          <input type={mostrarSenhaForm ? "text" : "password"} name="confirmaSenha" value={formUsuario.confirmaSenha} onChange={(e) => setFormUsuario({...formUsuario, confirmaSenha: e.target.value})} required className="input-field" placeholder="••••••••" />
                        </div>
                      </div>
                    </div>
                    <button type="submit" disabled={carregandoRegistro} className="btn-primary" style={{ marginTop: '20px' }}>
                      {carregandoRegistro ? 'Salvando...' : 'Cadastrar na Equipe'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default App;