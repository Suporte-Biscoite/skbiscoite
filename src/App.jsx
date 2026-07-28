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
  
  // Controle do "Olhinho" minimalista
  const [mostrarSenhaLogin, setMostrarSenhaLogin] = useState(false);
  const [mostrarSenhaForm, setMostrarSenhaForm] = useState(false);
  const [mostrarSenhaModal, setMostrarSenhaModal] = useState(false);

  // ================= ESTADOS DO DASHBOARD DE USUÁRIOS =================
  const [usuariosCadastrados, setUsuariosCadastrados] = useState([]);
  const [abaGestao, setAbaGestao] = useState('lista'); 
  
  // Estado do Modal de Edição de Senha
  const [usuarioModalSenha, setUsuarioModalSenha] = useState(null);
  const [novaSenhaModal, setNovaSenhaModal] = useState('');
  const [carregandoModal, setCarregandoModal] = useState(false);

  const [formUsuario, setFormUsuario] = useState({ nome: '', login: '', senha: '', confirmaSenha: '', email: '', setor: '' });
  const [erroFormUser, setErroFormUser] = useState('');
  const [sucessoFormUser, setSucessoFormUser] = useState('');
  const [carregandoRegistro, setCarregandoRegistro] = useState(false);

  // ================= ESTADOS CORE =================
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

  // ================= ÍCONES SVG MINIMALISTAS =================
  const IconeOlhoAberto = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  );

  const IconeOlhoFechado = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
      <line x1="1" y1="1" x2="23" y2="23"></line>
    </svg>
  );

  // ================= LÓGICA DE USUÁRIOS =================
  const carregarUsuarios = async () => {
    const { data } = await supabase.from('usuarios').select('*').order('nome', { ascending: true });
    if (data) setUsuariosCadastrados(data);
  };

  useEffect(() => {
    if (modo === 'usuarios' && abaGestao === 'lista') {
      carregarUsuarios();
    }
  }, [modo, abaGestao]);

  const salvarSenhaModalSubmit = async (e) => {
    e.preventDefault();
    if (!novaSenhaModal.trim()) return alert('A senha não pode estar vazia.');
    setCarregandoModal(true);

    try {
      const { error } = await supabase
        .from('usuarios')
        .update({ senha: novaSenhaModal })
        .eq('id', usuarioModalSenha.id);
      
      if (error) throw error;
      alert(`Senha alterada com sucesso para ${usuarioModalSenha.nome}!`);
      setUsuarioModalSenha(null);
      setNovaSenhaModal('');
      carregarUsuarios();
    } catch (err) {
      alert('Erro ao atualizar senha.');
    } finally {
      setCarregandoModal(false);
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
      const { data: usuario } = await supabase
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
      await supabase.from('usuarios').update({ senha: novaSenha }).eq('email', emailRecuperacao);

      alert(`[SIMULAÇÃO DE E-MAIL]\n\nPara: ${usuario.nome} (${usuario.email})\nNova senha de acesso: ${novaSenha}`);
      setTelaLogin('login');
      setSucessoLogin('Nova senha gerada com sucesso.');
      setEmailRecuperacao('');
    } catch (err) {
      setErroLogin('Erro ao processar a recuperação.');
    } finally {
      setCarregandoLogin(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    
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
      const { data } = await supabase
        .from('usuarios')
        .select('*')
        .or(`email.eq.${credenciais.email},login.eq.${credenciais.email}`)
        .eq('senha', credenciais.senha)
        .single();

      if (data) {
        setUsuarioLogado(data);
        setCredenciais({ email: '', senha: '' });
      } else {
        setErroLogin('Credenciais incorretas.');
      }
    } catch (err) {
      setErroLogin('Erro de comunicação com o servidor.');
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
      }, 2000); 
    } catch (error) {
      setErroFormUser('Erro ao criar usuário: ' + error.message);
    } finally {
      setCarregandoRegistro(false);
    }
  };

  // ================= LÓGICA DE HISTÓRICO E OMIE =================
  const registrarHistorico = async (sku, descricao) => {
    if (!usuarioLogado) return;
    await supabase.from('historico_skus').insert([{ email_usuario: usuarioLogado.email, sku, descricao }]);
  };

  const carregarHistorico = async () => {
    setCarregandoHistorico(true);
    const { data } = await supabase.from('historico_skus').select('*').order('criado_em', { ascending: false }).limit(100); 
    if (data) setHistorico(data);
    setCarregandoHistorico(false);
  };

  useEffect(() => {
    if (modo === 'historico') carregarHistorico();
  }, [modo]);

  const limparHistorico = async () => {
    if (window.confirm('Deseja apagar todo o histórico da nuvem?')) {
      await supabase.from('historico_skus').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      carregarHistorico();
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
    worksheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    
    worksheet.mergeCells('A2:C2');
    worksheet.getCell('A2').value = 'Módulo: Gestão de Produtos Biscoitê';
    worksheet.getCell('A2').font = { name: 'Arial', size: 11, color: { argb: 'FFFFFFFF' } };
    worksheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    
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
        <div className="main-card" style={{ maxWidth: '400px', margin: '0 auto', padding: '40px' }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            <h2 className="header-title" style={{ marginBottom: '6px' }}>Biscoitê</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: 0 }}>Gerenciamento Interno de SKUs</p>
          </div>
          
          {erroLogin && <div className="alert-error" style={{ marginBottom: '20px' }}>{erroLogin}</div>}
          {sucessoLogin && <div className="alert-success" style={{ marginBottom: '20px' }}>{sucessoLogin}</div>}

          {telaLogin === 'login' ? (
            <form className="form-group" onSubmit={handleLogin}>
              <div className="input-wrapper">
                <label className="input-label">E-mail ou Login</label>
                <input type="text" name="email" value={credenciais.email} onChange={(e) => setCredenciais({...credenciais, email: e.target.value})} placeholder="nome@biscoite.com.br" className="input-field" required />
              </div>
              <div className="input-wrapper">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="input-label">Senha</label>
                  <button type="button" onClick={() => { setTelaLogin('recuperar'); setErroLogin(''); setSucessoLogin(''); }} style={{ background: 'none', border: 'none', color: 'var(--navy-main)', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer', padding: 0 }}>
                    Esqueceu?
                  </button>
                </div>
                <div className="password-container">
                  <input type={mostrarSenhaLogin ? "text" : "password"} name="senha" value={credenciais.senha} onChange={(e) => setCredenciais({...credenciais, senha: e.target.value})} placeholder="••••••••" className="input-field" required />
                  <button type="button" className="eye-button" onClick={() => setMostrarSenhaLogin(!mostrarSenhaLogin)}>
                    {mostrarSenhaLogin ? <IconeOlhoFechado /> : <IconeOlhoAberto />}
                  </button>
                </div>
              </div>
              <button type="submit" disabled={carregandoLogin} className="btn-primary" style={{ marginTop: '10px' }}>
                {carregandoLogin ? 'Autenticando...' : 'Acessar Sistema'}
              </button>
            </form>
          ) : (
            <form className="form-group" onSubmit={handleRecuperarSenha}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '10px', lineHeight: '1.4' }}>
                Digite seu e-mail cadastrado para gerar uma nova senha provisória.
              </p>
              <div className="input-wrapper">
                <label className="input-label">E-mail Corporativo</label>
                <input type="email" value={emailRecuperacao} onChange={(e) => setEmailRecuperacao(e.target.value)} placeholder="nome@biscoite.com.br" className="input-field" required />
              </div>
              <button type="submit" disabled={carregandoLogin} className="btn-primary" style={{ marginTop: '10px' }}>
                {carregandoLogin ? 'Processando...' : 'Gerar Nova Senha'}
              </button>
              <button type="button" onClick={() => { setTelaLogin('login'); setErroLogin(''); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: '600', cursor: 'pointer', marginTop: '15px', width: '100%' }}>
                Voltar ao Login
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
            <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setMenuAberto(false)} />
            <div className="dropdown-menu" style={{ zIndex: 999 }}>
              <div className="dropdown-header">{usuarioLogado.nome}</div>
              <button className="dropdown-item" onClick={() => { setModo('usuarios'); setAbaGestao('lista'); setMenuAberto(false); }}>
                👥 Gestão de Equipe
              </button>
              <button className="dropdown-item" onClick={() => { setModo('historico'); setMenuAberto(false); }}>
                📄 Histórico de SKUs
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
                <button className={`tab-btn ${modo === 'massa' ? 'active' : ''}`} onClick={() => setModo('massa')}>Em Massa</button>
              </div>
            </header>
          ) : modo === 'historico' ? (
            <header style={{ marginBottom: '30px' }}>
              <button className="btn-back" onClick={() => setModo('individual')}>← Voltar para o Gerador</button>
              <h2 className="header-title" style={{ margin: 0 }}>Histórico da Nuvem</h2>
            </header>
          ) : null}

          {modo === 'individual' && (
            <div className="tab-content">
              {erroInd && <div className="alert-error" style={{ marginBottom: '20px' }}>{erroInd}</div>}
              <form onSubmit={gerarECadastrarIndividual} className="form-group">
                <div className="input-wrapper">
                  <label className="input-label">Prefixo (Categoria)</label>
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
                  <label className="input-label">Descrição do Produto</label>
                  <input type="text" name="descricao" value={formInd.descricao} onChange={handleChangeInd} required placeholder="EX: BISCOITO AMANTEIGADO" className="input-field" style={{ textTransform: 'uppercase' }} />
                </div>
                <div className="input-wrapper">
                  <label className="input-label">NCM (Opcional)</label>
                  <input type="text" name="ncm" value={formInd.ncm} onChange={handleChangeInd} placeholder="1905.90.20" className="input-field" />
                </div>
                <button type="submit" disabled={procInd} className="btn-primary" style={{ marginTop: '10px' }}>
                  {procInd ? 'Processando Integração...' : 'Gerar e Registrar SKU'}
                </button>
              </form>
              {skuGerado && (
                <div className="success-card">
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>CÓDIGO GERADO COM SUCESSO</span>
                  <h1>{skuGerado}</h1>
                </div>
              )}
            </div>
          )}

          {modo === 'massa' && (
            <div className="tab-content">
              <div className="step-container">
                <div>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: 'var(--navy-main)' }}>Planilha de Importação</p>
                  <small style={{ color: 'var(--text-muted)' }}>Baixe o modelo padrão compatível com o ERP Omie.</small>
                </div>
                <button onClick={baixarPlanilhaModelo} className="btn-secondary">Baixar Modelo</button>
              </div>
              <div className="input-wrapper" style={{ marginBottom: '20px' }}>
                <label className="input-label">Anexar Arquivo Excel (.XLSX)</label>
                <div className="upload-area">
                  <input type="file" accept=".xlsx, .xls" onChange={lerArquivoUpload} className="upload-input" />
                </div>
              </div>
              {dadosPlanilha.length > 0 && (
                <button onClick={processarEmMassa} disabled={procMassa} className="btn-primary">
                  {procMassa ? `Processando ${dadosPlanilha.length} linhas...` : `Iniciar Importação (${dadosPlanilha.length} itens)`}
                </button>
              )}
              {logsMassa.length > 0 && (
                <div className="logs-container">
                  <label className="input-label" style={{ marginBottom: '12px', display: 'block' }}>Resultados do Processamento</label>
                  <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
                    {logsMassa.map((log, i) => (
                      <div key={i} className={`log-item ${log.status.includes('Sucesso') ? 'log-success' : 'log-error'}`}>
                        <span><strong>{log.sku || 'Aviso'}</strong> - {log.desc || log.msg}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {modo === 'historico' && (
            <div className="tab-content">
              <div className="step-container" style={{ marginBottom: '20px' }}>
                <div>
                  <p style={{ margin: '0 0 4px 0', fontWeight: '600', color: 'var(--navy-main)' }}>Logs da Nuvem</p>
                  <small style={{ color: 'var(--text-muted)' }}>Registros gerados por toda a equipe via Supabase.</small>
                </div>
                <button onClick={limparHistorico} className="btn-secondary" style={{ color: '#EF4444', borderColor: '#FECACA' }}>Limpar Histórico</button>
              </div>
              
              {carregandoHistorico ? (
                <div className="upload-area"><p style={{ color: 'var(--text-muted)', margin: 0 }}>Carregando dados...</p></div>
              ) : historico.length === 0 ? (
                <div className="upload-area"><p style={{ color: 'var(--text-muted)', margin: 0 }}>Nenhum registro encontrado.</p></div>
              ) : (
                <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {historico.map((item) => (
                    <div key={item.id} style={{ padding: '14px 16px', background: '#FAFAFA', border: '1px solid var(--gray-border)', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span style={{ fontWeight: '700', color: 'var(--navy-main)', marginRight: '12px' }}>{item.sku}</span>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{item.descricao}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'block' }}>{new Date(item.criado_em).toLocaleDateString('pt-BR')}</span>
                        <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>{item.email_usuario}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* === GESTÃO DE PESSOAS (ESTILO ERP MODERNO) === */}
          {modo === 'usuarios' && (
            <div className="tab-content">
              <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px' }}>
                <div>
                  <button className="btn-back" onClick={() => setModo('individual')}>← Voltar para SKUs</button>
                  <h2 className="header-title" style={{ margin: 0 }}>Gestão de Pessoas</h2>
                </div>
                {abaGestao === 'lista' ? (
                  <button className="btn-primary" style={{ width: 'auto', padding: '10px 18px', fontSize: '0.85rem' }} onClick={() => setAbaGestao('criar')}>+ Novo Usuário</button>
                ) : (
                  <button className="btn-secondary" onClick={() => setAbaGestao('lista')}>Ver Tabela</button>
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
                        <th style={{ textAlign: 'right' }}>Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usuariosCadastrados.map((user) => (
                        <tr key={user.id}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                              <div style={{ width: '32px', height: '32px', borderRadius: '50%', backgroundColor: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 600, color: 'var(--navy-main)' }}>
                                {user.nome.charAt(0).toUpperCase()}
                              </div>
                              <span style={{ fontWeight: '600' }}>{user.nome}</span>
                            </div>
                          </td>
                          <td><span className="badge-setor">{user.setor}</span></td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: '500' }}>{user.login}</span>
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{user.email}</span>
                            </div>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button onClick={() => { setUsuarioModalSenha(user); setNovaSenhaModal(''); }} className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                              🔑 Alterar Senha
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ maxWidth: '540px', margin: '0 auto', background: '#F8FAFC', padding: '30px', borderRadius: '12px', border: '1px solid var(--gray-border)' }}>
                  {erroFormUser && <div className="alert-error" style={{ marginBottom: '20px' }}>{erroFormUser}</div>}
                  {sucessoFormUser && <div className="alert-success" style={{ marginBottom: '20px' }}>{sucessoFormUser}</div>}
                  <form onSubmit={registrarNovoUsuario} className="form-group">
                    <div className="form-row">
                      <div className="input-wrapper">
                        <label className="input-label">Nome Completo</label>
                        <input type="text" name="nome" value={formUsuario.nome} onChange={(e) => setFormUsuario({...formUsuario, nome: e.target.value})} required className="input-field" placeholder="Ex: João Silva" />
                      </div>
                      <div className="input-wrapper">
                        <label className="input-label">E-mail Corporativo</label>
                        <input type="email" name="email" value={formUsuario.email} onChange={(e) => setFormUsuario({...formUsuario, email: e.target.value})} required className="input-field" placeholder="joao@biscoite.com" />
                      </div>
                    </div>
                    <div className="form-row">
                      <div className="input-wrapper">
                        <label className="input-label">Login</label>
                        <input type="text" name="login" value={formUsuario.login} onChange={(e) => setFormUsuario({...formUsuario, login: e.target.value})} required className="input-field" placeholder="joao.silva" />
                      </div>
                      <div className="input-wrapper">
                        <label className="input-label">Setor</label>
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
                        <label className="input-label">Senha</label>
                        <div className="password-container">
                          <input type={mostrarSenhaForm ? "text" : "password"} name="senha" value={formUsuario.senha} onChange={(e) => setFormUsuario({...formUsuario, senha: e.target.value})} required className="input-field" placeholder="••••••••" />
                          <button type="button" className="eye-button" onClick={() => setMostrarSenhaForm(!mostrarSenhaForm)}>
                            {mostrarSenhaForm ? <IconeOlhoFechado /> : <IconeOlhoAberto />}
                          </button>
                        </div>
                      </div>
                      <div className="input-wrapper">
                        <label className="input-label">Confirmar Senha</label>
                        <div className="password-container">
                          <input type={mostrarSenhaForm ? "text" : "password"} name="confirmaSenha" value={formUsuario.confirmaSenha} onChange={(e) => setFormUsuario({...formUsuario, confirmaSenha: e.target.value})} required className="input-field" placeholder="••••••••" />
                        </div>
                      </div>
                    </div>
                    <button type="submit" disabled={carregandoRegistro} className="btn-primary" style={{ marginTop: '10px' }}>
                      {carregandoRegistro ? 'Salvando...' : 'Cadastrar Colaborador'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* === MODAL DE ALTERAÇÃO DE SENHA FLUTUANTE (DESIGN MODERNO) === */}
      {usuarioModalSenha && (
        <div className="modal-overlay" onClick={() => setUsuarioModalSenha(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 6px 0', color: 'var(--navy-main)', fontSize: '1.2rem' }}>Redefinir Senha</h3>
            <p style={{ margin: '0 0 20px 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Alterando credenciais de acesso para <strong>{usuarioModalSenha.nome}</strong>.
            </p>
            
            <form onSubmit={salvarSenhaModalSubmit} className="form-group">
              <div className="input-wrapper">
                <label className="input-label">Nova Senha</label>
                <div className="password-container">
                  <input 
                    type={mostrarSenhaModal ? "text" : "password"} 
                    value={novaSenhaModal} 
                    onChange={(e) => setNovaSenhaModal(e.target.value)} 
                    placeholder="Mínimo de caracteres" 
                    className="input-field" 
                    autoFocus 
                    required 
                  />
                  <button type="button" className="eye-button" onClick={() => setMostrarSenhaModal(!mostrarSenhaModal)}>
                    {mostrarSenhaModal ? <IconeOlhoFechado /> : <IconeOlhoAberto />}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                <button type="button" onClick={() => setUsuarioModalSenha(null)} className="btn-secondary" style={{ flex: 1 }}>
                  Cancelar
                </button>
                <button type="submit" disabled={carregandoModal} className="btn-primary" style={{ flex: 1, marginTop: 0 }}>
                  {carregandoModal ? 'Salvando...' : 'Salvar Senha'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default App;