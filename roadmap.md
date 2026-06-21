# Roadmap — Arbiter

Formato Now / Next / Later, ordenado por dependência (o que destrava o quê), não só por data.

## Now — correções em andamento

Pré-requisito de tudo que vem depois: a busca e o detector de conflito precisam expor o que já existe na base, antes de adicionar mais dados ou mais features em cima.

| Item | Por quê é bloqueador |
|---|---|
| Detector de conflito rodar sobre a base completa, não sobre os 4 resultados truncados | Sem isso, "decisões relacionadas" e qualquer expansão de corpus vão esconder conflitos em vez de mostrar mais |
| Reset de `state.query` nas rotas `/app` (sem `q`) e `/t/<topico>` | Sem isso, filtros e busca "por empresa" futuros vão herdar estado velho de forma confusa |
| Sincronizar filtro de veredicto com a URL | Pré-requisito pra "compartilhar decisão" funcionar de forma consistente com filtros ativos |
| Try/catch em `new URL(sourceUrl)` e no parse do `localStorage` | Blindagem antes de aumentar volume de dados (mais dados = mais chance de uma URL malformada quebrar tudo) |

## Next — 1 a 3 meses

Coisas com escopo claro, prioridade alta, dependentes só do "Now" estar resolvido.

| Item | Depende de | Esforço |
|---|---|---|
| Compartilhar decisão (botão "copiar link" no modal) | Routing `/d/<slug>` já existe — só falta o reset de query/filtro estar correto | Baixo |
| Histórico de busca recente (chips, localStorage) | Nada — pode entrar em paralelo com qualquer coisa | Baixo |
| Busca/filtro por empresa | Nada técnico, mas concorre com o peso atual de `company` no `scoreDecision` — melhor como filtro dedicado do que via busca textual | Baixo–médio |
| "Decisões relacionadas" no detalhe | Detector de conflito corrigido (reaproveita `findConflictsFor`, relaxando o filtro de `subject` pra só `topic`) | Baixo (a lógica já existe, é variação) |
| Score de confiança da fonte (ADR / eng blog / thread) | Nada — `sources.json` já tem `type` por fonte, é só expor no card | Baixo–médio |
| Tratamento explícito de "nenhum resultado" | Nada | Trivial |

## Later — 3+ meses, ou direcional

Bom valor, mas ou tem escopo maior, ou faz mais sentido depois que o corpus e a busca estiverem mais maduros.

| Item | Por quê fica pra depois |
|---|---|
| Expandir corpus (Netflix, Uber, GitHub, Notion, Linear, 100+ decisões) | Hoje a base já tem 113 decisões — o gargalo não é volume, é que a busca/conflito escondem o que já existe. Expandir antes de corrigir o "Now" só esconde mais coisa, não menos |
| Decisões com data de revisão (ex: Discord voltando ao monolito) | Bom modelo de dado, mas exige decidir a estrutura (campo de data simples vs. link explícito "esta decisão substitui `<id>`) — vale pensar junto com a expansão de corpus, não isolado |
| Paginação / "ver mais" na busca, substituindo o corte fixo em 4 | Decisão de UX que interage direto com o item do "Now" sobre conflito — melhor decidir depois de ver o impacto da correção |
| Modo compacto vs. expandido nos cards | Só fica necessário se a busca passar a mostrar mais que 4 resultados — depende do item anterior |
| Atalho de teclado / command palette (Cmd+K) | Maior custo de implementação da lista (foco, navegação, scroll). Vale mais depois que busca por empresa e histórico recente já estiverem prontos — o palette vai precisar consumir essas duas coisas |

## Dependências cruzadas a observar

- **Corte de 4 resultados** é o nó central: afeta detecção de conflito (Now), modo compacto (Later) e indiretamente justifica adiar expansão de corpus.
- **Routing (`/d/`, `/t/`, `/app?q=`)** já existe e é reaproveitado por: compartilhar decisão, histórico de busca, filtro por empresa (se vier a ter URL própria).
- **`sources.json` com `type` por fonte** já existe e é reaproveitado por: score de confiança da fonte — sem precisar de schema novo.

## O que isso significa pra essa semana

Sugestão de ordem dentro do que já está sendo corrigido: depois do "Now", os três itens de menor esforço e maior payback imediato são **copiar link**, **histórico de busca recente** e **"nenhum resultado" explícito** — nenhum depende de decisão de produto adicional, só execução.
