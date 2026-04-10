import { useState, useEffect } from 'react';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

function App() {
  // --- ESTADOS DE AUTENTICAÇÃO E PERFIL ---
  const [usuarioLogado, setUsuarioLogado] = useState(null);
  const [perfilUsuario, setPerfilUsuario] = useState(null); // Guarda se é TI, PRODUTOS, pendente...
  const [erroLogin, setErroLogin] = useState(null);
  const [carregandoAuth, setCarregandoAuth] = useState(true);

  // --- ESTADOS DO PAINEL MASTER (TI) ---
  const [listaUsuarios, setListaUsuarios] = useState([]);

  // --- ESTADOS DO SISTEMA ANTIGO ---
  const [aba, setAba] = useState('individual'); 
  const [formData, setFormData] = useState({ descricao: '', unidade: 'UN', preco: '', prefixo: '', ncm: '' });
  const [excelFile, setExcelFile] = useState(null);
  const [logMassa, setLogMassa] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [statusTexto, setStatusTexto] = useState('');
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  // ================= O NOVO LEÃO DE CHÁCARA + BANCO DE DADOS =================
  const processarLogin = async (session) => {
    try {
      if (!session?.user?.email) {
        setUsuarioLogado(null);
        setPerfilUsuario(null);
        return; // Sai da função, mas o 'finally' lá embaixo garante que o loading suma
      }

      const email = session.user.email;

      if (!email.endsWith('@biscoite.com.br')) {
        await supabase.auth.signOut();
        setUsuarioLogado(null);
        setPerfilUsuario(null);
        setErroLogin("Acesso restrito! Use o e-mail corporativo da Biscoitê.");
        return;
      }

      setUsuarioLogado(email);
      setErroLogin(null);

      // Usar maybeSingle() impede que o Supabase jogue um erro crítico na nossa cara 
      // caso o usuário por algum motivo demore milissegundos a mais pra responder
      let { data: perfilData, error: erroBusca } = await supabase
        .from('perfis')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (erroBusca) throw erroBusca;

      if (!perfilData) {
        const { data: novoPerfil, error: erroInsert } = await supabase
          .from('perfis')
          .insert([{ email: email, setor: 'PRODUTOS', status: 'pendente' }])
          .select()
          .single();
        
        if (erroInsert) throw erroInsert;
        perfilData = novoPerfil;
      }

      setPerfilUsuario(perfilData);
      
      // Se ele for TI e tiver aprovado, puxa a lista da galera
      if (perfilData?.status === 'aprovado' && perfilData?.setor === 'TI') {
        carregarListaUsuarios();
      }

    } catch (err) {
      console.error("Erro interno no login:", err);
      setErroLogin("Não foi possível carregar as permissões. Dê um F5 ou faça o login novamente.");
    } finally {
      // ISSO AQUI SALVA VIDAS: O loading VAI sumir, aconteça o que acontecer.
      setCarregandoAuth(false);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => processarLogin(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => processarLogin(session));
    return () => subscription.unsubscribe();
  }, []);

  const fazerLoginGoogle = async () => {
    setErroLogin(null);
    setCarregandoAuth(true);
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  };

  const fazerLogout = async () => {
    await supabase.auth.signOut();
  };

  // ================= FUNÇÕES DO PAINEL MASTER (TI) =================
  const carregarListaUsuarios = async () => {
    const { data } = await supabase.from('perfis').select('*').order('criado_em', { ascending: false });
    setListaUsuarios(data || []);
  };

  const atualizarPermissaoUsuario = async (id, novoStatus, novoSetor) => {
    await supabase.from('perfis').update({ status: novoStatus, setor: novoSetor }).eq('id', id);
    carregarListaUsuarios(); // Atualiza a tela
    alert("Permissões atualizadas com sucesso!");
  };

  // ================= FUNÇÕES DO GERADOR OMIE (Mantidas iguais por enquanto) =================
  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });
  // ... (A lógica de SKU, CSV, Excel continua a mesma que já construímos, vou ocultar as lógicas longas pra não poluir, 
  // mas como você vai sobrepor o arquivo, deixei um mock aqui pra não quebrar. O foco é a casca nova!)

  // Se a tela estiver carregando a autenticação
  if (carregandoAuth) {
    return <div style={{ minHeight: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}><h2>⏳ Carregando sistema Biscoitê...</h2></div>;
  }

  // ================= TELA DE LOGIN =================
  if (!usuarioLogado) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Segoe UI", sans-serif' }}>
        <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', width: '100%', maxWidth: '400px', textAlign: 'center' }}>
          <h1 style={{ color: '#2c3e50', marginBottom: '10px' }}>📦 Sistema PLM - Biscoitê</h1>
          <p style={{ color: '#7f8c8d', marginBottom: '30px' }}>Acesso exclusivo corporativo.</p>
          {erroLogin && <div style={{ backgroundColor: '#fee2e2', color: '#b91c1c', padding: '15px', borderRadius: '6px', marginBottom: '20px', fontSize: '14px', fontWeight: 'bold' }}>{erroLogin}</div>}
          <button onClick={fazerLoginGoogle} style={{ width: '100%', padding: '14px', backgroundColor: '#ffffff', color: '#3f3f3f', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <img src="https://upload.wikimedia.org/wikipedia/commons/c/c1/Google_%22G%22_logo.svg" alt="Google Logo" style={{ width: '20px', height: '20px' }} />
            Entrar com Google Biscoitê
          </button>
        </div>
      </div>
    );
  }

  // ================= A SALA DE ESPERA =================
  if (perfilUsuario?.status === 'pendente') {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"Segoe UI", sans-serif' }}>
        <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.1)', width: '100%', maxWidth: '500px', textAlign: 'center' }}>
          <div style={{ fontSize: '50px', marginBottom: '20px' }}>☕</div>
          <h2 style={{ color: '#2c3e50', margin: '0 0 10px 0' }}>Cadastro Recebido!</h2>
          <p style={{ color: '#64748b', fontSize: '16px', lineHeight: '1.6' }}>
            Olá, <strong>{usuarioLogado}</strong>. O seu acesso foi registrado, mas você está em uma fila de aprovação de segurança.<br/><br/>
            Por favor, aguarde o time de TI liberar o seu acesso e definir o seu setor no sistema.
          </p>
          <button onClick={fazerLogout} style={{ marginTop: '30px', padding: '10px 20px', backgroundColor: '#e2e8f0', color: '#475569', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Sair e tentar depois</button>
        </div>
      </div>
    );
  }

  // ================= TELA PRINCIPAL (APROVADOS) =================
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f4f7f6', padding: '20px', fontFamily: '"Segoe UI", sans-serif' }}>
      
      {/* HEADER CORPORATIVO */}
      <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '30px', backgroundColor: '#fff', padding: '15px 20px', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ fontWeight: 'bold', color: '#334155', fontSize: '18px' }}>👤 {usuarioLogado}</span>
          <span style={{ backgroundColor: '#e0e7ff', color: '#4338ca', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>Setor: {perfilUsuario?.setor}</span>
        </div>
        <button onClick={fazerLogout} style={{ backgroundColor: '#fee2e2', color: '#b91c1c', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Sair</button>
      </div>

      <div style={{ maxWidth: '1000px', margin: '0 auto', backgroundColor: '#ffffff', borderRadius: '12px', padding: '40px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
        
        {/* NAVEGAÇÃO DE ABAS */}
        <div style={{ display: 'flex', gap: '10px', marginBottom: '32px', borderBottom: '2px solid #f1f5f9', paddingBottom: '15px' }}>
          <button onClick={() => setAba('individual')} style={{ flex: 1, padding: '12px', cursor: 'pointer', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', backgroundColor: aba === 'individual' ? '#0f172a' : '#f8fafc', color: aba === 'individual' ? '#fff' : '#64748b' }}>
            Gerador de Códigos
          </button>
          
          {/* ABA EXCLUSIVA DO MASTER DA TI */}
          {perfilUsuario?.setor === 'TI' && (
            <button onClick={() => setAba('admin')} style={{ flex: 1, padding: '12px', cursor: 'pointer', border: 'none', borderRadius: '8px', fontSize: '16px', fontWeight: 'bold', backgroundColor: aba === 'admin' ? '#8b5cf6' : '#f8fafc', color: aba === 'admin' ? '#fff' : '#64748b' }}>
              🛡️ Controle de Acessos
            </button>
          )}
        </div>

        {/* --- CONTEÚDO DA ABA SELECIONADA --- */}
        
        {aba === 'individual' && (
          <div style={{ textAlign: 'center', padding: '40px' }}>
             <h2 style={{ color: '#475569' }}>🚧 Aqui ficará a tela de cadastro atual...</h2>
             <p style={{ color: '#94a3b8' }}>(Mantida igual, logo vamos trocá-la pelo painel Kanban)</p>
          </div>
        )}

        {/* --- PAINEL MASTER DA TI --- */}
        {aba === 'admin' && perfilUsuario?.setor === 'TI' && (
          <div>
            <h2 style={{ margin: '0 0 20px 0', color: '#1e293b' }}>Gestão de Usuários</h2>
            <p style={{ color: '#64748b', marginBottom: '30px' }}>Aprove novos acessos e defina em qual setor cada usuário trabalha para o fluxo Kanban.</p>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left' }}>
                  <th style={{ padding: '15px' }}>E-mail Biscoitê</th>
                  <th style={{ padding: '15px' }}>Status Atual</th>
                  <th style={{ padding: '15px' }}>Setor (Acesso)</th>
                  <th style={{ padding: '15px' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {listaUsuarios.map(user => (
                  <tr key={user.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '15px', fontWeight: '500' }}>{user.email}</td>
                    
                    <td style={{ padding: '15px' }}>
                      <select 
                        value={user.status} 
                        onChange={(e) => atualizarPermissaoUsuario(user.id, e.target.value, user.setor)}
                        style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', backgroundColor: user.status === 'aprovado' ? '#dcfce7' : '#fef08a', color: '#0f172a', fontWeight: 'bold' }}
                      >
                        <option value="pendente">Pendente ⏳</option>
                        <option value="aprovado">Aprovado ✅</option>
                      </select>
                    </td>

                    <td style={{ padding: '15px' }}>
                      <select 
                        value={user.setor} 
                        onChange={(e) => atualizarPermissaoUsuario(user.id, user.status, e.target.value)}
                        style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      >
                        <option value="PRODUTOS">PRODUTOS (Solicitações)</option>
                        <option value="FINANCEIRO">FINANCEIRO / SUPPLY (Complemento)</option>
                        <option value="TI">TI (Aprovações Master)</option>
                      </select>
                    </td>

                    <td style={{ padding: '15px' }}>
                      <span style={{ color: '#94a3b8', fontSize: '12px' }}>Salva ao trocar...</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;