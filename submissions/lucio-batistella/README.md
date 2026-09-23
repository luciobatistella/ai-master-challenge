# Submissão — Lúcio Batistella — Challenge 003 (Lead Scorer)

## Sobre mim

- **Nome:** Lúcio Batistella
- **LinkedIn:** _[preencher]_
- **Challenge escolhido:** 003 — Lead Scorer

## Links públicos

- **App ao vivo:** https://purple-swallow-825851.hostingersite.com/
  ⚠️ A hospedagem é estática (sem o backend Node rodando), então o "Perguntar à IA" mostra o aviso de fallback ali — funciona de verdade rodando localmente com o backend (veja Setup). Além disso, a Hostinger usa um CDN em frente ao site com cache agressivo; se a versão que aparecer parecer desatualizada, é esse cache, não o código — os arquivos publicados já estão corretos.
- **Design canvas (protótipo visual, v1):** https://claude.ai/artifact/SH2AwCQRMtwpox7V3VQx7Z

---

## Executive Summary

Construí uma ferramenta web mobile-first + desktop que prioriza os 2.089 deals abertos do pipeline (dataset real de CRM do Kaggle) com um score 0–100 explicável, calculado por regras/heurísticas com correção estatística (shrinkage), não por um modelo caixa-preta. Cada deal mostra o "porquê" do score em linguagem natural, com opção de chat com IA real (Anthropic) por deal. O achado mais relevante: 1.425 dos 2.089 deals abertos (68%) não têm conta associada no CRM — não são um problema raro, são a maioria, e por isso ganharam tratamento de primeira classe na interface em vez de serem escondidos. A recomendação principal pra RevOps: o maior ganho de produtividade aqui não é o modelo de score, é forçar a captura de conta no CRM antes do deal virar "Engaging" — sem isso, 68% do pipeline não é sequer ranqueável.

---

## Solução

### Abordagem

Antes de escrever qualquer código, defini com o usuário (que conduziu o projeto comigo em modo de check-ins constantes) três decisões de arquitetura que o brief deixava abertas: (1) "IA-first" significaria narrativa determinística sempre presente (zero fricção, funciona sem API key) + uma camada opcional de chat com IA real por deal; (2) stack seria HTML/CSS/JS puro sem build step, pra eliminar qualquer fricção de "não rodou aqui"; (3) scoring seria regras+heurísticas com estatística de credibilidade (shrinkage), não ML, seguindo a orientação explícita do brief de que isso vale mais que um XGBoost sem interface.

A partir daí, o processo foi iterativo: cada tela era desenhada primeiro no Claude (canvas de design, link acima), validada comigo, e só depois portada pro código real. Erros de design (poluição visual, tags de card confundindo com filtros, paleta sem validação de contraste) foram pegos e corrigidos nessa fase de protótipo, antes de custar retrabalho no código.

### Resultados / Findings

- **Pipeline real inspecionado:** 8.800 oportunidades históricas → 2.089 abertas (500 em Prospecting, 1.589 em Engaging), 27 vendedores ativos, 6 managers, 3 regionais (Central/East/West), taxa de vitória geral do pipeline de 63,2%.
- **O achado que mudou o design:** 1.425 das 2.089 deals abertas (68%) não têm conta associada no CRM — e isso não é um problema de uma etapa específica: acontece tanto em Prospecting quanto (na maioria dos casos) em Engaging. Ou seja, deals avançam no pipeline sem que o vendedor tenha identificado o cliente. Isso não é ruído do dataset — é sinal de um problema real de disciplina de CRM.
- **Scoring explicável:** o "priority score" (percentil 0–100) vem de um "expected value" = valor médio histórico do produto × probabilidade de fechar (taxa base do pipeline ajustada por credibilidade estatística do vendedor/produto/setor, com shrinkage pra não deixar amostras pequenas dominarem) × multiplicador de momentum (tempo no estágio atual vs. mediana histórica). Cada deal expandido mostra essa conta feita, não só o número final.
- **Tratamento dos "sem conta":** em vez de escondê-los ou inventar um estágio de pipeline falso, eles aparecem no estágio real deles (Prospecting/Engaging) — no Kanban como uma 3ª coluna dedicada, na Lista agrupados no topo com um cabeçalho — mas sem posição no ranking de prioridade, porque não é possível agir sobre um deal sem saber quem é o cliente.
- **App funcional real:** lista priorizada + Kanban por estágio, filtros (vendedor/manager/região/estágio) com padrão rascunho→aplicar, busca, dark/light mode com paleta validada por contraste (WCAG), tudo responsivo mobile→desktop, navegação de login/OTP fake (challenge não pediu autenticação real).

### Recomendações

1. **Tornar "conta" obrigatória antes de mover um deal pra Engaging no CRM.** Esse é o ganho de maior alavancagem — 68% do pipeline hoje não é ranqueável, e é um problema de processo, não de modelo.
2. **Usar o priority score como triagem do dia, não como verdade absoluta.** O score é uma boa heurística de "por onde começar", mas o próprio breakdown mostra o nível de confiança (baixa quando o deal tem pouco histórico comparável) — vendedores devem ler a explicação, não só o número.
3. **Revisitar os 3 vendedores/produtos com maior volume de "sem conta"** primeiro — o app já permite filtrar por vendedor pra isso.

### Limitações

