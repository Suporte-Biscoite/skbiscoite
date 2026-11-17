import { useCallback, useEffect, useState } from 'react';
import './Cadastro.css';
import './Solicitacoes.css';

const ESTADOS = { proposta: 'Proposta (nada foi alterado)', bloqueada: 'Bloqueada', aplicando: 'Aplicando…', aplicada: 'Aplicada', erro: 'Falhou (pode tentar de novo)', desfeita: 'Desfeita' };
const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

// Prévia (antes e depois), verificações de segurança e aprovação de UMA correção.
export function CorrecaoDetalhe({ api, exibirToast, correcao, ativa, aoMudar }) {
  const [ocupado, setOcupado] = useState(false);
  const [confirmou, setConfirmou] = useState(false);
  const c = correcao;
  const naoVerificado = c.nao_verificado || [];
  const executar = async (acao, corpo, msg) => {
    setOcupado(true);
    try { const r = await api('/api/solicitacoes', { metodo: 'POST', corpo: { acao, correcaoId: c.id, ...corpo } }); exibirToast(msg); aoMudar(r); } catch (e) { exibirToast(e.message, 'erro'); aoMudar(); } finally { setOcupado(false); }
  };
  const e = c.verificacoes?.estoque;
  return (
    <div className="sol-correcao">
      <p className="sol-meta sol-meta--sem-margem"><strong>Correção #{c.id}</strong> · código {c.codigo} · {ESTADOS[c.estado] || c.estado}</p>
      <dl className="cad-previa sol-previa">
        <div><dt>Antes</dt><dd>{c.antes?.descricao} (ativo)</dd></div>
        <div><dt>Depois</dt><dd>{c.depois?.descricao} (inativo)</dd></div>
        <div><dt>Estoque no Omie</dt><dd>{e ? `saldo ${e.saldo}, reservado ${e.reservado}, pendente ${e.pendentes}` : 'não foi possível ler' + (c.verificacoes?.erroEstoque ? ` (${c.verificacoes.erroEstoque})` : '')}</dd></div>
        <div><dt>No Nexaas</dt><dd>{c.nexaas?.existe ? `existe com este código (produto ${c.nexaas.id}). O Nexaas não é alterado por aqui: ajuste lá se precisar.` : c.nexaas?.existe === false ? 'não existe com este código' : 'não foi possível conferir'}</dd></div>
      </dl>
      {(c.bloqueios || []).length > 0 && <div className="cad-erro" role="alert"><strong>Bloqueada:</strong> {c.bloqueios.join(' ')} Resolva isso no Omie antes de corrigir.</div>}
      {naoVerificado.length > 0 && c.estado !== 'aplicada' && c.estado !== 'desfeita' && (
        <div className="sol-motivos" role="note">
          <strong>O sistema não consegue verificar sozinho: {naoVerificado.join(', ')}.</strong> O Omie não permite buscar isso por produto. Confira no Omie (Relatórios, Pedidos, Notas) e confirme abaixo.
          <label className="sol-incluir"><input type="checkbox" checked={confirmou} onChange={(ev) => setConfirmou(ev.target.checked)} /> Conferi no Omie: este código não tem pedidos, notas nem movimentações.</label>
        </div>
      )}
      {c.erro && <div className="cad-erro" role="alert">{c.erro}</div>}
      {!ativa && ['proposta', 'erro'].includes(c.estado) && <p className="sol-meta">A aplicação está desligada no servidor (OMIE_CORRECAO_ATIVA). Ligue só depois de testar com um produto de teste.</p>}
      <div className="sol-botoes">
        {['proposta', 'erro'].includes(c.estado) && (
          <button type="button" className="b-btn" disabled={ocupado || !ativa || (c.bloqueios || []).length > 0 || (naoVerificado.length > 0 && !confirmou)}
            onClick={() => window.confirm(`Aprovar vai RENOMEAR o cadastro ${c.codigo} para "${c.depois?.descricao}" e INATIVÁ-LO no Omie. Dá para desfazer. Continuar?`) && executar('correcao-aplicar', { confirmouConferencia: confirmou }, 'Cadastro antigo corrigido.')}>
            {ocupado ? 'Aplicando…' : 'Aprovar e corrigir'}
          </button>
        )}
        {c.estado === 'aplicada' && <button type="button" className="b-btn-outline cad-mini" disabled={ocupado || !ativa} onClick={() => window.confirm('Desfazer devolve o nome e a situação de antes no Omie. Continuar?') && executar('correcao-desfazer', {}, 'Correção desfeita.')}>Desfazer</button>}
      </div>
      {c.aprovado_por && <p className="sol-meta">Aprovada por {c.aprovado_por} em {quando(c.aprovado_em)}{c.aplicado_em ? ` · aplicada em ${quando(c.aplicado_em)}` : ''}{c.desfeito_em ? ` · desfeita por ${c.desfeito_por} em ${quando(c.desfeito_em)}` : ''}</p>}
    </div>
  );
}

