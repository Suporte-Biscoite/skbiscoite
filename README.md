<div align="center">

# 🍪 SKBiscoitê

**Gerador de SKUs que cadastra o produto no Omie ERP e no Nexaas OMS em um só fluxo, feito para a operação de franquias da Biscoitê.**

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Neon](https://img.shields.io/badge/Neon-Postgres-00E599?logo=postgresql&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-deploy-000000?logo=vercel&logoColor=white)
![Omie](https://img.shields.io/badge/Omie-ERP-0A5CFF)

</div>

---

## 📌 O que é

O SKBiscoitê padroniza a criação de códigos de produto (SKUs). Em vez de alguém inventar o código na mão,
o sistema consulta o Omie, encontra o **próximo código livre da família** escolhida e já cadastra o produto
no ERP com a família correta. Todo cadastro fica registrado em um histórico de auditoria.

## ✨ Funcionalidades

| Módulo | O que faz |
| --- | --- |
| **Novo SKU** | Monta uma lista de um ou vários produtos, confere tudo antes do envio e cadastra no Omie e no Nexaas. |
| **Importação em lote** | Mesma lista, alimentada por planilha `.xlsx`, com validação linha a linha e progresso por item. |
| **Histórico** | Auditoria de cada cadastro: status no Omie, status no Nexaas, erros, quem fez e quando (Neon). |
| **Gestão de equipe** | Cadastro e edição de colaboradores, com envio de credenciais por e-mail. Visível apenas para o setor **TI**. |

## 🔄 Fluxo de cadastro

```
tela  →  validar  →  reservar código  →  Omie  →  Nexaas  →  histórico
```

1. **Validação (antes de enviar):** descrição, NCM de 8 dígitos (obrigatório), "entra na loja?", família existente
   (e sem nome repetido) no Omie, categoria correspondente no Nexaas e descrição ainda inexistente. Item com
   problema é **bloqueado com a explicação**, nunca criado incompleto.
2. **Reserva do código:** o próximo código livre do prefixo é gravado no banco com índice único; dois usuários
   ao mesmo tempo nunca recebem o mesmo código.
3. **Omie:** cria o produto com família, tipo do item, NCM formatado e origem 0.
4. **Nexaas:** confere se o SKU já existe (para nunca duplicar) e cria o produto.
5. Cada sistema guarda o **próprio status**. Se o Omie deu certo e o Nexaas falhou, a tela mostra
   **"Tentar só o Nexaas"**: o Omie não é chamado de novo.

### Regras do Nexaas

| | Entra na loja | Não entra na loja |
| --- | --- | --- |
| Canais de venda | Todos os canais | Apenas ESTOQUE |
| Visibilidade | On-line e off-line | Apenas off-line |
| Categoria principal | Família do produto | ATIVO |

Visibilidade e canais são **uma única opção** no código (`CENARIOS_LOJA` em `src/lib/regras.js`): nunca um sem o outro.
Fixos: status ativo · unidade UN · visível para todas as organizações · membro pode editar · origem 0 ·
finalidade "Revenda - produção de terceiros" · SKU com o mesmo código, sem EAN, ativo.
As famílias têm o mesmo nome no Omie e no Nexaas (exceção: **300** entra no Nexaas como PRODUTOS PRONTOS e
kits são `CESTAS/KIT` no Omie e `CESTA/KIT` no Nexaas).

### Produto sazonal

Marcando **sazonal**, a família do produto (Omie) e a categoria (Nexaas) passam a ser a família sazonal
escolhida (NATAL, PÁSCOA...). A lista vem do Omie e do Nexaas (só aparecem as que existem nos dois).
**O prefixo do código continua o da família principal** (ex.: NATAL com 400 gera `400xxxx`).

## 🔢 Como o código é gerado

```
CÓDIGO = PREFIXO DA FAMÍLIA + SEQUÊNCIA     (sempre 7 dígitos no total)
```

| Prefixo | Grupo | Família no Omie |
| :---: | --- | --- |
| `1010` | ENVASE | INSUMOS PARA ENVASE |
| `200` | EMBALAGEM | EMBALAGEM |
| `300` | EXTERNO | PRODUTOS PARA REVENDA |
| `400` | INTERNO | PRODUTOS PRONTOS |
| `500` | KITS | CESTAS/KIT |
| `700` | SUPRIMENTOS | SUPRIMENTOS |
| `800` | ATIVOS | ATIVO |

Exemplos: `400` + `0001` = **`4000001`** · `1010` + `001` = **`1010001`**.

**Regras de escolha do próximo código:**

1. O sistema consulta o espelho local do catálogo do Omie (veja *Desempenho*), sempre atualizado antes de cada lote.
2. Filtra os que pertencem ao prefixo da família.
3. Procura o **primeiro buraco** na sequência (ex.: existem `…001`, `…002`, `…004` → gera `…003`).
4. Se não houver buraco, usa o último + 1.
5. Se o código estiver ocupado por um produto em **stand-by** (`PRODUTO INDEFINIDO`, `CÓDIGO EM STAND-BY`),
   o produto é reaproveitado e sobrescrito.
6. Se o Omie recusar por código duplicado, o sistema marca aquele código como ocupado e tenta o próximo.

> A tabela de famílias fica em um único lugar: [`src/lib/familias.js`](src/lib/familias.js).
> O texto da coluna **Família no Omie** precisa ser idêntico ao nome cadastrado no Omie.

## 📥 Importação em lote

1. Em **Importação em Lote**, clique em **Baixar modelo**.
2. Preencha a partir da linha 5:

| Coluna | Obrigatória | Descrição |
| --- | :---: | --- |
| `FAMILIA` | ✅ | Escolha na lista (ex.: `PRODUTOS PRONTOS`). |
| `DESCRICAO` | ✅ | Nome do produto. |
| `NCM` | ✅ | 8 números. |
| `ENTRA NA LOJA` | ✅ | `Sim` ou `Não`. |
| `SAZONAL` | — | `Sim` se for sazonal. |
| `FAMILIA SAZONAL` | se sazonal | Nome da família (ex.: `NATAL`). |

3. Envie o arquivo, confira a pré-visualização (linhas com problema aparecem em vermelho e não são enviadas) e clique em **Cadastrar**.

- Também são aceitos o nome do grupo (`INTERNO`), o prefixo (`400`) e os textos da planilha antiga.
- Uma falha em uma linha não interrompe as demais.

## ⚡ Desempenho

O Omie leva ~96 s para listar os ~7 mil produtos. Por isso o catálogo é espelhado no Neon: a **primeira**
vez que alguém cadastra, a tela mostra o progresso da carga (~1 min); depois só se atualiza o que mudou
(~1 s por lote). Um lote de 4 produtos leva ~5 s.

## 🧱 Tecnologias

- **Front-end:** React 19 + Vite
- **Back-end:** funções serverless da Vercel (`/api`)
- **Banco e fila:** [Neon](https://neon.tech) (Postgres)
- **ERP:** [API do Omie](https://developer.omie.com.br/service-list/) · **OMS:** [API do Nexaas](https://nexaas-oms.readme.io/reference/getting-started-with-your-api)
- **Planilhas:** `exceljs` (modelo) e `xlsx` (leitura), carregados só quando usados
- **E-mail:** Resend

## 🗂️ Estrutura

```
.
├── api/
│   ├── lotes.js          # validar / criar / processar / tentar de novo / histórico
│   ├── sincronizar.js    # espelho do catálogo do Omie
│   ├── familias.js       # famílias-base e sazonais
│   ├── historico.js · login.js · usuarios.js · recuperar-senha.js
│   └── _lib/             # omie.js, nexaas.js, catalogo.js, cadastros.js, schema.js, sessao.js...
├── src/
│   ├── App.jsx           # login, menu e telas administrativas
│   ├── Cadastro.jsx      # tela de cadastro (individual, lote, planilha)
│   └── lib/              # regras.js (Omie/Nexaas), familias.js, skus.js, modeloPlanilha.js
└── scripts/              # medir-omie, verificar-fase2, teste-escrita, dev-api
```

As tabelas novas (`omie_produtos`, `omie_familias`, `sync_meta`, `cadastros`) são criadas sozinhas na primeira
chamada (`CREATE TABLE IF NOT EXISTS`); `usuarios` e `historico_skus` não são alteradas.

## ⚙️ Variáveis de ambiente

Configure na Vercel e em um `.env.local` (use `.env.example` como modelo). **Nunca** suba valores para o repositório.

| Variável | Para quê |
| --- | --- |
| `OMIE_APP_KEY` · `OMIE_APP_SECRET` | Aplicativo no Omie (Portal do desenvolvedor) |
| `NEXAAS_API_TOKEN` | Token da API do Nexaas |
| `NEXAAS_API_URL` | `https://app.oms.nexaas.com` |
| `NEXAAS_ORGANIZATION_ID` | Opcional. Organização dona dos produtos (padrão 475, Center Norte) |
| `DATABASE_URL` | Connection string do Neon |
| `SESSION_SECRET` | Texto aleatório longo que assina as sessões |
| `RESEND_API_KEY` | Envio de e-mails |

> Todas as chamadas ao Omie e ao Nexaas acontecem no servidor (`api/`); chaves e tokens nunca chegam ao navegador nem aos logs.

## 🚀 Rodando localmente

```bash
npm install
npm run dev:api   # terminal 1: rotas /api em http://localhost:3001
npm run dev       # terminal 2: interface (o Vite encaminha /api para o terminal 1)
```

## ✅ Testes e verificações

```bash
npm test               # regras, famílias, códigos, planilha (sem rede)
npm run lint
npm run medir          # só LEITURA: cronometra o Omie
npm run verificar      # cria as tabelas, carrega o catálogo e valida itens (não cria produto)
npm run teste-escrita  # ESCREVE: cria produtos "TESTE - NÃO USAR" no Omie e no Nexaas. Inative-os depois.
```

## ☁️ Deploy

Feito na **Vercel**. Antes do primeiro deploy, cadastre as variáveis acima no projeto. A primeira pessoa a cadastrar
dispara a carga do catálogo (~1 min, com barra de progresso).

---

<div align="center">

Feito com 🍪 pela equipe de TI da **Biscoitê**.

</div>
