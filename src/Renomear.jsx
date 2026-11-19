import { useCallback, useEffect, useState } from 'react';
import './Cadastro.css';
import './Solicitacoes.css';
import { explicarErro } from './lib/erros.js';

const ESTADO = { proposta: 'Pronta para aprovar', invalida: 'Não dá para renomear', sem_mudanca: 'Sem mudança', aplicando: 'Aplicando…', aplicada: 'Renomeado', erro: 'Falhou (pode tentar de novo)', desfeita: 'Desfeito' };
const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

// Renomear códigos: a pessoa cola "código; novo nome", vê a prévia (antes e depois, Omie e Nexaas) e aprova. Só o nome muda.
export default function Renomear({ api, exibirToast }) {
  const [texto, setTexto] = useState('');
  const [previa, setPrevia] = useState(null);
  const [marcados, setMarcados] = useState({});
  const [historico, setHistorico] = useState({ ativa: false, lista: [] });
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => api('/api/solicitacoes?renomeacoes=1').then(setHistorico).catch(() => {}), [api]);
  useEffect(() => { carregar(); }, [carregar]);

  const post = async (corpo) => api('/api/solicitacoes', { metodo: 'POST', corpo });
  const gerarPrevia = async () => {
    setOcupado(true);
    try {
      const r = await post({ acao: 'renomear-propor', texto });
      setPrevia(r); setMarcados(Object.fromEntries(r.linhas.filter((l) => l.estado === 'proposta').map((l) => [l.id, true])));
      carregar();
    } catch (e) { exibirToast(e.message, 'erro'); } finally { setOcupado(false); }
  };
  const escolhidos = Object.keys(marcados).filter((k) => marcados[k]).map(Number);
  const aprovar = async () => {
    if (!window.confirm(`Vai renomear ${escolhidos.length} código(s) no Omie e, onde existir, no Nexaas. Só o nome muda, e dá para desfazer. Continuar?`)) return;
    setOcupado(true);
    try {
      const r = await post({ acao: 'renomear-aplicar', ids: escolhidos });
      const falhas = r.resultado.filter((x) => x.estado === 'erro').length;
      exibirToast(falhas ? `${r.resultado.length - falhas} renomeado(s), ${falhas} com problema.` : 'Renomeado nos dois sistemas.', falhas ? 'erro' : 'sucesso');
      setPrevia(null); setTexto(''); carregar();
    } catch (e) { exibirToast(e.message, 'erro'); } finally { setOcupado(false); }
  };
  const desfazer = async (id) => {
    if (!window.confirm('Desfazer devolve o nome de antes no Omie e no Nexaas. Continuar?')) return;
    setOcupado(true);
    try { await post({ acao: 'renomear-desfazer', id }); exibirToast('Nome devolvido.'); carregar(); } catch (e) { exibirToast(e.message, 'erro'); } finally { setOcupado(false); }
  };
  const tentarDeNovo = async (id) => {
    setOcupado(true);
    try { const r = await post({ acao: 'renomear-aplicar', ids: [id] }); exibirToast(r.resultado[0]?.estado === 'aplicada' ? 'Renomeado.' : (r.resultado[0]?.erro || 'Falhou.'), r.resultado[0]?.estado === 'aplicada' ? 'sucesso' : 'erro'); carregar(); } catch (e) { exibirToast(e.message, 'erro'); } finally { setOcupado(false); }
  };

  return (
    <div className="cad sol fade-in">
      <section className="b-card cad-secao" aria-labelledby="ren-novo">
        <h3 id="ren-novo" className="brand-font">Renomear códigos</h3>
        <p className="sol-meta">Cole um código por linha, com o novo nome: <strong>código; novo nome</strong> (também vale colar duas colunas de uma planilha). O Omie é alterado primeiro e depois o Nexaas. Só o nome muda: código, preço, NCM, família e estoque não são tocados.</p>
        {!historico.ativa && <div className="cad-erro" role="note">A alteração está <strong>desligada no servidor</strong> (RENOMEAR_ATIVO). Você já pode ver a prévia, mas só poderá aprovar depois de um teste com um produto de teste.</div>}
        <textarea className="b-input" rows={6} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'8000109; POLTRONA ANGEL TECIDO JASPE\n4000012; BISCOITO CASTANHA 150G'} aria-label="Códigos e novos nomes" />
        <div className="sol-botoes"><button type="button" className="b-btn" onClick={gerarPrevia} disabled={ocupado || !texto.trim()}>{ocupado && !previa ? 'Lendo o Omie e o Nexaas…' : 'Ver prévia (não altera nada)'}</button></div>
      </section>

      {previa && (
        <section className="b-card cad-secao" aria-labelledby="ren-previa">
          <h3 id="ren-previa" className="brand-font">Prévia</h3>
          <ul className="hoje-lista">
            {previa.linhas.map((l, k) => (
              <li key={l.id || k}>
                <label className="sol-incluir">
                  {l.estado === 'proposta' && <input type="checkbox" checked={!!marcados[l.id]} onChange={(e) => setMarcados({ ...marcados, [l.id]: e.target.checked })} />}
                  <strong>{l.codigo || `linha ${l.linha}`}</strong> · {ESTADO[l.estado]}
                </label>
                {l.nome_antes && <span>Antes: {l.nome_antes}{l.nexaas_nome_antes && l.nexaas_nome_antes !== l.nome_antes ? ` (Nexaas: ${l.nexaas_nome_antes})` : ''}</span>}
                {l.nome_novo && <span>Depois: <strong>{l.nome_novo}</strong></span>}
                {(l.avisos || []).map((a, i) => <em key={i} className="cad-linha__problema">{a}</em>)}
              </li>
            ))}
          </ul>
          <div className="sol-botoes">
            <button type="button" className="b-btn" onClick={aprovar} disabled={ocupado || !historico.ativa || escolhidos.length === 0}>{ocupado ? 'Renomeando…' : `Aprovar e renomear (${escolhidos.length})`}</button>
            <button type="button" className="b-btn-outline" onClick={() => setPrevia(null)} disabled={ocupado}>Cancelar</button>
          </div>
        </section>
      )}

      <section className="b-card cad-secao" aria-labelledby="ren-hist">
        <h3 id="ren-hist" className="brand-font">Últimas renomeações</h3>
        {historico.lista.length === 0 ? <p className="cad-vazio">Nada por aqui ainda. Quando você renomear códigos, o histórico aparece aqui, com quem aprovou e o botão Desfazer.</p> : (
          <ul className="hoje-lista">
            {historico.lista.map((r) => { const e = r.erro ? explicarErro(r.erro) : null; return (
              <li key={r.id}>
                <strong>{r.codigo} · {ESTADO[r.estado] || r.estado}</strong>
                <span>{r.nome_antes} → {r.nome_novo}</span>
                <span>{r.aprovado_por ? `Aprovado por ${r.aprovado_por} em ${quando(r.aprovado_em)}` : `Proposto por ${r.criado_por} em ${quando(r.criado_em)}`}{r.desfeito_em ? ` · desfeito em ${quando(r.desfeito_em)}` : ''}</span>
                {r.estado === 'aplicada' && r.nexaas_product_id && r.nexaas_depois?.nome_sku && !r.nexaas_depois.nome_sku.endsWith(r.nome_novo) && <em className="cad-linha__problema">O nome do SKU no Nexaas ainda mostra "{r.nexaas_depois.nome_sku}". Confira no Nexaas.</em>}
                {e && <em className="cad-linha__problema">{e.oQue} {e.oQueFazer}<details><summary>Detalhe técnico</summary>{e.detalhe}</details></em>}
                <div className="sol-botoes">
                  {r.estado === 'aplicada' && <button type="button" className="b-btn-outline cad-mini" disabled={ocupado || !historico.ativa} onClick={() => desfazer(r.id)}>Desfazer</button>}
                  {r.estado === 'erro' && <button type="button" className="b-btn-outline cad-mini" disabled={ocupado || !historico.ativa} onClick={() => tentarDeNovo(r.id)}>Tentar de novo</button>}
                </div>
              </li>
            ); })}
          </ul>
        )}
      </section>
    </div>
  );
}
