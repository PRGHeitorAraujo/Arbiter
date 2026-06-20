# Arbiter

Arbiter e um buscador de decisoes reais de engenharia. O usuario descreve o contexto do problema e recebe decisoes tomadas por times reais, com fonte linkada e um painel de conflito quando empresas chegaram a conclusoes opostas.

## Rodar localmente

```powershell
npm run dev
```

Abra `http://127.0.0.1:5173`. O servidor local usa apenas Node.js nativo, sem instalar dependencias.

## O que ja existe

- Landing page baseada em `files/arbiter_design_opt.png`.
- App de consulta com busca contextual.
- Corpus versionado em `data/decisions.json`.
- Fontes indexadas em `data/sources.json`.
- Schema documentado em `data/schema.md`.
- Cards de decisao com ranking simples por termos.
- Fontes indexadas e area de salvos.
- Painel de conflito condicional para decisoes opostas sobre o mesmo `topic` e `subject`.

## Proximo passo tecnico

Implementar o pipeline de ingestao descrito em `files/arbiter_spec.pdf`: extrair decisoes de documentos reais para o schema em `data/schema.md` e comparar a saida com o par validado Dagster vs Hotstar.
