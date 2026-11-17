import './Cadastro.css';
import './Solicitacoes.css';

// Aba "Ajuda": como o sistema funciona e como analisar uma solicitação, em linguagem do dia a dia.
export default function Ajuda({ ehTI }) {
  return (
    <div className="cad ajuda">
      <section className="b-card cad-secao fade-in">
        <h3 className="brand-font">Para que serve o sistema</h3>
        <p>Aqui você cria os <strong>códigos dos produtos</strong> (SKU) de uma vez só no <strong>Omie</strong> (ERP) e no <strong>Nexaas</strong> (loja/PDV), sem digitar nada duas vezes. O código nasce da família do produto mais um número em sequência, por exemplo família 400 vira 4000071, 4000072…</p>
        <h4>Qual tela uso?</h4>
        <ul>
          <li><strong>Gerador Individual:</strong> um produto só. Digite o nome, escolha a família e crie.</li>
          <li><strong>Importação em Massa:</strong> vários produtos de uma planilha.</li>
          <li><strong>Importar do Omie:</strong> o produto já existe no Omie e só falta levá-lo para o Nexaas.</li>
          {ehTI && <li><strong>Solicitações:</strong> pedidos que chegam do formulário do ClickUp. É a tela que mais precisa de revisão (explicada abaixo).</li>}
          <li><strong>Histórico &amp; Auditoria:</strong> tudo o que já foi criado, com data e quem fez.</li>
        </ul>
        <h4>Regras que o sistema aplica sozinho</h4>
        <ul>
          <li>O nome do produto sempre sobe em <strong>MAIÚSCULAS e sem acento</strong> (Dobrável vira DOBRAVEL).</li>
          <li>Nunca cria o mesmo código duas vezes: se algo falhar no meio, dá para tentar de novo sem duplicar.</li>
          <li>Só as famílias 300 e 400 entram na loja (PDV).</li>
        </ul>
      </section>

      {ehTI && (
        <>
          <section className="b-card cad-secao fade-in">
            <h3 className="brand-font">Como funcionam as Solicitações</h3>
            <ol>
              <li><strong>Chega:</strong> alguém preenche o formulário no ClickUp. O pedido aparece sozinho na tela (se achar que falta algum, clique em "Atualizar agora").</li>
              <li><strong>Você revisa:</strong> abra o pedido, confira os nomes, a família e o NCM de cada produto.</li>
              <li><strong>Aprova:</strong> clique em "Aprovar e criar códigos". Aprovar é a sua autorização: o sistema cria no Omie e no Nexaas.</li>
              <li><strong>Avisa:</strong> o sistema comenta os códigos na tarefa do ClickUp e muda o status para Finalizado. Em "Andamento" você vê cada etapa, e se alguma falhar há o botão "Tentar de novo".</li>
            </ol>
            <h4>Duas áreas separadas</h4>
            <dl className="ajuda-glossario">
              <div><dt><strong>Produtos novos</strong></dt><dd>Pedidos para criar código de um produto, como "GAVETEIRO ORGANIZADOR". Estes você revisa e aprova.</dd></div>
              <div><dt><strong>Outras tarefas</strong></dt><dd>Pedidos de alteração, como "Alteração de nome Mães 2027" ou "Ativar códigos". Não criam código novo. O sistema só separa e mostra; esta área ainda será desenvolvida. Resolva no ClickUp e use "Dispensar".</dd></div>
            </dl>
          </section>

          <section className="b-card cad-secao fade-in">
            <h3 className="brand-font">Como analisar um pedido</h3>
            <p>Abra o pedido e passe por esta lista:</p>
            <ol>
              <li><strong>Os nomes estão certos?</strong> Uma linha é um produto. Corrija direto no campo, remova a linha com × ou desmarque "Incluir".</li>
              <li><strong>A família está certa?</strong> O código sai dela. A IA confere sozinha se cada produto combina com a família pedida (por exemplo, GAVETEIRO é móvel, então é ATIVO 800 e não SUPRIMENTOS 700; papel higiênico e produto de limpeza são SUPRIMENTOS). Se ela estranhar, aparece um aviso com o botão "Usar família…". Você sempre decide.</li>
              <li><strong>O NCM está certo?</strong> Famílias 700 e 800 usam o NCM da nota fiscal do fornecedor (o botão "Ler NCM da nota (PDF)" sugere). As outras já vêm com um NCM padrão, que fica marcado para revisão depois.</li>
              <li><strong>Já existe?</strong> Se aparecer "Já existe no Omie com este nome", não crie de novo: use "Importar do Omie" ou recuse o pedido.</li>
              <li><strong>Entra na loja?</strong> Marcado por padrão só nas famílias 300 e 400.</li>
              <li>Tudo certo? <strong>Aprovar e criar códigos</strong>. Algo errado e não é com você? <strong>Recusar</strong> e explique o motivo.</li>
            </ol>
            <h4>O que significam os selos</h4>
            <dl className="ajuda-glossario">
              <div><dt><span className="cad-chip cad-chip--ok">Sem alertas</span></dt><dd>O sistema não achou nenhum problema. Mesmo assim, dê uma olhada antes de aprovar.</dd></div>
              <div><dt><span className="cad-chip cad-chip--andando">Precisa de atenção</span></dt><dd>Há algo a conferir; o motivo aparece em amarelo no pedido.</dd></div>
              <div><dt><span className="cad-chip cad-chip--andando">Para revisar</span></dt><dd>Está esperando você.</dd></div>
              <div><dt><span className="cad-chip cad-chip--espera">Na fila para criar</span></dt><dd>Aprovada; o sistema está criando.</dd></div>
              <div><dt><span className="cad-chip cad-chip--ok">Códigos criados</span></dt><dd>Terminou: códigos criados, tarefa comentada e finalizada.</dd></div>
              <div><dt><span className="cad-chip cad-chip--erro">Recusada</span></dt><dd>Você recusou; nada foi criado.</dd></div>
            </dl>
            <h4>Avisos comuns</h4>
            <ul>
              <li><strong>"Cita código que já existe no Omie":</strong> o pedido fala de um produto que já tem código. Provavelmente é para levar ao Nexaas.</li>
              <li><strong>"Produto igual ou parecido já cadastrado":</strong> confira se não é duplicado.</li>
              <li><strong>"Mais de 10 itens":</strong> pedido grande; revise com calma.</li>
              <li><strong>"Dois campos Família de Produto diferentes":</strong> o formulário veio com duas famílias; escolha a certa.</li>
            </ul>
          </section>

          <section className="b-card cad-secao fade-in">
            <h3 className="brand-font">Criação automática</h3>
            <p>Em "Pedidos que chegam do ClickUp" há o painel <em>Criação automática</em>, com três modos:</p>
            <ul>
              <li><strong>Desligada</strong> (padrão): nada é criado sem você aprovar.</li>
              <li><strong>Simulação:</strong> o sistema avalia os pedidos novos e mostra o que <em>seria</em> criado, sem criar nada. Bom para ganhar confiança.</li>
              <li><strong>Automática:</strong> pedidos pequenos, sem alerta e com NCM confiável são criados sozinhos, depois de a IA dar uma segunda opinião. A IA só pode barrar, nunca libera o que as regras barraram. Há intervalo entre pedidos e limite por dia, e o botão "Pausar" trava tudo.</li>
            </ul>
            <p>Aprovar manualmente funciona sempre, em qualquer modo.</p>
          </section>

          <section className="b-card cad-secao fade-in">
            <h3 className="brand-font">Produto que já existe no Omie</h3>
            <p>Antes de criar, o sistema procura o nome no Omie (sem diferenciar acento, caixa, abreviações como CX/CAIXA e ordem das palavras).</p>
            <ul>
              <li><strong>Existe com o código certo:</strong> o código é reaproveitado. O Omie não é recadastrado; o sistema só confere o Nexaas e cadastra lá se faltar. No comentário da tarefa aparece "já estava cadastrado no Omie".</li>
              <li><strong>Parecido, mas não igual:</strong> aparece a opção "Usar o código existente"; você decide.</li>
              <li><strong>Existe com código fora do padrão (ex.: 10360):</strong> o pedido fica bloqueado até corrigir o cadastro antigo.</li>
            </ul>
            <h4>Corrigir cadastro antigo</h4>
            <p>No produto bloqueado, clique em "Corrigir cadastro antigo". O sistema só lê o Omie e mostra o antes e o depois (renomear para "CADASTRO ERRADO - nome (INATIVO)" e inativar), o estoque e se existe no Nexaas. Se houver saldo, reserva ou pendência, bloqueia. Pedidos, notas e movimentações o Omie não deixa consultar por produto: você confere lá e confirma. Nada é automático: só roda depois da sua aprovação, fica registrado quem aprovou e dá para desfazer. Esta função fica desligada no servidor até um teste com produto de teste.</p>
            <h4>Sugerir nomes com IA</h4>
            <p>Quando o nome veio sujo da nota (ex.: "S40 SUPREMA 3GR BIANCA"), o botão "Sugerir nomes com IA" pesquisa na web só o nome do produto e propõe um nome limpo no padrão do catálogo, com marca, modelo, fontes e confiança. Você aceita, edita ou recusa. A IA nunca cadastra sozinha, nunca inventa dados (sem confiança, o item fica "não identificado") e o nome original da nota fica guardado no cadastro.</p>
          </section>

          <section className="b-card cad-secao fade-in">
            <h3 className="brand-font">Revisão de NCM</h3>
            <p>Produtos criados com o NCM padrão da família aparecem em "NCM para revisar", no fim da lista de Produtos novos. Informe o NCM correto e o sistema corrige no Omie. No Nexaas o ajuste ainda é manual.</p>
          </section>
        </>
      )}

      <section className="b-card cad-secao fade-in">
        <h3 className="brand-font">Perguntas frequentes</h3>
        <details>
          <summary>Aprovei e o código não apareceu. E agora?</summary>
          <p>Abra o pedido e veja o "Andamento". A etapa que falhou mostra o erro e o botão "Tentar de novo". Tentar de novo não duplica o código.</p>
        </details>
        <details>
          <summary>Errei um nome depois de criar.</summary>
          <p>Avise o time de TI. O nome criado no Omie é corrigido por lá; o sistema não renomeia produtos já criados.</p>
        </details>
        <details>
          <summary>Um pedido sumiu da lista.</summary>
          <p>Pedidos já finalizados no ClickUp ou com códigos criados saem de "Em aberto". Para vê-los, escolha "Já resolvidas" no filtro de situação.</p>
        </details>
        <details>
          <summary>O pedido veio com letras minúsculas ou acentos.</summary>
          <p>Sem problema: o sistema converte tudo para maiúsculas e sem acento ao ler e ao criar.</p>
        </details>
      </section>
    </div>
  );
}
