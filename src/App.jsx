import React, { useState, useEffect, useCallback } from 'react';
import Cadastro from './Cadastro.jsx';
import './App.css';

// ================= CONEXÃO COM O BANCO (via /api, Neon) =================
// O navegador não acessa o banco: tudo passa pelas rotas em /api, que conferem a sessão.
async function chamarApi(caminho, { metodo = 'GET', corpo, token } = {}) {
  const res = await fetch(caminho, {
    method: metodo,
    headers: {
      ...(corpo ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) {
    const erro = new Error(dados.error || `Erro ${res.status}`);
    erro.status = res.status;
    throw erro;
  }
  return dados;
}

// ================= GERADOR DE SENHA FORTE =================
function gerarSenhaForte(tamanho = 12) {
  const letrasMaiusculas = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const letrasMinusculas = 'abcdefghijklmnopqrstuvwxyz';
  const numeros = '0123456789';
  const simbolos = '!@#$%&*?';
  const todosCaracteres = letrasMaiusculas + letrasMinusculas + numeros + simbolos;
  
  let senha = '';
  senha += letrasMaiusculas[Math.floor(Math.random() * letrasMaiusculas.length)];
  senha += letrasMinusculas[Math.floor(Math.random() * letrasMinusculas.length)];
  senha += numeros[Math.floor(Math.random() * numeros.length)];
  senha += simbolos[Math.floor(Math.random() * simbolos.length)];
  
  for (let i = 4; i < tamanho; i++) {
    senha += todosCaracteres[Math.floor(Math.random() * todosCaracteres.length)];
  }
  return senha.split('').sort(() => 0.5 - Math.random()).join('');
}

function App() {
  // ================= SISTEMA DE NOTIFICAÇÕES (TOAST & DIALOG) =================
  const [toast, setToast] = useState(null);
  const [dialogoConfirmacao, setDialogoConfirmacao] = useState(null); 

  const exibirToast = (mensagem, tipo = 'sucesso') => {
    setToast({ mensagem, tipo });
    setTimeout(() => setToast(null), 5000); 
  };

  const confirmarAcao = (titulo, mensagem, acao) => {
    setDialogoConfirmacao({ titulo, mensagem, onConfirm: acao });
  };

  // ================= ESTADOS DE USUÁRIOS E LOGIN =================
  const [usuarioLogado, setUsuarioLogado] = useState(null); 
  const [credenciais, setCredenciais] = useState({ email: '', senha: '' });
  const [erroLogin, setErroLogin] = useState('');
  const [sucessoLogin, setSucessoLogin] = useState(''); 
  const [carregandoLogin, setCarregandoLogin] = useState(false);

  const [telaLogin, setTelaLogin] = useState('login'); 
  const [emailRecuperacao, setEmailRecuperacao] = useState('');
  
  const [cooldownRecuperacao, setCooldownRecuperacao] = useState(0);
  const [mostrarSenhaLogin, setMostrarSenhaLogin] = useState(false);
  const [mostrarSenhaForm, setMostrarSenhaForm] = useState(false);

  useEffect(() => {
    if (cooldownRecuperacao > 0) {
      const timerId = setTimeout(() => setCooldownRecuperacao(cooldownRecuperacao - 1), 1000);
      return () => clearTimeout(timerId);
    }
  }, [cooldownRecuperacao]);

  // ================= ESTADOS DO DASHBOARD DE USUÁRIOS =================
  const [usuariosCadastrados, setUsuariosCadastrados] = useState([]);
  const [abaGestao, setAbaGestao] = useState('lista'); 
  const [usuarioEditando, setUsuarioEditando] = useState(null);
  const [carregandoModal, setCarregandoModal] = useState(false);

  const [formUsuario, setFormUsuario] = useState({ nome: '', login: '', senha: '', confirmaSenha: '', email: '', setor: '', ativo: true });
  const [erroFormUser, setErroFormUser] = useState('');
  const [sucessoFormUser, setSucessoFormUser] = useState('');
  const [carregandoRegistro, setCarregandoRegistro] = useState(false);

  // ================= ESTADOS CORE =================
  const [modo, setModo] = useState('individual'); 
  const [historico, setHistorico] = useState([]);
  const [cadastrosRecentes, setCadastrosRecentes] = useState([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  // ================= ÍCONES SVG =================
  const IconeOlhoAberto = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
  );
  const IconeOlhoFechado = () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
  );

  const obterIniciais = (nomeStr) => {
    if (!nomeStr) return 'U';
    const partes = nomeStr.trim().split(' ');
    if (partes.length >= 2) return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
    return partes[0].substring(0, 2).toUpperCase();
  };

  // ================= LÓGICA DE USUÁRIOS =================
  const token = usuarioLogado?.token;
  const api = useCallback((caminho, opcoes = {}) => chamarApi(caminho, { ...opcoes, token }), [token]);

  const carregarUsuarios = async () => {
    try {
      setUsuariosCadastrados(await api('/api/usuarios'));
    } catch (err) {
      exibirToast(err.message, 'erro');
    }
  };

  useEffect(() => {
    if (modo === 'usuarios' && abaGestao === 'lista') carregarUsuarios();
  }, [modo, abaGestao]);

  const salvarEdicaoUsuario = async (e) => {
    e.preventDefault();
    setCarregandoModal(true);
    try {
      await api('/api/usuarios', { metodo: 'PATCH', corpo: {
        id: usuarioEditando.id,
        nome: usuarioEditando.nome,
        email: usuarioEditando.email,
        login: usuarioEditando.login,
        setor: usuarioEditando.setor,
        ativo: usuarioEditando.ativo
      } });

      exibirToast(`Dados de ${usuarioEditando.nome} atualizados.`, 'sucesso');
      setUsuarioEditando(null);
      carregarUsuarios();
    } catch {
      exibirToast('Erro ao atualizar usuário.', 'erro');
    } finally {
      setCarregandoModal(false);
    }
  };

  const solicitarNovaSenhaAleatoria = () => {
    confirmarAcao(
      'Gerar Nova Senha', 
      `Tem certeza que deseja redefinir o acesso de ${usuarioEditando.nome}?`,
      async () => {
        setCarregandoModal(true);
        try {
          const resultado = await api('/api/usuarios', { metodo: 'POST', corpo: { acao: 'nova-senha', id: usuarioEditando.id } });
          if (resultado.emailEnviado) {
            exibirToast(`Senha gerada e enviada para ${usuarioEditando.email}.`, 'sucesso');
          } else {
            exibirToast(`Senha de ${usuarioEditando.nome} alterada para: ${resultado.senha}`, 'sucesso');
          }
        } catch {
          exibirToast('Erro ao acessar o banco de dados.', 'erro');
        } finally {
          setCarregandoModal(false);
          setUsuarioEditando(null);
        }
      }
    );
  };

  const registrarNovoUsuario = async (e) => {
    e.preventDefault();
    setErroFormUser(''); setSucessoFormUser(''); setCarregandoRegistro(true);

    if (formUsuario.senha !== formUsuario.confirmaSenha) {
      setCarregandoRegistro(false);
      return setErroFormUser('As senhas não coincidem!');
    }

    try {
      const { emailEnviado } = await api('/api/usuarios', { metodo: 'POST', corpo: {
        nome: formUsuario.nome, login: formUsuario.login, senha: formUsuario.senha, email: formUsuario.email, setor: formUsuario.setor
      } });

      setSucessoFormUser(emailEnviado
        ? 'Colaborador cadastrado e credenciais enviadas por e-mail!'
        : 'Colaborador cadastrado, mas o e-mail não foi enviado. Repasse as credenciais manualmente.');
      setFormUsuario({ nome: '', login: '', senha: '', confirmaSenha: '', email: '', setor: '', ativo: true });
      setTimeout(() => { setAbaGestao('lista'); setSucessoFormUser(''); }, 2000); 
    } catch (error) {
      setErroFormUser(error.status === 409 ? error.message : 'Erro ao criar usuário: ' + error.message);
    } finally {
      setCarregandoRegistro(false);
    }
  };

  // ================= LÓGICA DE LOGIN & RECUPERAÇÃO =================
  const handleRecuperarSenha = async (e) => {
    e.preventDefault();
    setCarregandoLogin(true); setErroLogin(''); setSucessoLogin('');

    try {
      await chamarApi('/api/recuperar-senha', { metodo: 'POST', corpo: { email: emailRecuperacao } });
      setTelaLogin('login');
      setSucessoLogin(`Nova senha gerada e enviada para sua caixa de entrada.`);
      setCooldownRecuperacao(60);
      setEmailRecuperacao('');
    } catch (err) {
      setErroLogin(err.message);
    } finally {
      setCarregandoLogin(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setCarregandoLogin(true); setErroLogin(''); setSucessoLogin('');

    try {
      const { usuario, token } = await chamarApi('/api/login', { metodo: 'POST', corpo: { usuario: credenciais.email, senha: credenciais.senha } });
      setUsuarioLogado({ ...usuario, token });
      setCredenciais({ email: '', senha: '' });
    } catch (err) {
      setErroLogin(err.message);
    } finally {
      setCarregandoLogin(false);
    }
  };

  // ================= LÓGICA DE HISTÓRICO =================
  const carregarHistorico = async () => {
    setCarregandoHistorico(true);
    try {
      const [antigo, recentes] = await Promise.all([api('/api/historico'), api('/api/lotes').catch(() => [])]);
      setHistorico(antigo);
      setCadastrosRecentes(recentes);
    } catch (err) {
      exibirToast(err.message, 'erro');
    } finally {
      setCarregandoHistorico(false);
    }
  };

  useEffect(() => {
    if (modo === 'historico') carregarHistorico();
  }, [modo]);

  // ================= TELA DE LOGIN =================
  if (!usuarioLogado) {
    return (
      <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="b-card" style={{ maxWidth: '420px', padding: '3rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
            <h2 className="brand-font" style={{ color: 'var(--brand-gold)', fontSize: '2.5rem' }}>SKBiscoitê</h2>
            <p style={{ color: 'var(--text-mocha)', marginTop: '0.5rem' }}>Acesso Corporativo</p>
          </div>

          {erroLogin && <div style={{ background: '#FEF2F2', color: '#D9534F', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', textAlign: 'center', fontWeight: '500' }}>{erroLogin}</div>}
          {sucessoLogin && <div style={{ background: '#F0FDF4', color: '#7C9866', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', textAlign: 'center', fontWeight: '500' }}>{sucessoLogin}</div>}

          {telaLogin === 'login' ? (
            <form onSubmit={handleLogin} autoComplete="on">
              <div className="b-input-group">
                <label>Login ou E-mail</label>
                <input type="text" name="username" autoComplete="username" className="b-input" placeholder="nome@biscoite.com.br" value={credenciais.email} onChange={(e) => setCredenciais({...credenciais, email: e.target.value})} required />
              </div>
              <div className="b-input-group" style={{ position: 'relative' }}>
                <label>Senha</label>
                <input type={mostrarSenhaLogin ? "text" : "password"} name="password" autoComplete="current-password" className="b-input" placeholder="••••••••" value={credenciais.senha} onChange={(e) => setCredenciais({...credenciais, senha: e.target.value})} required style={{ paddingRight: '40px' }} />
                <button type="button" onClick={() => setMostrarSenhaLogin(!mostrarSenhaLogin)} style={{ position: 'absolute', right: '12px', top: '38px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mocha)' }}>
                  {mostrarSenhaLogin ? <IconeOlhoFechado /> : <IconeOlhoAberto />}
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem', marginBottom: '2rem' }}>
                <span onClick={() => { setTelaLogin('recuperar'); setErroLogin(''); setSucessoLogin(''); }} style={{ fontSize: '0.85rem', color: 'var(--brand-gold)', cursor: 'pointer', fontWeight: '500' }}>Esqueci minha senha</span>
              </div>
              <button type="submit" className="b-btn" style={{ width: '100%', justifyContent: 'center' }} disabled={carregandoLogin}>{carregandoLogin ? 'Autenticando...' : 'Acessar Sistema'}</button>
            </form>
          ) : (
            <form onSubmit={handleRecuperarSenha}>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-mocha)', marginBottom: '1.5rem', textAlign: 'center' }}>Digite seu e-mail para gerar uma nova senha provisória.</p>
              <div className="b-input-group">
                <label>E-mail Corporativo</label>
                <input type="email" value={emailRecuperacao} onChange={(e) => setEmailRecuperacao(e.target.value)} placeholder="nome@biscoite.com.br" className="b-input" required />
              </div>
              <button 
                type="submit" 
                className="b-btn" 
                style={{ 
                  width: '100%', 
                  justifyContent: 'center', 
                  marginTop: '1rem',
                  backgroundColor: cooldownRecuperacao > 0 ? '#6D5C53' : '',
                  cursor: (carregandoLogin || cooldownRecuperacao > 0) ? 'not-allowed' : 'pointer'
                }} 
                disabled={carregandoLogin || cooldownRecuperacao > 0}
              >
                {carregandoLogin ? 'Processando...' : cooldownRecuperacao > 0 ? `Aguarde ${cooldownRecuperacao}s` : 'Gerar Nova Senha'}
              </button>
              
              <button type="button" onClick={() => { setTelaLogin('login'); setErroLogin(''); }} className="b-btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: '1rem' }}>Voltar ao Login</button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const ehTI = usuarioLogado?.setor?.toUpperCase() === 'TI';

  return (
    <div className="app-container">
      {toast && (
        <div className={`b-toast ${toast.tipo === 'sucesso' ? 'b-toast-sucesso' : 'b-toast-erro'}`}>
          {toast.tipo === 'sucesso' ? '✔️' : '⚠️'} {toast.mensagem}
        </div>
      )}

      {dialogoConfirmacao && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(253, 251, 247, 0.8)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div className="b-card" style={{ maxWidth: '420px', textAlign: 'center', padding: '2rem' }}>
            <h3 className="brand-font" style={{ marginBottom: '1rem', fontSize: '1.4rem' }}>{dialogoConfirmacao.titulo}</h3>
            <p style={{ color: 'var(--text-mocha)', marginBottom: '2rem', fontSize: '0.95rem' }}>{dialogoConfirmacao.mensagem}</p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem' }}>
              <button className="b-btn-ghost" onClick={() => setDialogoConfirmacao(null)}>Cancelar</button>
              <button className="b-btn" onClick={() => { dialogoConfirmacao.onConfirm(); setDialogoConfirmacao(null); }}>Confirmar Ação</button>
            </div>
          </div>
        </div>
      )}

      <aside className="sidebar">
        <div style={{ marginBottom: '1rem' }}>
          <h2 className="brand-font" style={{ color: 'var(--brand-gold)', fontSize: '2rem', margin: 0 }}>Biscoitê</h2>
          <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-mocha)', fontWeight: 'bold' }}>SKU Management</span>
        </div>
        
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '2rem' }}>
          <button onClick={() => setModo('individual')} style={{ background: modo === 'individual' ? 'var(--bg-vanilla)' : 'transparent', color: modo === 'individual' ? 'var(--brand-gold)' : 'var(--text-espresso)', border: modo === 'individual' ? '1px solid var(--border-cream)' : '1px solid transparent', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}>
            Gerador Individual
          </button>
          
          <button onClick={() => setModo('massa')} style={{ background: modo === 'massa' ? 'var(--bg-vanilla)' : 'transparent', color: modo === 'massa' ? 'var(--brand-gold)' : 'var(--text-espresso)', border: modo === 'massa' ? '1px solid var(--border-cream)' : '1px solid transparent', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}>
            Importação em Massa
          </button>

          {ehTI && (
            <>
              <button onClick={() => setModo('usuarios')} style={{ background: modo === 'usuarios' ? 'var(--bg-vanilla)' : 'transparent', color: modo === 'usuarios' ? 'var(--brand-gold)' : 'var(--text-espresso)', border: modo === 'usuarios' ? '1px solid var(--border-cream)' : '1px solid transparent', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}>
                Gestão de Equipe
              </button>
              <button onClick={() => setModo('historico')} style={{ background: modo === 'historico' ? 'var(--bg-vanilla)' : 'transparent', color: modo === 'historico' ? 'var(--brand-gold)' : 'var(--text-espresso)', border: modo === 'historico' ? '1px solid var(--border-cream)' : '1px solid transparent', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', textAlign: 'left', fontWeight: '500', cursor: 'pointer', transition: 'all 0.2s', width: '100%' }}>
                Histórico & Auditoria
              </button>
            </>
          )}
        </nav>

        <div style={{ marginTop: 'auto', borderTop: '1px solid var(--border-cream)', paddingTop: '1.5rem' }}>
          <button onClick={() => { setUsuarioLogado(null); setModo('individual'); }} className="b-btn-ghost" style={{ width: '100%', justifyContent: 'flex-start' }}>
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
            Encerrar Sessão
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="top-header">
          <div>
            <h1 className="brand-font">
              {modo === 'individual' && 'Novo SKU'}
              {modo === 'massa' && 'Importação em Lote'}
              {modo === 'usuarios' && 'Gestão de Equipe'}
              {modo === 'historico' && 'Logs do Sistema'}
            </h1>
            <p>Cadastro integrado: Omie ERP e Nexaas OMS.</p>
          </div>
          
          <div className="user-profile-widget">
            <div className="user-info">
              <div className="user-name">{usuarioLogado.nome}</div>
              <div className="user-role">{usuarioLogado.setor}</div>
            </div>
            <div className="user-avatar">{obterIniciais(usuarioLogado.nome)}</div>
          </div>
        </header>

        {(modo === 'individual' || modo === 'massa') && <Cadastro modo={modo} api={api} exibirToast={exibirToast} />}

        {modo === 'usuarios' && ehTI && (
          <div className="b-card fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 className="brand-font" style={{ fontSize: '1.4rem' }}>{abaGestao === 'lista' ? 'Colaboradores' : 'Novo Colaborador'}</h3>
              {abaGestao === 'lista' ? (
                <button className="b-btn" onClick={() => setAbaGestao('criar')}>+ Adicionar Usuário</button>
              ) : (
                <button className="b-btn-ghost" onClick={() => setAbaGestao('lista')}>Voltar para Tabela</button>
              )}
            </div>

            {abaGestao === 'lista' ? (
              <div className="b-table-wrapper">
                <table className="b-table">
                  <thead>
                    <tr>
                      <th>Colaborador</th>
                      <th>Login / Acesso</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usuariosCadastrados.map(user => (
                      <tr key={user.id}>
                        <td style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <div style={{ width: '36px', height: '36px', borderRadius: '50%', background: 'var(--bg-vanilla)', border: '1px solid var(--border-cream)', color: 'var(--brand-gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.85rem' }}>
                            {obterIniciais(user.nome)}
                          </div>
                          <div>
                            <div style={{ fontWeight: '600' }}>{user.nome}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-mocha)' }}>{user.email}</div>
                          </div>
                        </td>
                        <td>{user.login} <br/><span style={{fontSize: '0.75rem', color: 'var(--text-mocha)'}}>Setor: {user.setor}</span></td>
                        <td><span className={`b-badge ${user.ativo === false ? 'badge-inativo' : 'badge-ativo'}`}>{user.ativo === false ? 'INATIVO' : 'ATIVO'}</span></td>
                        <td style={{ textAlign: 'right' }}>
                          <button onClick={() => setUsuarioEditando({ ...user })} className="b-btn-ghost" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                            ✏️ Editar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <form onSubmit={registrarNovoUsuario} style={{ maxWidth: '600px', margin: '0 auto', background: 'var(--bg-vanilla)', padding: '2rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-cream)' }}>
                {erroFormUser && <div style={{ background: '#FEF2F2', color: '#D9534F', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', fontWeight: '500' }}>{erroFormUser}</div>}
                {sucessoFormUser && <div style={{ background: '#F0FDF4', color: '#7C9866', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', fontWeight: '500' }}>{sucessoFormUser}</div>}
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
                  <div className="b-input-group"><label>Nome Completo</label><input type="text" name="nome" value={formUsuario.nome} onChange={(e) => setFormUsuario({...formUsuario, nome: e.target.value})} className="b-input" required /></div>
                  <div className="b-input-group"><label>E-mail Corporativo</label><input type="email" name="email" value={formUsuario.email} onChange={(e) => setFormUsuario({...formUsuario, email: e.target.value})} className="b-input" required /></div>
                  <div className="b-input-group"><label>Login</label><input type="text" name="login" value={formUsuario.login} onChange={(e) => setFormUsuario({...formUsuario, login: e.target.value})} className="b-input" required /></div>
                  <div className="b-input-group">
                    <label>Setor</label>
                    <select name="setor" value={formUsuario.setor} onChange={(e) => setFormUsuario({...formUsuario, setor: e.target.value})} className="b-input" required>
                      <option value="">Selecione...</option>
                      <option value="TI">TI</option>
                      <option value="Fabrica">Fábrica</option>
                      <option value="Produtos">Produtos</option>
                      <option value="Comercial">Comercial</option>
                    </select>
                  </div>
                  
                  <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-start', marginTop: '-10px', marginBottom: '-5px' }}>
                    <button type="button" onClick={() => {
                      const senhaGerada = gerarSenhaForte();
                      setFormUsuario({...formUsuario, senha: senhaGerada, confirmaSenha: senhaGerada});
                    }} className="b-btn-ghost" style={{ padding: '0.4rem 0.8rem', color: 'var(--brand-gold)', fontSize: '0.85rem' }}>
                      🎲 Gerar Senha Aleatória
                    </button>
                  </div>

                  <div className="b-input-group" style={{ position: 'relative' }}>
                    <label>Senha</label>
                    <input type={mostrarSenhaForm ? "text" : "password"} name="senha" value={formUsuario.senha} onChange={(e) => setFormUsuario({...formUsuario, senha: e.target.value})} className="b-input" required />
                    <button type="button" onClick={() => setMostrarSenhaForm(!mostrarSenhaForm)} style={{ position: 'absolute', right: '12px', top: '33px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-mocha)' }}>{mostrarSenhaForm ? <IconeOlhoFechado /> : <IconeOlhoAberto />}</button>
                  </div>
                  <div className="b-input-group" style={{ position: 'relative' }}>
                    <label>Confirmar Senha</label>
                    <input type={mostrarSenhaForm ? "text" : "password"} name="confirmaSenha" value={formUsuario.confirmaSenha} onChange={(e) => setFormUsuario({...formUsuario, confirmaSenha: e.target.value})} className="b-input" required />
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button type="submit" disabled={carregandoRegistro} className="b-btn">{carregandoRegistro ? 'Salvando...' : 'Cadastrar Colaborador'}</button>
                </div>
              </form>
            )}
          </div>
        )}

        {modo === 'historico' && ehTI && (
          <>
            <div className="b-card fade-in" style={{ marginBottom: '1.25rem' }}>
              <h3 className="brand-font" style={{ fontSize: '1.4rem', marginBottom: '1.5rem' }}>Cadastros (Omie → Nexaas)</h3>
              <div className="b-table-wrapper">
                <table className="b-table">
                  <thead><tr><th>Código</th><th>Produto</th><th>Família</th><th>Omie</th><th>Nexaas</th><th>Quem</th><th>Quando</th></tr></thead>
                  <tbody>
                    {carregandoHistorico ? <tr><td colSpan="7" style={{ textAlign: 'center' }}>Carregando dados...</td></tr> :
                      cadastrosRecentes.length === 0 ? <tr><td colSpan="7" style={{ textAlign: 'center' }}>Nenhum cadastro novo ainda.</td></tr> :
                      cadastrosRecentes.map(c => (
                        <tr key={c.id}>
                          <td style={{ fontWeight: '600', color: 'var(--brand-gold)' }}>{c.codigo || '—'}</td>
                          <td>{c.descricao}</td>
                          <td>{c.familia_omie}</td>
                          <td title={c.omie_erro || ''}>{c.omie_status === 'ok' ? '✓ ok' : c.omie_status === 'erro' ? '✗ erro' : c.omie_status}</td>
                          <td title={c.nexaas_erro || ''}>{c.nexaas_status === 'ok' ? '✓ ok' : c.nexaas_status === 'erro' ? '✗ erro' : c.nexaas_status}</td>
                          <td>{c.usuario_email}</td>
                          <td style={{ color: 'var(--text-mocha)', fontSize: '0.85rem' }}>{new Date(c.criado_em).toLocaleString('pt-BR')}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="b-card fade-in">
              <h3 className="brand-font" style={{ fontSize: '1.4rem', marginBottom: '1.5rem' }}>Registros anteriores</h3>
              <div className="b-table-wrapper">
                <table className="b-table">
                  <thead><tr><th>SKU Gerado</th><th>Descrição Registrada</th><th>Usuário (Responsável)</th><th>Data</th></tr></thead>
                  <tbody>
                    {carregandoHistorico ? <tr><td colSpan="4" style={{ textAlign: 'center' }}>Carregando dados...</td></tr> :
                      historico.length === 0 ? <tr><td colSpan="4" style={{ textAlign: 'center' }}>Nenhum registro encontrado.</td></tr> :
                      historico.map(log => (
                        <tr key={log.id}>
                          <td style={{ fontWeight: '600', color: 'var(--brand-gold)' }}>{log.sku}</td>
                          <td>{log.descricao}</td>
                          <td>{log.email_usuario}</td>
                          <td style={{ color: 'var(--text-mocha)', fontSize: '0.85rem' }}>{new Date(log.criado_em).toLocaleDateString('pt-BR')}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ================= MODAL DE EDIÇAO DE USUÁRIO ================= */}
      {usuarioEditando && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(253, 251, 247, 0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="b-card" style={{ maxWidth: '540px', boxShadow: 'var(--shadow-float)' }}>
            <h3 className="brand-font" style={{ marginBottom: '0.5rem' }}>Perfil do Colaborador</h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-mocha)', marginBottom: '1.5rem' }}>Edite os dados, bloqueie o acesso ou redefina a senha de <strong>{usuarioEditando.nome}</strong>.</p>
            
            <form onSubmit={salvarEdicaoUsuario}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div className="b-input-group">
                  <label>Nome</label>
                  <input type="text" className="b-input" value={usuarioEditando.nome} onChange={(e) => setUsuarioEditando({...usuarioEditando, nome: e.target.value})} required />
                </div>
                <div className="b-input-group">
                  <label>E-mail</label>
                  <input type="email" className="b-input" value={usuarioEditando.email} onChange={(e) => setUsuarioEditando({...usuarioEditando, email: e.target.value})} required />
                </div>
                <div className="b-input-group">
                  <label>Login</label>
                  <input type="text" className="b-input" value={usuarioEditando.login} onChange={(e) => setUsuarioEditando({...usuarioEditando, login: e.target.value})} required />
                </div>
                <div className="b-input-group">
                  <label>Setor</label>
                  <select className="b-input" value={usuarioEditando.setor} onChange={(e) => setUsuarioEditando({...usuarioEditando, setor: e.target.value})} required>
                    <option value="TI">TI</option>
                    <option value="Fabrica">Fábrica</option>
                    <option value="Produtos">Produtos</option>
                    <option value="Comercial">Comercial</option>
                  </select>
                </div>
                <div className="b-input-group">
                  <label>Status da Conta</label>
                  <select className="b-input" value={usuarioEditando.ativo !== false ? 'ativo' : 'inativo'} onChange={(e) => setUsuarioEditando({...usuarioEditando, ativo: e.target.value === 'ativo'})} required>
                    <option value="ativo">Ativo (Permitir Login)</option>
                    <option value="inativo">Inativo (Bloqueado)</option>
                  </select>
                </div>
              </div>

              <div style={{ padding: '1.5rem', background: 'var(--bg-vanilla)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-cream)', marginBottom: '1.5rem', textAlign: 'center' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-mocha)', marginBottom: '0.8rem' }}>Precisa redefinir o acesso deste usuário?</p>
                <button type="button" onClick={solicitarNovaSenhaAleatoria} className="b-btn-ghost" style={{ color: 'var(--brand-gold)' }}>
                  🔑 Gerar Senha Aleatória e Enviar por E-mail
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                <button type="button" className="b-btn-ghost" onClick={() => setUsuarioEditando(null)}>Cancelar</button>
                <button type="submit" className="b-btn" disabled={carregandoModal}>{carregandoModal ? 'Salvando...' : 'Salvar Perfil'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;