import React, { useState, useEffect } from 'react';
import './App.css'; 

export default function App() {
  const [dados, setDados] = useState({ grupos: [], totalEmUso: 0, totalLivresGeral: 0 });
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState('');

  // Lógica de negócio: agrupa os códigos e encontra os "gaps" disponíveis
  const processarCodigos = (codigos) => {
    const gruposMapa = {};

    // Agrupa pelos 4 primeiros dígitos (prefixo)
    codigos.forEach(cod => {
      const prefixo = cod.substring(0, 4);
      const numero = parseInt(cod, 10);
      if (!gruposMapa[prefixo]) gruposMapa[prefixo] = [];
      gruposMapa[prefixo].push(numero);
    });

    const gruposProcessados = [];
    let totalLivresGeral = 0;

    for (const prefixo in gruposMapa) {
      // Ordena os números do menor para o maior dentro de cada grupo
      const nums = gruposMapa[prefixo].sort((a, b) => a - b);
      const intervalos = [];
      let livresNoGrupo = 0;

      // Procura gaps (intervalos onde a diferença entre o número atual e o anterior é maior que 1)
      for (let i = 1; i < nums.length; i++) {
        const diff = nums[i] - nums[i - 1];
        if (diff > 1) {
          const gapInicio = nums[i - 1] + 1;
          const gapFim = nums[i] - 1;
          const qtd = gapFim - gapInicio + 1;
          
          intervalos.push({ inicio: gapInicio, fim: gapFim, qtd });
          livresNoGrupo += qtd;
          totalLivresGeral += qtd;
        }
      }

      // Adiciona à lista final apenas se o grupo tiver códigos livres disponíveis
      if (livresNoGrupo > 0) {
        gruposProcessados.push({
          prefixo,
          emUso: nums.length,
          livres: livresNoGrupo,
          intervalos
        });
      }
    }

    // Ordena os grupos de forma crescente pelo prefix
    gruposProcessados.sort((a, b) => parseInt(a.prefixo) - parseInt(b.prefixo));

    setDados({
      grupos: gruposProcessados,
      totalEmUso: codigos.length,
      totalLivresGeral
    });
  };

  // Função que comunica com o Back-end da Vercel (Serverless Function)
  const buscarDoOmie = async () => {
    setCarregando(true);
    try {
      // O fetch agora aponta para a pasta /api local que a Vercel gere automaticamente
      const resposta = await fetch('/api/codigos'); 
      
      if (!resposta.ok) {
        throw new Error(`Erro na resposta da API: ${resposta.status}`);
      }
      
      const codigos = await resposta.json();
      processarCodigos(codigos);
    } catch (error) {
      console.error(error);
      alert("Erro ao conectar com a API. Verifica se a função Serverless está a correr corretamente.");
    } finally {
      setCarregando(false);
    }
  };

  // Executa a busca automaticamente na primeira vez que o ecrã carrega
  useEffect(() => {
    buscarDoOmie();
  }, []);

  // Filtra os grupos no ecrã com base na pesquisa do utilizador
  const gruposFiltrados = dados.grupos.filter(g => g.prefixo.includes(busca));

  return (
    <div className="container">
      <h1>Painel de Códigos Omie</h1>
      
      <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
        <div>
          <p><strong>Em uso no Omie:</strong> {dados.totalEmUso} códigos</p>
          <p><strong>Total de Gaps Livres:</strong> {dados.totalLivresGeral} códigos</p>
          <p><strong>Grupos com disponibilidade:</strong> {dados.grupos.length}</p>
        </div>
        <button 
          className="btn-gerar" 
          onClick={buscarDoOmie} 
          disabled={carregando} 
          style={{ width: 'auto', marginTop: 0, padding: '12px 24px' }}
        >
          {carregando ? 'A sincronizar...' : '🔄 Atualizar Agora'}
        </button>
      </div>

      <div className="card">
        <input 
          type="text" 
          placeholder="Filtrar por grupo (Ex: 3004)" 
          value={busca} 
          onChange={(e) => setBusca(e.target.value)} 
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
      </div>

      {gruposFiltrados.length === 0 && !carregando ? (
        <div className="card" style={{ textAlign: 'center', color: 'var(--text-light)' }}>
          <p>Nenhum grupo encontrado com este filtro.</p>
        </div>
      ) : (
        gruposFiltrados.map((grupo) => (
          <div key={grupo.prefixo} className="card" style={{ borderLeft: '5px solid var(--accent-color)' }}>
            <h3 style={{ borderBottom: 'none', marginBottom: '10px' }}>
              Grupo {grupo.prefixo}xxx
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-light)', marginBottom: '15px' }}>
              {grupo.livres} códigos livres | {grupo.intervalos.length} intervalo(s)
            </p>
            
            {grupo.intervalos.map((intervalo, idx) => (
              <div key={idx} style={{ background: '#F8F9FA', padding: '12px', borderRadius: '8px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  <strong>{intervalo.inicio}</strong> até <strong>{intervalo.fim}</strong> <small>({intervalo.qtd} livres)</small>
                </span>
                <button 
                  onClick={() => navigator.clipboard.writeText(intervalo.inicio.toString())}
                  style={{ background: 'var(--primary-color)', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
                  title="Copiar o primeiro código deste intervalo"
                >
                  Copiar 1º
                </button>
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}