- **Ask-AI ao vivo só funciona com o backend Node rodando** (local ou num host com Node) — a versão publicamente hospedada hoje é só o front estático, então mostra o fallback. O backend existe, foi testado localmente, só não está deployado ao vivo (ver nota no link público).
- **Dataset tem posição fixa em 2017-12-31** (não há "hoje" real) — "momentum" é calculado relativo a essa data de referência, não à data de acesso.
- **Sem persistência real de nenhuma ação** (é read-only sobre um snapshot gerado do CSV) — de propósito: a fonte de verdade continua sendo o CRM real, este app não escreve nada de volta nele.
- **Login/OTP são navegação fake**, conforme escopo confirmado com o avaliador do challenge (o brief não pediu autenticação).

---

## Process Log — Como usei IA

> Este bloco é obrigatório.

### Ferramentas usadas

| Ferramenta | Para que usou |
|------------|--------------|
| Claude (chat, canvas de design) | Planejamento de arquitetura, decisões de produto (o que "IA-first" significa aqui), design visual iterativo (mockups `.dc.html`, paleta, design system) antes de qualquer código |
| Claude Code (Sonnet 5) | Implementação real do scoring engine (Python), frontend (HTML/CSS/JS), backend (Node), testes end-to-end com Playwright, deploy via SSH, git/commits |
| Playwright (via Claude Code) | Verificação real de cada mudança — screenshots e testes de interação, não só "parece certo" |

### Workflow

1. Recebi o brief do challenge e, antes de qualquer código, discuti com a IA as decisões de arquitetura abertas pelo brief (o que "IA-first" e "mobile-first" significam na prática, stack, hospedagem) — travei essa etapa de propósito porque a IA tentou pular direto pra implementação uma vez, e eu parei o processo pra reforçar isso.
2. Toda tela nova (lista, detalhe do deal, filtros, kanban, login/OTP) foi desenhada primeiro como protótipo estático no Claude (canvas), revisada por mim, corrigida (às vezes 2-3 vezes) antes de ir pro código.
3. A lógica de scoring foi implementada em Python puro, validada rodando contra o CSV real (não dados sintéticos), com cada heurística (shrinkage, momentum, credibilidade por vendedor/produto/setor) explicada e ajustada comigo antes de fechar.
4. O app real (HTML/CSS/JS/Node) foi implementado incrementalmente, com verificação via Playwright (screenshots reais, cliques reais, não suposição) depois de cada mudança de UI — isso pegou bugs reais que só apareceriam usando o app de verdade.
5. Deploy feito e depurado via SSH direto no host da Hostinger (não painel gráfico), incluindo diagnosticar por que o site publicado era o repositório errado.
6. Git: commits em Conventional Commits, só dentro da minha pasta de submissão, com push pro meu fork a cada lote de mudança revisado comigo.

### Onde a IA errou e como corrigi

- **Começou a construir sem checar comigo primeiro**, logo no início — parei o processo, pedi pra apagar o que tinha sido feito e recomeçar do zero seguindo o combinado (planejar antes de codar).
- **Bug de especificidade CSS**: um `[hidden]` do navegador foi silenciosamente sobrescrito por classes com `display` próprio (`.kanban-board`, `.banner`, `.load-more`), fazendo o Kanban aparecer no fim da lista mesmo "escondido". Eu reportei o sintoma ("o kanban aparece no final da página"), a IA diagnosticou a causa raiz e corrigiu com uma regra `[hidden]{display:none!important}` global.
- **Bug de ordem no CSS**: uma regra de padding do Kanban dentro de uma media query de desktop estava sendo sobrescrita por uma regra base (mesma especificidade, ordem de arquivo vencendo) — eu só percebi visualmente ("tem uma margem lateral que não devia"), a IA precisou investigar o computed style pra achar a causa real.
- **Bug de índice de array**: um `.map(cardHtml)` estava passando o índice do array como segundo argumento da função, fazendo todo card da lista (exceto o primeiro) ganhar silenciosamente o estilo compacto do Kanban — encontrado durante um teste automatizado, não visualmente.
- **Decisão de dados que eu revertei duas vezes**: a IA sugeriu (e eu inicialmente aceitei) separar deals sem conta como um bloco totalmente isolado, depois uma "3ª coluna" no Kanban — cada vez que eu via o resultado ao vivo, pedia pra ajustar de novo até chegar no formato atual (integrado ao estágio real, sem inventar um estágio falso).
- **Deploy publicou o repositório errado** — a IA investigou via SSH e achou a causa raiz real (a branch nunca tinha sido enviada pro GitHub), não só um symptom fix.

### O que eu adicionei que a IA sozinha não faria

- A leitura de que **68% de deals "sem conta" é a maioria, não uma exceção** — e que isso muda a decisão de produto de "esconder dado ruim" para "tratar como sinal de processo quebrado". Essa foi uma correção minha sobre uma sugestão inicial da IA.
- Toda a direção visual (paleta da marca G4 a partir do logo real, decisão de manter dourado só decorativo depois de ver o teste de contraste, layout desktop vs. mobile) veio de julgamento meu sobre as opções que a IA apresentava — a IA implementava, eu decidia o que ficava.
- O ritmo de trabalho (checkpoints obrigatórios antes de codar, rejeitar deferir correções pra "depois") foi uma regra que eu impus e mantive durante toda a sessão.
- A decisão final de escopo (sem autenticação real, sem persistência de escrita no CRM, IA viva como camada opcional e não como dependência) reflete prioridades de produto que vieram de mim, não de uma sugestão default da IA.

---

## Evidências

- [x] Git history real (ver histórico de commits na branch `submission/lucio-batistella`)
- [x] Este README documenta o processo completo de decisão
- [x] Screenshots do app real rodando — ver [`process-log/`](./process-log/)
- [ ] Chat exports — não aplicável (sessão de Claude Code, não chat avulso)

---

_Submissão enviada em: 2026-09-23_
