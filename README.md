<div align="center">

# 🍪 SKBiscoitê

**Gerador de SKUs integrado ao Omie ERP, feito para a operação de franquias da Biscoitê.**

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-auth%20%26%20logs-3ECF8E?logo=supabase&logoColor=white)
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
| **Novo SKU (individual)** | Escolhe a família, informa descrição e NCM e o sistema gera e cadastra o código no Omie. |
| **Importação em massa** | Sobe uma planilha `.xlsx` e cadastra vários produtos de uma vez, com log linha a linha e resumo final. |
| **Histórico** | Auditoria de todos os SKUs gerados, por usuário (Supabase). |
| **Gestão de equipe** | Cadastro e edição de colaboradores, com envio de credenciais por e-mail. Visível apenas para o setor **TI**. |

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

1. O sistema lê **todos** os produtos do Omie (página por página).
2. Filtra os que pertencem ao prefixo da família.
3. Procura o **primeiro buraco** na sequência (ex.: existem `…001`, `…002`, `…004` → gera `…003`).
4. Se não houver buraco, usa o último + 1.
5. Se o código estiver ocupado por um produto em **stand-by** (`PRODUTO INDEFINIDO`, `CÓDIGO EM STAND-BY`),
   o produto é reaproveitado e sobrescrito.
6. Se o Omie recusar por código duplicado, o sistema marca aquele código como ocupado e tenta o próximo.

> A tabela de famílias fica em um único lugar: [`src/lib/familias.js`](src/lib/familias.js).
> O texto da coluna **Família no Omie** precisa ser idêntico ao nome cadastrado no Omie.

## 📥 Importação em massa

1. Na aba **Importação em Massa**, clique em **Baixar Planilha Modelo**.
2. Preencha a partir da linha 5:

| Coluna | Obrigatória | Descrição |
| --- | :---: | --- |
| `FAMILIA` | ✅ | Escolha na lista suspensa (ex.: `PRODUTOS PRONTOS`). |
| `DESCRICAO` | ✅ | Nome do produto, em maiúsculas. |
| `NCM` | — | Apenas números. Se vazio, usa `1905.90.20`. |

3. Envie o arquivo e clique em **Iniciar Importação**.

**Detalhes úteis**

- Na coluna `FAMILIA` também são aceitos o nome do grupo (`INTERNO`), o prefixo (`400`) e os textos da planilha antiga.
- O cabeçalho é encontrado em qualquer linha e aceita acento (`DESCRIÇÃO`).
- Produtos com descrição já existente no Omie (ou repetida na planilha) são recusados e aparecem no log.
- Uma falha em uma linha não interrompe as demais.
- A aba **Famílias** do modelo é só para consulta.

## 🧱 Tecnologias

- **Front-end:** React 19 + Vite
- **Back-end:** funções serverless da Vercel (`/api`)
- **Banco e histórico:** Supabase
- **ERP:** [API do Omie](https://developer.omie.com.br/service-list/)
- **Planilhas:** `exceljs` (gera o modelo) e `xlsx` (lê o arquivo enviado)
- **E-mail:** Resend

## 🗂️ Estrutura

```
.
├── api/
│   ├── cadastrar.js       # cria/atualiza o produto no Omie (e vincula a família)
│   ├── codigos.js         # lista produtos do Omie, uma página por chamada
│   └── enviar-email.js    # envia credenciais de acesso (Resend)
├── src/
│   ├── App.jsx            # telas e fluxos
│   └── lib/
│       ├── familias.js        # tabela prefixo ↔ grupo ↔ família
│       ├── skus.js            # geração de código, leitura da planilha, lote
│       ├── modeloPlanilha.js  # monta a planilha modelo
│       └── *.test.js          # testes
└── package.json
```

## ⚙️ Variáveis de ambiente

Configure na Vercel (e em um `.env.local` para rodar localmente). **Nunca** suba esses valores para o repositório.

| Variável | Onde é usada | Para quê |
| --- | --- | --- |
| `OMIE_APP_KEY` | `api/` | Chave do aplicativo no Omie |
| `OMIE_APP_SECRET` | `api/` | Segredo do aplicativo no Omie |
| `RESEND_API_KEY` | `api/enviar-email.js` | Envio de e-mails |
| `VITE_SUPABASE_URL` | front-end | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | front-end | Chave pública (anon) do Supabase |

> As credenciais do Omie ficam apenas no servidor (`api/`) e nunca chegam ao navegador.

## 🚀 Rodando localmente

```bash
npm install
```

As rotas `/api/*` são funções da Vercel, então para ter o sistema completo localmente use a CLI da Vercel:

```bash
npm i -g vercel
vercel dev
```

Só a interface, sem as rotas de API:

```bash
npm run dev
```

## ✅ Testes

```bash
npm test
```

Cobrem a escolha do próximo código (buracos, stand-by, colisões), o reconhecimento de famílias,
a leitura da planilha e um lote completo contra um Omie simulado.

Outros comandos: `npm run build` · `npm run lint` · `npm run preview`.

## ☁️ Deploy

O deploy é feito na **Vercel**. Cada push no repositório gera um novo build; lembre-se de cadastrar as
variáveis de ambiente acima no projeto da Vercel.

---

<div align="center">

Feito com 🍪 pela equipe de TI da **Biscoitê**.

</div>
