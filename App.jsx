import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { createClient } from '@supabase/supabase-js';
import { FAMILIAS, resolverFamilia, obterFamiliaPorPrefixo, normalizarTexto } from './lib/familias.js';
import { cadastrarComVaga as cadastrarComVagaNoOmie, lerLinhasDaPlanilha, lerTodasAsPaginas } from './lib/skus.js';
import { montarModeloPlanilha } from './lib/modeloPlanilha.js';
import './App.css';

const pausa = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ================= CONEXÃO SUPABASE =================
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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
  const [formInd, setFormInd] = useState({ categoria: '200', descricao: '', ncm: '' });
  const [procInd, setProcInd] = useState(false);
  const [skuGerado, setSkuGerado] = useState(null);
  const [erroInd, setErroInd] = useState(null);

  const [dadosPlanilha, setDadosPlanilha] = useState([]);
  const [procMassa, setProcMassa] = useState(false);
  const [logsMassa, setLogsMassa] = useState([]);
  const [resumoMassa, setResumoMassa] = useState(null);
  const [statusOmie, setStatusOmie] = useState('');
  const cacheProdutos = useRef({ produtos: null, quando: 0 });

  const [historico, setHistorico] = useState([]);
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
  const carregarUsuarios = async () => {
    const { data } = await supabase.from('usuarios').select('*').order('nome', { ascending: true });
    if (data) setUsuariosCadastrados(data);
  };

  useEffect(() => {
    if (modo === 'usuarios' && abaGestao === 'lista') carregarUsuarios();
  }, [modo, abaGestao]);

  const salvarEdicaoUsuario = async (e) => {
    e.preventDefault();
    setCarregandoModal(true);
    try {
      const { error } = await supabase.from('usuarios').update({
        nome: usuarioEditando.nome,
        email: usuarioEditando.email,
        login: usuarioEditando.login,
        setor: usuarioEditando.setor,
        ativo: usuarioEditando.ativo
      }).eq('id', usuarioEditando.id);
      
      if (error) throw error;
      
      exibirToast(`Dados de ${usuarioEditando.nome} atualizados.`, 'sucesso');
      setUsuarioEditando(null);
      carregarUsuarios();
    } catch (err) {
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
        const novaSenha = gerarSenhaForte(); 
        try {
          await supabase.from('usuarios').update({ senha: novaSenha }).eq('id', usuarioEditando.id);
          try {
            const res = await fetch('/api/enviar-email', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: usuarioEditando.email, nome: usuarioEditando.nome, senha: novaSenha, login: usuarioEditando.login })
            });
            if (!res.ok) throw new Error('Falha no envio de e-mail');
            exibirToast(`Senha gerada e enviada para ${usuarioEditando.email}.`, 'sucesso');
          } catch (emailErr) {
            exibirToast(`Senha de ${usuarioEditando.nome} alterada para: ${novaSenha}`, 'sucesso');
          }
        } catch (err) {
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
      const { data: existente } = await supabase.from('usuarios').select('id').or(`email.eq.${formUsuario.email},login.eq.${formUsuario.login}`);
      if (existente && existente.length > 0) {
        setCarregandoRegistro(false);
        return setErroFormUser('Este e-mail ou login já está cadastrado.');
      }

      const { error } = await supabase.from('usuarios').insert([{
        nome: formUsuario.nome, login: formUsuario.login, senha: formUsuario.senha, email: formUsuario.email, setor: formUsuario.setor, ativo: true
      }]);
      if (error) throw error;

      try {
        await fetch('/api/enviar-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            email: formUsuario.email, 
            nome: formUsuario.nome, 
            senha: formUsuario.senha, 
            login: formUsuario.login 
          })
        });
      } catch (errEmail) {
        console.error("Aviso: E-mail de boas-vindas não foi enviado.", errEmail);
      }

      setSucessoFormUser(`Colaborador cadastrado e credenciais enviadas por e-mail!`);
      setFormUsuario({ nome: '', login: '', senha: '', confirmaSenha: '', email: '', setor: '', ativo: true });
      setTimeout(() => { setAbaGestao('lista'); setSucessoFormUser(''); }, 2000); 
    } catch (error) {
      setErroFormUser('Erro ao criar usuário: ' + error.message);
    } finally {
      setCarregandoRegistro(false);
    }
  };

  // ================= LÓGICA DE LOGIN & RECUPERAÇÃO =================
  const handleRecuperarSenha = async (e) => {
    e.preventDefault();
    setCarregandoLogin(true); setErroLogin(''); setSucessoLogin('');

    try {
      const { data: usuario } = await supabase.from('usuarios').select('id, nome, email, login').eq('email', emailRecuperacao).single();
      if (!usuario) {
        setErroLogin('E-mail não encontrado no sistema.');
        setCarregandoLogin(false);
        return;
      }
      
      const novaSenha = gerarSenhaForte();
      await supabase.from('usuarios').update({ senha: novaSenha }).eq('email', emailRecuperacao);

      try {
        const res = await fetch('/api/enviar-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: usuario.email, nome: usuario.nome, senha: novaSenha, login: usuario.login })
        });
        if (!res.ok) throw new Error('Falha no disparo do Resend');
        setTelaLogin('login');
        setSucessoLogin(`Nova senha gerada e enviada para sua caixa de entrada.`);
        setCooldownRecuperacao(60); 
      } catch (emailErr) {
        setTelaLogin('login');
        setSucessoLogin(`Atenção: E-mail indisponível. Sua nova senha é: ${novaSenha}`);
      }
      setEmailRecuperacao('');
    } catch (err) {
      setErroLogin('Erro ao comunicar com o banco de dados Supabase.');
    } finally {
      setCarregandoLogin(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setCarregandoLogin(true); setErroLogin(''); setSucessoLogin('');

    try {
      const { data } = await supabase.from('usuarios')
        .select('*')
        .or(`email.eq.${credenciais.email},login.eq.${credenciais.email}`)
        .eq('senha', credenciais.senha)
        .single();
      
      if (data) {
        if (data.ativo === false) {
          setErroLogin('Seu acesso está inativo. Contate o administrador.');
        } else {
          setUsuarioLogado(data);
          setCredenciais({ email: '', senha: '' });
        }
      } else {
        setErroLogin('Credenciais incorretas.');
      }
    } catch (err) {
      setErroLogin('Erro de comunicação. Verifique os dados.');
    } finally {
      setCarregandoLogin(false);
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

  // Lê UMA página do Omie, com limite de tempo e novas tentativas. Se não conseguir, interrompe
  // tudo: seguir com a lista incompleta faz o gerador propor códigos que já existem.
  const buscarPaginaOmie = async (pagina) => {
    const maxTentativas = 3;
    for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
      const controle = new AbortController();
      const timer = setTimeout(() => controle.abort(), 30000);
      try {
        const res = await fetch(`/api/codigos?pagina=${pagina}`, { signal: controle.signal });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.produtos)) return data;
        throw new Error(data.error || `HTTP ${res.status}`);
      } catch (err) {
        const motivo = err.name === 'AbortError' ? 'o Omie demorou mais de 30s para responder' : err.message;
        if (tentativa === maxTentativas) throw new Error(`Falha ao ler a página ${pagina} do Omie: ${motivo}`);
        await pausa(1000 * tentativa);
      } finally {
        clearTimeout(timer);
      }
    }
  };

  // Lista de produtos do Omie. Para o cadastro individual reaproveita a lista lida nos últimos
  // 5 minutos (os cadastros feitos aqui entram nela; se alguém criar um código por fora, o
  // sistema percebe a duplicidade e tenta o próximo). A importação em massa sempre lê de novo.
  const buscarTodosProdutosOmie = async ({ forcar = false } = {}) => {
    const cache = cacheProdutos.current;
    if (!forcar && cache.produtos && Date.now() - cache.quando < 5 * 60 * 1000) return cache.produtos;

    try {
      const produtos = await lerTodasAsPaginas(buscarPaginaOmie, {
        aoProgredir: (feitas, total) => setStatusOmie(`Lendo produtos do Omie (página ${feitas} de ${total})...`)
      });
      cacheProdutos.current = { produtos, quando: Date.now() };
      return produtos;
    } finally {
      setStatusOmie('');
    }
  };

  const cadastrarNoOmie = async ({ codigo, descricao, ncm, acao, familia, codigo_produto }) => {
    const ncmFormatado = ncm && ncm.toString().trim() !== '' ? ncm.toString().trim() : '1905.90.20';
    const res = await fetch('/api/cadastrar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo,
        descricao,
        preco: 0,
        ncm: ncmFormatado,
        acao,
        familia, // nome da família no Omie (ex: PRODUTOS PRONTOS)
        codigo_produto // só usado quando reaproveita um código em stand-by
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Erro no Omie.');
    return data;
  };

  const cadastrarComVaga = (params) => cadastrarComVagaNoOmie(cadastrarNoOmie, params);

  const handleChangeInd = (e) => {
    let val = e.target.value.toUpperCase();
    if (e.target.name === 'ncm') val = val.replace(/\D/g, '');
    setFormInd({ ...formInd, [e.target.name]: val });
  };

  const gerarECadastrarIndividual = async (e) => {
    e.preventDefault();
    setProcInd(true); setSkuGerado(null); setErroInd(null);
    try {
      const descFormatada = formInd.descricao.trim();
      const familia = obterFamiliaPorPrefixo(formInd.categoria);
      if (!familia) throw new Error('Selecione a família do produto.');

      const produtos = await buscarTodosProdutosOmie();
      const nomeNormalizado = normalizarTexto(descFormatada);
      if (produtos.some(prod => normalizarTexto(prod.descricao) === nomeNormalizado)) throw new Error(`Já existe um produto com este nome.`);

      const resultado = await cadastrarComVaga({ produtos, ocupados: new Set(), familia, descricao: descFormatada, ncm: formInd.ncm });

      setSkuGerado(resultado.codigo);
      await registrarHistorico(resultado.codigo, descFormatada);
      setFormInd({ categoria: formInd.categoria, descricao: '', ncm: '' });
    } catch (err) { setErroInd(err.message); } finally { setProcInd(false); }
  };

  const baixarPlanilhaModelo = async () => {
    const workbook = montarModeloPlanilha(ExcelJS);
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'Modelo_SKUs.xlsx'; anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const lerArquivoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const workbook = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
        const aba = workbook.Sheets[workbook.SheetNames[0]];
        const matriz = XLSX.utils.sheet_to_json(aba, { header: 1, defval: '' });
        const primeiraLinha = aba['!ref'] ? XLSX.utils.decode_range(aba['!ref']).s.r + 1 : 1;
        const linhas = lerLinhasDaPlanilha(matriz, primeiraLinha);
        if (linhas.length === 0) exibirToast('Nenhuma linha preenchida na planilha.', 'erro');
        setDadosPlanilha(linhas);
      } catch (err) {
        setDadosPlanilha([]);
        exibirToast(err.message, 'erro');
      }
      setLogsMassa([]); setResumoMassa(null);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // permite escolher o mesmo arquivo de novo depois de corrigir
  };

  const processarEmMassa = async () => {
    if (dadosPlanilha.length === 0) return exibirToast("Envie uma planilha válida.", "erro");
    setProcMassa(true); setLogsMassa([]); setResumoMassa(null);

    const registrar = (item) => setLogsMassa(prev => [...prev, item]);
    let criados = 0; let erros = 0;

    try {
      const produtos = await buscarTodosProdutosOmie({ forcar: true });
      const ocupados = new Set();
      const descricoesExistentes = new Set(produtos.map(p => normalizarTexto(p.descricao)).filter(Boolean));

      for (const linha of dadosPlanilha) {
        const rotulo = `Linha ${linha.linha}`;
        const descStr = linha.descricao.toUpperCase().trim();

        if (!linha.familia || !descStr) { erros++; registrar({ status: 'Erro', msg: `${rotulo}: faltam dados (família e descrição são obrigatórias).` }); continue; }

        const familia = resolverFamilia(linha.familia);
        if (!familia) { erros++; registrar({ status: 'Erro', desc: descStr, msg: `${rotulo}: família não reconhecida (${linha.familia}). Use uma da lista do modelo.` }); continue; }

        if (descricoesExistentes.has(normalizarTexto(descStr))) { erros++; registrar({ status: 'Erro', desc: descStr, msg: `${rotulo}: já existe no Omie (ou está repetido na planilha).` }); continue; }

        try {
          const resultado = await cadastrarComVaga({ produtos, ocupados, familia, descricao: descStr, ncm: linha.ncm });
          descricoesExistentes.add(normalizarTexto(descStr));
          criados++;
          const avisoFamilia = resultado.resp.familia_id ? '' : 'família não vinculada no Omie, confira o cadastro';
          registrar({ sku: resultado.codigo, desc: descStr, msg: avisoFamilia, status: resultado.acao === 'AlterarProduto' ? 'Sucesso (Sobrescrito)' : 'Sucesso' });
          await registrarHistorico(resultado.codigo, descStr).catch(() => {});
        } catch (err) {
          erros++;
          registrar({ sku: err.codigo, desc: descStr, status: 'Erro', msg: `${rotulo}: ${err.message}` });
        }

        await pausa(350); // respeita o limite de chamadas do Omie
      }
    } catch (err) { exibirToast(`Erro crítico na importação: ${err.message}`, "erro"); } finally { setResumoMassa({ criados, erros }); setProcMassa(false); setDadosPlanilha([]); }
  };

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
              {modo === 'massa' && 'Processamento em Lote'}
              {modo === 'usuarios' && 'Gestão de Equipe'}
              {modo === 'historico' && 'Logs do Sistema'}
            </h1>
            <p>Conectado ao ambiente corporativo Omie ERP.</p>
          </div>
          
          <div className="user-profile-widget">
            <div className="user-info">
              <div className="user-name">{usuarioLogado.nome}</div>
              <div className="user-role">{usuarioLogado.setor}</div>
            </div>
            <div className="user-avatar">{obterIniciais(usuarioLogado.nome)}</div>
          </div>
        </header>

        {modo === 'individual' && (
          <div className="b-card fade-in">
            <h3 className="brand-font" style={{ marginBottom: '1.5rem', fontSize: '1.4rem' }}>Novo Produto (Individual)</h3>
            {erroInd && <div style={{ background: '#FEF2F2', color: '#D9534F', padding: '1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.5rem', fontSize: '0.9rem', fontWeight: '500' }}>{erroInd}</div>}

            <form onSubmit={gerarECadastrarIndividual}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '1.5rem' }}>
                <div className="b-input-group">
                  <label>Família do Produto</label>
                  <select name="categoria" className="b-input" value={formInd.categoria} onChange={handleChangeInd} required>
                    <option value="">Selecione...</option>
                    {FAMILIAS.map(f => (
                      <option key={f.prefixo} value={f.prefixo}>{f.familia} ({f.prefixo} · {f.grupo})</option>
                    ))}
                  </select>
                </div>
                
                <div className="b-input-group">
                  <label>Descrição do Produto</label>
                  <input type="text" name="descricao" className="b-input" placeholder="Ex: LATA MASCARPONE 200G" value={formInd.descricao} onChange={handleChangeInd} required />
                </div>

                <div className="b-input-group">
                  <label>NCM (Apenas Números)</label>
                  <input type="text" name="ncm" className="b-input" placeholder="19059020" value={formInd.ncm} onChange={handleChangeInd} />
                </div>
              </div>
              <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" disabled={procInd} className="b-btn">{procInd ? (statusOmie || 'Cadastrando no Omie...') : 'Gerar e Sincronizar'}</button>
              </div>
            </form>

            {skuGerado && (
              <div style={{ marginTop: '2rem', padding: '2rem', background: 'var(--bg-vanilla)', border: '1px dashed var(--brand-gold)', borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-mocha)', fontWeight: 600 }}>CÓDIGO GERADO COM SUCESSO</span>
                <h1 style={{ color: 'var(--brand-gold)', fontSize: '2.5rem', marginTop: '0.5rem' }}>{skuGerado}</h1>
              </div>
            )}
          </div>
        )}

        {modo === 'massa' && (
          <div className="b-card fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 className="brand-font" style={{ fontSize: '1.4rem' }}>Importação via Excel</h3>
              <button onClick={baixarPlanilhaModelo} className="b-btn-ghost">Baixar Planilha Modelo</button>
            </div>
            
            <div style={{ border: '2px dashed var(--border-cream)', padding: '3rem', textAlign: 'center', borderRadius: 'var(--radius-md)', marginBottom: '2rem', background: 'var(--bg-vanilla)' }}>
              <p style={{ fontWeight: '500', marginBottom: '1rem' }}>Anexe sua planilha .xlsx preenchida aqui</p>
              <label className="b-btn" style={{ cursor: 'pointer' }}>Selecionar Arquivo<input type="file" accept=".xlsx, .xls" style={{ display: 'none' }} onChange={lerArquivoUpload} /></label>
            </div>

            <p style={{ fontSize: '0.85rem', color: 'var(--text-mocha)', marginBottom: '1.5rem' }}>
              Colunas: FAMILIA (escolha na lista: {FAMILIAS.map(f => f.familia).join(' · ')}), DESCRICAO e NCM. O código do SKU é gerado automaticamente pela família.
            </p>

            {dadosPlanilha.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
                <button onClick={processarEmMassa} disabled={procMassa} className="b-btn">{procMassa ? (statusOmie || `Processando ${dadosPlanilha.length} linhas...`) : `Iniciar Importação (${dadosPlanilha.length} itens)`}</button>
              </div>
            )}

            {resumoMassa && (
              <div style={{ marginBottom: '1rem', fontWeight: '600', color: resumoMassa.erros > 0 ? 'var(--danger-terracotta)' : 'var(--success-pistachio)' }}>
                {resumoMassa.criados} cadastrado(s) · {resumoMassa.erros} com erro
              </div>
            )}

            {logsMassa.length > 0 && (
              <div className="b-input-group">
                <label>Console de Logs</label>
                <div style={{ background: 'var(--bg-vanilla)', border: '1px solid var(--border-cream)', padding: '1rem', borderRadius: 'var(--radius-sm)', minHeight: '150px', maxHeight: '250px', overflowY: 'auto', fontSize: '0.9rem' }}>
                  {logsMassa.map((log, i) => (
                    <div key={i} style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-cream)', color: log.status.includes('Sucesso') ? 'var(--success-pistachio)' : 'var(--danger-terracotta)', fontWeight: '500' }}>
                      <strong>{log.sku || 'Aviso'}</strong> - {[log.desc, log.msg].filter(Boolean).join(' — ')}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
          <div className="b-card fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 className="brand-font" style={{ fontSize: '1.4rem' }}>Auditoria Global (Supabase)</h3>
            </div>
            
            <div className="b-table-wrapper">
              <table className="b-table">
                <thead>
                  <tr>
                    <th>SKU Gerado</th>
                    <th>Descrição Registrada</th>
                    <th>Usuário (Responsável)</th>
                    <th>Data</th>
                  </tr>
                </thead>
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