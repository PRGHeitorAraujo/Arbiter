# Roadmap — Arbiter

Formato Now / Next / Later, ordenado por dependência (o que destrava o quê), não só por data.

## Feito ✓

Itens concluídos nos commits recentes:

| Item | Status |
|---|---|
| Detector de conflito sobre base completa (não 4 resultados truncados) | ✓ |
| Conflict pool ignora filtros de veredicto/empresa — só usa query + tópico | ✓ |
| Botão "ver conflito" oculto em cards sem conflito real na base | ✓ |
| Scroll para painel de conflito só ocorre quando par existe | ✓ |
| Reset de `state.query` em `/app` (sem `q`) e `/t/<topico>` | ✓ |
| Filtro de veredicto sincronizado com a URL (`?v=`) | ✓ |
| Filtro de empresa sincronizado com a URL (`?co=`) | ✓ |
| Try/catch em `new URL(sourceUrl)` e no parse do `localStorage` | ✓ |
| Compartilhar decisão — botão "copiar link" no modal | ✓ |
| Histórico de busca recente (chips via localStorage) | ✓ |
| Busca/filtro por empresa (chips na barra de filtros) | ✓ |
| "Decisões relacionadas" no modal de detalhe (mesmo tópico) | ✓ |
| "Decisões opostas" no modal de detalhe | ✓ |
| Score de confiança da fonte (ADR / eng blog / thread) | ✓ |
| Tratamento explícito de "nenhum resultado" | ✓ |
| Paginação / "ver mais" (substituindo corte fixo) | ✓ |
| Modo compacto vs. expandido nos cards | ✓ |
| Atalho de teclado / command palette (Cmd+K) | ✓ |
| Routing SPA completo (`/app`, `/d/<slug>`, `/t/<topic>`) | ✓ |

## Now — próximo passo técnico

| Item | Por quê é o próximo |
|---|---|
| Pipeline de ingestão (`files/arbiter_spec.pdf`) | A busca e o conflito agora expõem o que existe — o gargalo virou volume de dados, não UX |
| Expandir corpus (Netflix, Uber, GitHub, Notion, Linear, 200+ decisões) | Base atual tem ~113 decisões; mais volume = mais conflitos detectados = mais valor |

## Later — direcional

| Item | Por quê fica pra depois |
|---|---|
| Decisões com data de revisão (ex: Discord voltando ao monolito) | Exige decidir a estrutura (`revised_at` simples vs. link explícito de substituição) — vale junto com expansão de corpus |
| Filtro de empresa como dropdown/busca em vez de chips | Quando corpus crescer além de ~30 empresas únicas os chips vão ficar longos demais |
| Exportar busca atual como `.md` (além dos salvos) | Pequena extensão do que já existe, mas depende do corpus ter volume suficiente pra valer |