// Botão dentro do pedido: propõe a correção do cadastro antigo (só leitura) e mostra a prévia.
export function CorrigirCadastroAntigo({ api, exibirToast, codigo, solicitacaoId }) {
  const [correcao, setCorrecao] = useState(null);
  const [ativa, setAtiva] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const propor = async () => {
    setOcupado(true);
    try {
      const r = await api('/api/solicitacoes', { metodo: 'POST', corpo: { acao: 'correcao-propor', codigo, solicitacaoId } });
      setAtiva(!!r.correcaoAtiva); setCorrecao(r);
    } catch (e) { exibirToast(e.message, 'erro'); } finally { setOcupado(false); }
  };
  if (!correcao) return <button type="button" className="b-btn-outline cad-mini" onClick={propor} disabled={ocupado}>{ocupado ? 'Lendo o Omie…' : `Corrigir cadastro antigo (${codigo})`}</button>;
  return <CorrecaoDetalhe api={api} exibirToast={exibirToast} correcao={correcao} ativa={ativa} aoMudar={async () => { try { const l = await api('/api/solicitacoes?correcoes=1'); setAtiva(l.ativa); setCorrecao(l.lista.find((x) => x.id === correcao.id) || correcao); } catch { /* mantém a tela */ } }} />;
}

// Lista geral (na tela de Solicitações): correções feitas e busca de cadastros fora da faixa.
export default function CorrecoesPainel({ api, exibirToast }) {
  const [dados, setDados] = useState(null);
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState(false);
  const carregar = useCallback(() => api('/api/solicitacoes?correcoes=1' + (busca ? '&busca=' + encodeURIComponent(busca) : '')).then(setDados).catch(() => setDados({ ativa: false, lista: [], suspeitos: [] })), [api, busca]);
  useEffect(() => {
    if (!aberta) return undefined;
    const t = setTimeout(() => { carregar(); }, busca ? 350 : 0);
    return () => clearTimeout(t);
  }, [aberta, busca, carregar]);
  return (
    <section className="b-card cad-secao fade-in">
      <details onToggle={(e) => setAberta(e.currentTarget.open)}>
        <summary className="brand-font">Cadastros antigos fora do padrão</summary>
        <p className="sol-meta">Produtos cadastrados no Omie com código fora das famílias (ex.: 10360). Corrigir renomeia para "CADASTRO ERRADO - … (INATIVO)" e inativa, sempre com aprovação de uma pessoa. Abra o pedido que cita o produto e use "Corrigir cadastro antigo".</p>
        {!dados ? <p className="cad-vazio">Carregando…</p> : (
          <>
            {dados.lista.length > 0 && <ul className="cad-lista">{dados.lista.map((c) => <li key={c.id} className="cad-linha"><div className="cad-linha__corpo"><CorrecaoDetalhe api={api} exibirToast={exibirToast} correcao={c} ativa={dados.ativa} aoMudar={carregar} /></div></li>)}</ul>}
            <input className="b-input" type="search" placeholder="Buscar cadastro fora do padrão por nome ou código" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar cadastro fora do padrão" />
            <ul className="cad-lista">{dados.suspeitos.map((p) => <li key={p.codigo} className="cad-linha"><div className="cad-linha__corpo"><strong>{p.codigo}</strong> <span>{p.descricao}</span></div></li>)}</ul>
            {dados.suspeitos.length === 60 && <p className="sol-meta">Mostrando os 60 primeiros. Use a busca.</p>}
          </>
        )}
      </details>
    </section>
  );
}
