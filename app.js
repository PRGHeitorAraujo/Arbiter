import { searchDecisions } from "./searchEngine.js";
import { findConflict, findConflictsFor } from "./conflictEngine.js";

const sampleQueries = [
  "kafka vs rabbitmq",
  "monolito vs microsservicos",
  "postgres vs mongodb",
  "rest vs graphql",
  "redis vs memcached",
];

const state = {
  decisions: [],
  sources: [],
  query: "sistema de notificacoes - 50k usuarios - time de 3 devs - latencia toleravel 2s",
  results: [],
  filters: { topic: null, verdict: null },
  saved: new Set(JSON.parse(localStorage.getItem("arbiter.saved") || "[]")),
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function loadJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Nao foi possivel carregar ${path}: ${response.status}`);
  return response.json();
}

function normalizeDecision(decision) {
  return {
    ...decision,
    company: decision.empresa,
    sourceUrl: decision.source_url,
    color: decision.ui?.color || "#edeaff",
    tone: decision.ui?.tone || "#534ab7",
    year: decision.year || "s/d",
    title: decision.title || `${decision.verdict} ${decision.subject}`,
  };
}

function validateDecision(decision) {
  const required = ["id", "empresa", "topic", "subject", "verdict", "context", "reason", "source_url", "tags"];
  const missing = required.filter((f) => decision[f] === undefined || decision[f] === null);
  if (missing.length) throw new Error(`Decisao ${decision.id || "sem id"} sem campos: ${missing.join(", ")}`);
  if (!["adopted", "rejected", "kept"].includes(decision.verdict))
    throw new Error(`Decisao ${decision.id} tem verdict invalido: ${decision.verdict}`);
  if (!Array.isArray(decision.tags)) throw new Error(`Decisao ${decision.id} precisa ter tags como array`);
}

function verdictLabel(verdict) {
  return { adopted: "adotou", rejected: "rejeitou", kept: "manteve" }[verdict];
}

function applyFilters(decisions) {
  return decisions.filter((d) => {
    if (state.filters.topic && d.topic !== state.filters.topic) return false;
    if (state.filters.verdict && d.verdict !== state.filters.verdict) return false;
    return true;
  });
}

// ── render helpers ────────────────────────────────────────────────────────────

function renderChips(rootSelector) {
  $(rootSelector).innerHTML = sampleQueries
    .map((q) => `<button class="chip" type="button" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
    .join("");
}

function renderSources(rootSelector) {
  $(rootSelector).innerHTML = state.sources
    .map(
      (s) => `
        <article class="source-item">
          <span class="source-dot" style="background:${escapeHtml(s.color)}"></span>
          <div><strong>${escapeHtml(s.name)}</strong><span>${escapeHtml(s.type)}</span></div>
        </article>`
    )
    .join("");
}

function renderDecisionCard(decision) {
  const isSaved = state.saved.has(decision.id);
  return `
    <article class="decision-card" data-detail-for="${escapeHtml(decision.id)}">
      <div class="card-top">
        <span class="company-pill" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
        <span class="year">${escapeHtml(decision.year)}</span>
        <span class="tag ${escapeHtml(decision.verdict)}">${escapeHtml(verdictLabel(decision.verdict))}</span>
      </div>
      <h3>${escapeHtml(decision.title)}</h3>
      <p>${escapeHtml(decision.reason)}</p>
      <div class="card-actions">
        <a class="text-button" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">ver fonte</a>
        <button class="text-button" type="button" data-conflict-for="${escapeHtml(decision.id)}">ver conflito</button>
        <button class="text-button ${isSaved ? "saved" : ""}" type="button" data-save="${escapeHtml(decision.id)}">
          ${isSaved ? "salvo" : "+ salvar"}
        </button>
      </div>
    </article>`;
}

function renderConflictSide(decision) {
  return `
    <article class="conflict-side">
      <div class="card-top">
        <span class="company-pill" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
        <span class="year">${escapeHtml(decision.year)}</span>
      </div>
      <h3>${escapeHtml(verdictLabel(decision.verdict))} ${escapeHtml(decision.subject)}</h3>
      <p>${escapeHtml(decision.context)}. ${escapeHtml(decision.reason)}</p>
      <a class="source-link" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(new URL(decision.sourceUrl).hostname)}</a>
    </article>`;
}

function renderConflict(pair) {
  const panel = $("[data-conflict-panel]");
  if (!pair) {
    panel.hidden = true;
    panel.innerHTML = "";
    $("[data-conflict-pill]").innerHTML = "";
    return;
  }
  const [rejected, adopted] = pair;
  $("[data-conflict-pill]").innerHTML = `<span class="conflict-pill">conflito detectado — ${escapeHtml(rejected.company.toLowerCase())} vs ${escapeHtml(adopted.company.toLowerCase())}</span>`;
  panel.hidden = false;
  panel.innerHTML = `
    <h2>conflito — ${escapeHtml(rejected.subject.toLowerCase())} em contextos opostos</h2>
    <div class="conflict-compare">
      ${renderConflictSide(rejected)}
      <span class="versus">vs</span>
      ${renderConflictSide(adopted)}
    </div>`;
}

