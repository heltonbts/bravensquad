# Setup do Cliente — Agente de Tráfego BravenSquads

Guia de configuração **por cliente**. As etapas 1–4 são técnicas e quem faz é
**você (operador)**, uma vez, na máquina do cliente. A partir da etapa 5, o
cliente usa sozinho — só conversando em português.

> Princípio de segurança: tudo que o agente cria na Meta nasce **PAUSADO**.
> Nada gasta dinheiro até alguém ativar no Gerenciador. Os tokens ficam só no
> arquivo `.env` da máquina do cliente — nunca vão pro chat nem pro git.

---

## Pré-requisitos (uma vez, por máquina)

| O quê | Pra quê | Quem paga |
|---|---|---|
| **Claude Code** (ou Claude Desktop) + conta Claude paga (Pro/Max) | é o "cérebro" do agente | cliente (mensal) |
| **Node.js 20+** | roda o servidor de ferramentas (MCP) | grátis |
| **Conta de OpenAI** + chave de API | gera a imagem do anúncio | cliente (uso) |
| **Meta Business** com conta de anúncios + Página do Facebook + cartão | onde os anúncios rodam | cliente (verba) |

> Para leigo, **Claude Desktop** (interface gráfica) costuma ser mais fácil que o
> Claude Code (terminal). Os passos abaixo servem para os dois; a diferença está
> só em onde o MCP é registrado (ver etapa 4).

---

## 1. Pegar os arquivos

```bash
git clone git@github.com:heltonbts/bravensquad.git
cd bravensquad
```

(ou descompacte o .zip entregue ao cliente e entre na pasta)

## 2. Instalar as dependências

```bash
npm install
```

Sem isso o servidor de ferramentas não sobe. Só precisa rodar uma vez (e de novo
se o projeto for atualizado).

## 3. Preencher o `.env` (a parte sensível — **você** faz)

```bash
cp .env.example .env
```

Edite o `.env` e preencha:

```
META_SYSTEM_USER_TOKEN=...   # System User token com permissão ads_management
META_AD_ACCOUNT_ID=act_...   # ID da conta de anúncios (com o prefixo act_)
META_PAGE_ID=...             # ID da Página do Facebook que veicula o anúncio
META_IG_ACCOUNT_ID=...       # opcional: conta Instagram Business vinculada
OPENAI_API_KEY=sk-...        # chave da OpenAI (gera o criativo)
```

Como obter o **token System User** (você, no Meta Business):
1. Business Settings → **Usuários → Usuários do sistema** → criar um.
2. Dê acesso à **conta de anúncios** e à **Página** (permissão de gerenciar anúncios).
3. **Gerar token** marcando `ads_management` (e `pages_show_list`).
4. System User token **não expira** — ideal pra deixar configurado no cliente.

> 💡 Durante o teste, use uma **conta sandbox** em `META_AD_ACCOUNT_ID` — cria
> campanha de verdade sem gastar dinheiro real.

## 4. Registrar o servidor de ferramentas (MCP)

- **Claude Code:** o arquivo `.mcp.json` já está no projeto. Abra o Claude Code
  **dentro da pasta**, rode `/mcp` e **aprove** o `traffic-agent`.
- **Claude Desktop:** adicione ao `claude_desktop_config.json` (caminhos absolutos):

  ```json
  {
    "mcpServers": {
      "traffic-agent": {
        "command": "npx",
        "args": ["-y", "tsx", "/CAMINHO/ABSOLUTO/bravensquad/mcp/traffic-server.ts"]
      }
    }
  }
  ```

**Teste de sanidade:** peça ao agente para rodar `check_meta_connection`. Deve
responder com o nome da conta, moeda e status. Se der erro, revise o `.env`.

---

## 5. Uso pelo cliente (sozinho, em português)

Abrir o Claude Code/Desktop na pasta e digitar:

```
/trafego
```

O agente (Pedro Sobral) conduz tudo por perguntas simples: o que anunciar,
público, orçamento por dia, a imagem. Ele gera o criativo, mostra o plano e só
cria a campanha **PAUSADA** depois do "sim".

Para acompanhar e otimizar depois (campanha já no ar), o cliente volta e pergunta
"como tá indo?". O agente lê o desempenho, **ajusta o orçamento automaticamente**
e só **pausa/reativa** com confirmação.

---

## Custos recorrentes (deixe claro na venda)

O cliente paga, todo mês, três coisas separadas:
1. **Assinatura do Claude** (o cérebro).
2. **Uso da OpenAI** (cada criativo gerado).
3. **Verba de anúncio na Meta** — sai do cartão dele, direto na conta de anúncios.

A BravenSquads não intermedeia esses pagamentos.

---

## Limites do que existe hoje

- Objetivos suportados: tráfego, alcance e engajamento. **Leads/vendas com pixel
  ainda não** (em desenvolvimento). Campanha de **WhatsApp** funciona via link.
- Uma campanha → um conjunto → um anúncio por vez.
- A otimização roda **quando o cliente abre o Claude e pede** — não é um robô 24/7.

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| `check_meta_connection` dá erro | token/IDs errados no `.env` | revise os 3 IDs e o token |
| MCP não aparece no `/mcp` | esqueceu o `npm install` ou abriu fora da pasta | rode `npm install`, abra na pasta |
| Erro de permissão na Meta | System User sem acesso à conta/Página | reconceda acesso em Business Settings |
| Imagem não gera | `OPENAI_API_KEY` ausente/sem crédito | confira a chave e o saldo na OpenAI |
