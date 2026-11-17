import { useCallback, useEffect, useRef, useState } from 'react';
import './Cadastro.css';
import './Solicitacoes.css';

const STATUS = {
  recebida: ['Recebida', 'espera'],
  aguardando_analise: ['Aguardando análise', 'andando'],
  aprovada: ['Aprovada', 'ok'],
  processando: ['Processando', 'andando'],
  concluida: ['Códigos gerados', 'ok'],
  finalizada_clickup: ['Finalizada no ClickUp', 'ok'],
  cancelada_clickup: ['Cancelada no ClickUp', 'erro'],
  recusada: ['Recusada', 'erro'],
  erro: ['Erro', 'erro'],
};
const SUGESTAO = { automatica: ['Pequena e limpa', 'ok'], analise: ['Precisa de análise', 'andando'] };
const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const editavel = (s) => ['recebida', 'aguardando_analise'].includes(s.status);

function Chip({ par }) {
  const [texto, tom] = par || ['—', 'espera'];
  return <span className={`cad-chip cad-chip--${tom}`}>{texto}</span>;
}

export default function Solicitacoes({ api, exibirToast }) {
  const [lista, setLista] = useState(null);
  const [config, setConfig] = useState(null);
  const [filtros, setFiltros] = useState({ status: '', sugestao: '', busca: '' });
  const [aberta, setAberta] = useState(null); // detalhe da solicitação aberta
  const [itens, setItens] = useState([]);
  const [faixa, setFaixa] = useState('');
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [erro, setErro] = useState('');
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);

  const carregar = useCallback(async () => {
    try {
      const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
      const dados = await api(`/api/solicitacoes${q ? `?${q}` : ''}`);
      if (vivo.current) { setLista(dados); setErro(''); }
    } catch (e) { if (vivo.current) { setErro(e.message); setLista([]); } }
  }, [api, filtros]);
  useEffect(() => { const t = setTimeout(carregar, filtros.busca ? 350 : 0); return () => clearTimeout(t); }, [carregar, filtros.busca]);
  // Consulta o ClickUp ao abrir a tela e a cada 2 minutos (tarefas movidas para finalizado saem da fila sozinhas).
  useEffect(() => {
    let parou = false;
    const buscar = async () => {
      try {
        const r = await api('/api/solicitacoes', { metodo: 'POST', corpo: { acao: 'conferir' } });
        if (!parou && vivo.current && (r.novas || r.atualizadas || r.encerradas)) carregar();
      } catch { /* o botão "Buscar no ClickUp" mostra o erro */ }
    };
    buscar();
    const t = setInterval(buscar, 120000);
    return () => { parou = true; clearInterval(t); };
  }, [api, carregar]);
  useEffect(() => { api('/api/solicitacoes?config=1').then((c) => vivo.current && setConfig(c)).catch(() => {}); }, [api]);

  const abrir = async (id) => {
    setOcupado('abrindo');
    try {
      const d = await api(`/api/solicitacoes?id=${id}`);
      setAberta(d); setItens(d.itens); setFaixa(d.prefixo_codigo || ''); setRecusando(false); setMotivo('');
    } catch (e) { exibirToast(e.message, 'erro'); } finally { setOcupado(''); }
  };
  const fechar = () => { setAberta(null); carregar(); };

  const acao = async (nome, corpo, mensagem) => {
    setOcupado(nome);
    try {
      const r = await api('/api/solicitacoes', { metodo: 'POST', corpo: { acao: nome, id: aberta?.id, ...corpo } });
      if (mensagem) exibirToast(mensagem);
      return r;
    } catch (e) { exibirToast(e.message, 'erro'); return null; } finally { setOcupado(''); }
  };

  const salvar = async () => {
    const d = await acao('editar', { itens, prefixoCodigo: faixa || undefined }, 'Itens salvos.');
    if (d) { setAberta(d); setItens(d.itens); }
  };
  // Aprovar usa o que está na tela: se houve mudança, salva antes (assim o que foi aprovado é o que o time viu).
  const aprovar = async () => {
    const mudou = faixa !== (aberta.prefixo_codigo || '') || JSON.stringify(itens.map((i) => [i.descricao, i.incluido !== false])) !== JSON.stringify(aberta.itens.map((i) => [i.descricao, i.incluido !== false]));
    if (mudou) { const salvo = await acao('editar', { itens, prefixoCodigo: faixa || undefined }); if (!salvo) return; }
    const d = await acao('aprovar', {}, 'Aprovada. Nesta fase nada é criado no Omie.');
    if (d) { setAberta(d); setItens(d.itens); }
  };
  const recusar = async () => {
    const d = await acao('recusar', { motivo }, 'Solicitação recusada.');
    if (d) { setAberta(d); setRecusando(false); }
  };
  const reanalisar = async () => {
    const d = await acao('reanalisar', {}, 'Tarefa lida de novo no ClickUp.');
    if (d) { setAberta(d); setItens(d.itens); setFaixa(d.prefixo_codigo || ''); }
  };
  const conferir = async () => {
    const r = await acao('conferir', {});
    if (r) { exibirToast(`${r.lidas} tarefa(s) lidas: ${r.novas} nova(s), ${r.atualizadas} atualizada(s), ${r.encerradas ?? 0} encerrada(s).`); carregar(); }
  };
  const mudarConfig = async (mudanca) => {
    try { setConfig({ ...config, ...(await api('/api/solicitacoes', { metodo: 'POST', corpo: { acao: 'config', ...mudanca } })) }); } catch (e) { exibirToast(e.message, 'erro'); }
  };

  const mudarItem = (idx, mudanca) => setItens((l) => l.map((i, k) => (k === idx ? { ...i, ...mudanca } : i)));

  // ---------- Detalhe ----------
  if (aberta) {
    const podeEditar = editavel(aberta);
    const incluidos = itens.filter((i) => i.incluido !== false && i.descricao.trim()).length;
    return (
      <div className="cad sol">
        <section className="b-card cad-secao fade-in">
          <div className="cad-secao__topo">
            <button type="button" className="b-btn-ghost" onClick={fechar}>← Voltar</button>
            <div className="cad-linha__lado">
              <Chip par={STATUS[aberta.status]} /> <Chip par={SUGESTAO[aberta.sugestao]} />
            </div>
          </div>
          <h3 className="brand-font sol-titulo">{aberta.titulo}</h3>
          <p className="sol-meta">
            {aberta.solicitante && <>Solicitante: <strong>{aberta.solicitante}</strong> · </>}Recebida em {quando(aberta.recebido_em)} ·{' '}
            <a href={aberta.url} target="_blank" rel="noreferrer">Abrir no ClickUp ↗</a>
          </p>
          <dl className="cad-previa sol-previa">
            <div><dt>Família (campo)</dt><dd>{aberta.familia_campo || '—'}</dd></div>
            <div><dt>Faixa de código</dt><dd>{podeEditar ? <input className="b-input sol-faixa" inputMode="numeric" value={faixa} maxLength={4} onChange={(e) => setFaixa(e.target.value.replace(/\D/g, ''))} aria-label="Faixa de código" /> : aberta.prefixo_codigo || '—'}</dd></div>
            <div><dt>Tipo de identificação</dt><dd>{aberta.tipo_identificacao || '—'}</dd></div>
            <div><dt>Destino</dt><dd>{aberta.rota === 'importar' ? 'Importar do Omie' : 'Criar código novo'}</dd></div>
          </dl>
          {(aberta.motivos || []).length > 0 && (
            <div className="sol-motivos" role="note">
              <strong>Por que precisa de atenção</strong>
              <ul>{aberta.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          {aberta.motivo_recusa && <div className="cad-erro" role="note">Recusada por {aberta.decidido_por}: {aberta.motivo_recusa}</div>}
        </section>

        <section className="b-card cad-secao fade-in" aria-labelledby="sol-itens">
          <div className="cad-secao__topo">
            <h3 id="sol-itens" className="brand-font">Produtos lidos <span className="cad-contagem">{incluidos}</span></h3>
            {podeEditar && <button type="button" className="b-btn-ghost" onClick={() => setItens((l) => [...l, { descricao: '', incluido: true, avisos: [], parecidos: [] }])}>+ Adicionar linha</button>}
          </div>
          {itens.length === 0 ? <p className="cad-vazio">Nenhum produto foi lido nesta tarefa.</p> : (
            <ul className="cad-lista">
              {itens.map((i, k) => (
                <li key={i.id ?? `n${k}`} className={`cad-linha sol-item ${(i.avisos || []).length ? 'cad-linha--erro' : ''}`}>
                  <div className="cad-linha__corpo">
                    {podeEditar ? (
                      <input className="b-input" value={i.descricao} maxLength={140} aria-label={`Nome do produto ${k + 1}`} onChange={(e) => mudarItem(k, { descricao: e.target.value.toUpperCase() })} />
                    ) : <strong>{i.descricao}</strong>}
                    {(i.avisos || []).map((a) => <em key={a} className="cad-linha__problema">{a}</em>)}
                    {i.codigo_gerado && <span>Código: <strong>{i.codigo_gerado}</strong></span>}
                  </div>
                  {podeEditar && (
                    <div className="cad-linha__lado">
                      <label className="sol-incluir"><input type="checkbox" checked={i.incluido !== false} onChange={(e) => mudarItem(k, { incluido: e.target.checked })} /> Incluir</label>
                      <button type="button" className="cad-x" aria-label={`Remover ${i.descricao}`} onClick={() => setItens((l) => l.filter((_, x) => x !== k))}>×</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          {podeEditar && (
            <>
              {recusando ? (
                <div className="sol-recusa fade-in">
                  <label htmlFor="sol-motivo">Motivo da recusa</label>
                  <textarea id="sol-motivo" className="b-input" rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: separar por tipo de produto e reenviar" />
                  <div className="sol-botoes">
                    <button type="button" className="b-btn-ghost" onClick={() => setRecusando(false)}>Cancelar</button>
                    <button type="button" className="b-btn" onClick={recusar} disabled={!motivo.trim() || !!ocupado}>Confirmar recusa</button>
                  </div>
                </div>
              ) : (
                <div className="cad-rodape sol-botoes">
                  <span>{config?.modo === 'automatico' ? '' : 'Modo só analisar: aprovar não cria código no Omie.'}</span>
                  <div className="sol-botoes">
                    <button type="button" className="b-btn-outline cad-mini" onClick={reanalisar} disabled={!!ocupado}>Ler de novo</button>
                    <button type="button" className="b-btn-outline cad-mini" onClick={salvar} disabled={!!ocupado}>Salvar edição</button>
                    <button type="button" className="b-btn-outline cad-mini" onClick={() => setRecusando(true)} disabled={!!ocupado}>Recusar</button>
                    <button type="button" className="b-btn" onClick={aprovar} disabled={!!ocupado || incluidos === 0}>Aprovar</button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        {(aberta.historico || []).length > 0 && (
          <section className="b-card cad-secao fade-in">
            <h3 className="brand-font">Histórico</h3>
            <ul className="sol-historico">
              {aberta.historico.map((h, k) => <li key={k}><strong>{h.acao}</strong> · {h.usuario} · {quando(h.em)}</li>)}
            </ul>
          </section>
        )}
      </div>
    );
  }

  // ---------- Lista ----------
  return (
    <div className="cad sol">
      <section className="b-card cad-secao fade-in">
        <div className="cad-secao__topo">
          <h3 className="brand-font">Solicitações do ClickUp</h3>
          <button type="button" className="b-btn-ghost" onClick={conferir} disabled={!!ocupado}>{ocupado === 'conferir' ? 'Buscando…' : 'Buscar no ClickUp'}</button>
        </div>
        {config && (
          <div className="sol-config">
            <span className="cad-chip cad-chip--andando" title="Nesta fase nenhum código é criado automaticamente">
              {config.modo === 'simulacao' ? 'Modo simulação' : 'Só analisar'}
            </span>
            <label className="cad-switch">
              <input type="checkbox" role="switch" checked={!!config.pausado} onChange={(e) => mudarConfig({ pausado: e.target.checked })} />
              <span className="cad-switch__trilho" aria-hidden="true" />
              Criação automática pausada
            </label>
            <label className="sol-modo">Modo
              <select className="b-input" value={config.modo} onChange={(e) => mudarConfig({ modo: e.target.value })}>
                <option value="analisar">Só analisar</option>
                <option value="simulacao">Simulação</option>
                <option value="automatico" disabled>Automático (Fase 2)</option>
              </select>
            </label>
          </div>
        )}
        {config && !config.clickupConfigurado && (
          <div className="cad-erro" role="note">O token do ClickUp ainda não foi configurado no servidor (CLICKUP_API_TOKEN): o botão "Buscar no ClickUp" e "Ler de novo" ficam indisponíveis. Eventos do webhook também precisam dele para ler a tarefa.</div>
        )}
        <div className="sol-filtros">
          <input className="b-input" type="search" placeholder="Buscar por título ou solicitante" aria-label="Buscar" value={filtros.busca} onChange={(e) => setFiltros({ ...filtros, busca: e.target.value })} />
          <select className="b-input" aria-label="Status" value={filtros.status} onChange={(e) => setFiltros({ ...filtros, status: e.target.value })}>
            <option value="">Em aberto (sem as encerradas)</option>
            {Object.entries(STATUS).filter(([v]) => !['finalizada_clickup', 'cancelada_clickup', 'concluida'].includes(v)).map(([v, [t]]) => <option key={v} value={v}>{t}</option>)}
            <option value="encerradas">Encerradas (finalizadas / com códigos)</option>
          </select>
          <select className="b-input" aria-label="Sugestão" value={filtros.sugestao} onChange={(e) => setFiltros({ ...filtros, sugestao: e.target.value })}>
            <option value="">Qualquer leitura</option>
            <option value="automatica">Pequena e limpa</option>
            <option value="analise">Precisa de análise</option>
          </select>
        </div>
      </section>

      <section className="b-card cad-secao fade-in" aria-live="polite">
        {erro && <div className="cad-erro" role="alert">{erro}</div>}
        {lista === null ? (
          <div className="cad-esqueleto" aria-label="Carregando"><div className="cad-esqueleto__linha" /><div className="cad-esqueleto__linha" /><div className="cad-esqueleto__linha" /></div>
        ) : lista.length === 0 ? (
          <p className="cad-vazio">Nenhuma solicitação por aqui ainda. Quando alguém abrir uma tarefa no formulário de cadastro, ela aparece sozinha.</p>
        ) : (
          <ul className="cad-lista">
            {lista.map((s) => (
              <li key={s.id}>
                <button type="button" className="cad-linha sol-card" onClick={() => abrir(s.id)} disabled={ocupado === 'abrindo'}>
                  <div className="cad-linha__corpo">
                    <strong>{s.titulo}</strong>
                    <span>{[s.solicitante, `${s.itens} produto${Number(s.itens) === 1 ? '' : 's'}`, s.prefixo_codigo && `faixa ${s.prefixo_codigo}`, s.status_clickup && `ClickUp: ${s.status_clickup}`, quando(s.recebido_em), s.origem === 'teste' ? 'TESTE' : ''].filter(Boolean).join(' · ')}</span>
                    {s.sugestao === 'analise' && (s.motivos || [])[0] && <em className="cad-linha__problema">{s.motivos[0]}</em>}
                  </div>
                  <div className="cad-linha__lado"><Chip par={STATUS[s.status]} /> <Chip par={SUGESTAO[s.sugestao]} /></div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