function renderFilterBar() {
  const topics = [...new Set(state.decisions.map((d) => d.topic))].sort();
  const verdicts = ["adopted", "rejected", "kept"];

  $("[data-filter-bar]").innerHTML = `
    <div class="filter-row">
      <span class="filter-label">tópico</span>
      <div class="filter-chips">
        ${topics
          .map(
            (t) =>
              `<button class="filter-chip ${state.filters.topic === t ? "active" : ""}" type="button" data-filter="topic" data-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`
          )
          .join("")}
      </div>
    </div>
    <div class="filter-row">
      <span class="filter-label">decisão</span>
      <div class="filter-chips">
        ${verdicts
          .map(
            (v) =>
              `<button class="filter-chip ${state.filters.verdict === v ? "active" : ""} ${v}" type="button" data-filter="verdict" data-value="${escapeHtml(v)}">${escapeHtml(verdictLabel(v))}</button>`
          )
          .join("")}
      </div>
    </div>`;
}

function renderComparisonTable(results) {
  const container = $("[data-comparison]");
  const bySubject = {};
  for (const d of results) (bySubject[d.subject] ??= []).push(d);
  const groups = Object.entries(bySubject).filter(([, ds]) => ds.length >= 2);

  if (!groups.length) { container.innerHTML = ""; return; }

  container.innerHTML = groups
    .map(
      ([subject, decisions]) => `
        <div class="comparison-wrap">
          <p class="comparison-eyebrow">${escapeHtml(subject)} — ${decisions.length} decisões</p>
          <table class="comparison">
            <thead><tr><th>empresa</th><th>contexto</th><th>decisão</th></tr></thead>
            <tbody>
              ${decisions
                .map(
                  (d) => `
                <tr class="comparison-row" data-detail-for="${escapeHtml(d.id)}">
                  <td><span class="company-pill" style="background:${escapeHtml(d.color)};color:${escapeHtml(d.tone)}">${escapeHtml(d.company)}</span></td>
                  <td class="comparison-context">${escapeHtml(d.context)}</td>
                  <td><span class="tag ${escapeHtml(d.verdict)}">${escapeHtml(verdictLabel(d.verdict))}</span></td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>`
    )
    .join("");
}

// ── views ─────────────────────────────────────────────────────────────────────

function switchTab(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  $$(".app-view").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
}

function renderResults() {
  const searched = searchDecisions(state.decisions, state.query);
  state.results = applyFilters(searched);
  $("[data-query-input]").value = state.query;
  $("[data-result-count]").textContent = `${state.results.length} decisoes encontradas`;
  $("[data-decision-grid]").innerHTML = state.results.map(renderDecisionCard).join("");
  renderComparisonTable(state.results);
  renderConflict(findConflict(state.results));
  renderFilterBar();
}

function renderSaved() {
  const items = state.decisions.filter((d) => state.saved.has(d.id));
  $("[data-saved-grid]").innerHTML = items.map(renderDecisionCard).join("");
  $("[data-saved-empty]").style.display = items.length ? "none" : "block";
  $("[data-export-saved]").hidden = items.length === 0;
}

function renderTopics() {
  const grouped = state.decisions.reduce((acc, d) => {
    (acc[d.topic] ??= []).push(d);
    return acc;
  }, {});

  $("[data-topics-content]").innerHTML = Object.entries(grouped)
    .map(
      ([topic, decisions]) => `
        <section class="topic-group">
          <h3 class="topic-label">${escapeHtml(topic)}</h3>
          <div class="decision-grid">${decisions.map(renderDecisionCard).join("")}</div>
        </section>`
    )
    .join("");
}

function renderDetail(decision) {
  const others = findConflictsFor(decision, state.decisions).map(([r, a]) => (r.id === decision.id ? a : r));

  const conflictsHtml = others.length
    ? `<div class="detail-conflicts">
        <h3>decisoes opostas</h3>
        <div class="conflict-compare">
          ${others.map(renderConflictSide).join('<span class="versus">vs</span>')}
        </div>
      </div>`
    : "";

  $("[data-detail-content]").innerHTML = `
    <div class="card-top">
      <span class="company-pill" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
      <span class="year">${escapeHtml(decision.year)}</span>
      <span class="tag ${escapeHtml(decision.verdict)}">${escapeHtml(verdictLabel(decision.verdict))}</span>
    </div>
    <h2 class="detail-title">${escapeHtml(decision.title)}</h2>
    <dl class="detail-body">
      <dt>contexto</dt><dd>${escapeHtml(decision.context)}</dd>
      <dt>razao</dt><dd>${escapeHtml(decision.reason)}</dd>
    </dl>
    <div class="detail-tags">${decision.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("")}</div>
    <a class="source-link" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">
      ver fonte → ${escapeHtml(new URL(decision.sourceUrl).hostname)}
    </a>
    ${conflictsHtml}`;

  switchTab("consultar");
  $("[data-decision-grid]").hidden = true;
  $("[data-conflict-panel]").hidden = true;
  $("[data-comparison]").hidden = true;
  $("[data-result-meta]").hidden = true;
  $("[data-detail-panel]").hidden = false;
}

function closeDetail() {
  $("[data-decision-grid]").hidden = false;
  $("[data-comparison]").hidden = false;
  $("[data-result-meta]").hidden = false;
  $("[data-detail-panel]").hidden = true;
  renderConflict(findConflict(state.results));
}

function renderLoadError(error) {
  $("[data-result-count]").textContent = "erro ao carregar dados";
  $("[data-decision-grid]").innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
}

// ── URL compartilhável ────────────────────────────────────────────────────────

function readHashQuery() {
  if (!location.hash.startsWith("#q=")) return null;
  return decodeURIComponent(location.hash.slice(3).replace(/\+/g, " "));
}

function setQuery(query) {
  state.query = query;
  renderResults();
  history.replaceState(null, "", "#q=" + encodeURIComponent(query));
  document.getElementById("app").scrollIntoView({ behavior: "smooth" });
}

// ── exportar salvos ───────────────────────────────────────────────────────────

function exportSavedAsMarkdown() {
  const items = state.decisions.filter((d) => state.saved.has(d.id));
  if (!items.length) return;

  const lines = ["# Decisões salvas — Arbiter\n"];
  for (const d of items) {
    lines.push(`## ${d.title} — ${d.company} (${d.year})\n`);
    lines.push(`**Tópico:** ${d.topic}  `);
    lines.push(`**Veredicto:** ${verdictLabel(d.verdict)}  `);
    lines.push(`**Contexto:** ${d.context}  `);
    lines.push(`**Razão:** ${d.reason}  `);
    lines.push(`**Tags:** ${d.tags.join(", ")}  `);
    lines.push(`**Fonte:** ${d.sourceUrl}\n`);
    lines.push("---\n");
  }

  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/markdown" }));
  Object.assign(document.createElement("a"), { href: url, download: "arbiter-salvos.md" }).click();
  URL.revokeObjectURL(url);
}

