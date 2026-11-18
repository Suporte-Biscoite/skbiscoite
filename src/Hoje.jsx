import { useCallback, useEffect, useState } from 'react';
import './Cadastro.css';
import './Solicitacoes.css';
import { explicarErro } from './lib/erros.js';

const quando = (d) => (d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'ainda não criou nada');
const MODO = { analisar: 'Só analisa (uma pessoa aprova tudo)', simulacao: 'Simulação (avalia, mas não cria)', automatico: 'Automático (cria sozinho os pedidos simples)' };

// Tela inicial: o que precisa de você agora, o que deu problema e se o robô está saudável.
export default function Hoje({ api, irPara }) {
  const [d, setD] = useState(null);
  const [erro, setErro] = useState('');
  const carregar = useCallback(() => api('/api/solicitacoes?hoje=1').then((r) => { setD(r); setErro(''); }).catch((e) => setErro(e.message)), [api]);
  useEffect(() => { carregar(); const t = setInterval(carregar, 60000); return () => clearInterval(t); }, [carregar]);

  if (erro) return <div className="cad-erro" role="alert">Não consegui carregar o resumo: {erro} <button type="button" className="b-btn-outline cad-mini" onClick={carregar}>Tentar de novo</button></div>;
  if (!d) return <p className="cad-vazio">Carregando…</p>;
  const r = d.robo;
  const tudoEmDia = d.aguardando === 0 && d.com_problema === 0;
  return (
    <div className="hoje fade-in">
      <section className="b-card cad-secao" aria-labelledby="hoje-agora">
        <h3 id="hoje-agora" className="brand-font">O que precisa de você agora</h3>
        {tudoEmDia ? (
          <p className="cad-vazio">Tudo em dia. Nenhum pedido esperando e nenhum com problema. Quando chegar um pedido novo do ClickUp, ele aparece aqui.</p>
        ) : (
          <div className="hoje-cartoes">
            <button type="button" className="hoje-cartao" onClick={() => irPara('solicitacoes')}>
              <strong>{d.aguardando}</strong><span>{d.aguardando === 1 ? 'pedido esperando sua análise' : 'pedidos esperando sua análise'}</span>
            </button>
            <button type="button" className={'hoje-cartao' + (d.com_problema ? ' hoje-cartao--alerta' : '')} onClick={() => irPara('solicitacoes')}>
              <strong>{d.com_problema}</strong><span>{d.com_problema === 1 ? 'pedido com problema' : 'pedidos com problema'}</span>
            </button>
            <button type="button" className="hoje-cartao" onClick={() => irPara('solicitacoes')}>
              <strong>{d.concluidas_hoje}</strong><span>concluídos hoje</span>
            </button>
          </div>
        )}
        {d.problemas.length > 0 && (
          <ul className="hoje-lista">
            {d.problemas.map((p) => { const e = explicarErro(p.erro); return (
              <li key={p.id}><strong>{p.titulo}</strong><span>{e.oQue} {e.oQueFazer}</span></li>
            ); })}
          </ul>
        )}
        {d.proximas.length > 0 && (
          <>
            <h4>Próximos da fila</h4>
            <ul className="hoje-lista">{d.proximas.map((p) => <li key={p.id}><strong>{p.titulo}</strong><span>{p.solicitante || 'sem solicitante'} · {p.sugestao === 'automatica' ? 'sem alertas' : 'precisa de atenção'}</span></li>)}</ul>
          </>
        )}
        <div className="sol-botoes"><button type="button" className="b-btn" onClick={() => irPara('solicitacoes')}>Abrir Solicitações</button></div>
      </section>

      <section className="b-card cad-secao" aria-labelledby="hoje-robo">
        <h3 id="hoje-robo" className="brand-font">Como está o robô</h3>
        <dl className="cad-previa sol-previa">
          <div><dt>Situação</dt><dd>{r.pausado ? 'Pausado por uma pessoa' : 'Ligado'}</dd></div>
          <div><dt>Modo</dt><dd>{MODO[r.modo] || r.modo}</dd></div>
          <div><dt>Criados por ele hoje</dt><dd>{r.criadasHoje} de {r.limiteDia} permitidos</dd></div>
          <div><dt>Última criação</dt><dd>{quando(r.ultimaCriacao)}</dd></div>
          <div><dt>Confere o ClickUp</dt><dd>a cada 5 minutos, e na hora quando o ClickUp avisa</dd></div>
        </dl>
        <p className="sol-meta">Pedidos grandes, com alertas ou que a IA estranhar sempre esperam uma pessoa. Para pausar ou mudar o modo, abra Solicitações. Dúvidas? Veja a aba Ajuda.</p>
      </section>
    </div>
  );
}