// ── events ────────────────────────────────────────────────────────────────────

function bindSearch(formSelector) {
  $(formSelector).addEventListener("submit", (event) => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("query")?.toString().trim();
    if (query) setQuery(query);
  });
}

function bindEvents() {
  bindSearch("[data-landing-search]");
  bindSearch("[data-app-search]");

  document.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-query]");
    if (chip) { setQuery(chip.dataset.query); return; }

    const filterChip = event.target.closest("[data-filter]");
    if (filterChip) {
      const { filter, value } = filterChip.dataset;
      state.filters[filter] = state.filters[filter] === value ? null : value;
      renderResults();
      return;
    }

    const saveButton = event.target.closest("[data-save]");
    if (saveButton) {
      const id = saveButton.dataset.save;
      state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
      localStorage.setItem("arbiter.saved", JSON.stringify([...state.saved]));
      renderResults();
      renderSaved();
      return;
    }

    const conflictButton = event.target.closest("[data-conflict-for]");
    if (conflictButton) {
      const decision = state.decisions.find((d) => d.id === conflictButton.dataset.conflictFor);
      if (!decision) return;
      switchTab("consultar");
      renderConflict(findConflict([decision, ...state.decisions]));
      $("[data-conflict-panel]").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (event.target.closest("[data-close-detail]")) { closeDetail(); return; }

    if (event.target.closest("[data-export-saved]")) { exportSavedAsMarkdown(); return; }

    const card = event.target.closest("[data-detail-for]");
    if (card && !event.target.closest("[data-save], [data-conflict-for], a")) {
      const decision = state.decisions.find((d) => d.id === card.dataset.detailFor);
      if (decision) renderDetail(decision);
      return;
    }

    const tab = event.target.closest("[data-view]");
    if (tab) {
      switchTab(tab.dataset.view);
      if (tab.dataset.view === "salvos") renderSaved();
      if (tab.dataset.view === "topicos") renderTopics();
    }
  });
}

// ── init ──────────────────────────────────────────────────────────────────────

async function init() {
  renderChips("[data-chip-row]");
  renderChips("[data-app-chips]");
  bindEvents();

  const hashQuery = readHashQuery();
  if (hashQuery) state.query = hashQuery;

  try {
    const [rawDecisions, sources] = await Promise.all([loadJson("data/decisions.json"), loadJson("data/sources.json")]);
    rawDecisions.forEach(validateDecision);
    state.decisions = rawDecisions.map(normalizeDecision);
    state.sources = sources;
    renderSources("[data-source-grid]");
    renderSources("[data-app-source-grid]");
    renderResults();
    renderSaved();
  } catch (error) {
    renderLoadError(error);
  }
}

init();
