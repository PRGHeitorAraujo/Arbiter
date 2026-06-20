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
  if (!response.ok) {
    throw new Error(`Nao foi possivel carregar ${path}: ${response.status}`);
  }
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
  const missing = required.filter((field) => decision[field] === undefined || decision[field] === null);
  if (missing.length) {
    throw new Error(`Decisao ${decision.id || "sem id"} sem campos: ${missing.join(", ")}`);
  }
  if (!["adopted", "rejected", "kept"].includes(decision.verdict)) {
    throw new Error(`Decisao ${decision.id} tem verdict invalido: ${decision.verdict}`);
  }
  if (!Array.isArray(decision.tags)) {
    throw new Error(`Decisao ${decision.id} precisa ter tags como array`);
  }
}

function renderChips(rootSelector) {
  const root = $(rootSelector);
  root.innerHTML = sampleQueries
    .map((query) => `<button class="chip" type="button" data-query="${escapeHtml(query)}">${escapeHtml(query)}</button>`)
    .join("");
}

function renderSources(rootSelector) {
  const root = $(rootSelector);
  root.innerHTML = state.sources
    .map(
      (source) => `
        <article class="source-item">
          <span class="source-dot" style="background:${escapeHtml(source.color)}"></span>
          <div>
            <strong>${escapeHtml(source.name)}</strong>
            <span>${escapeHtml(source.type)}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function verdictLabel(verdict) {
  return { adopted: "adotou", rejected: "rejeitou", kept: "manteve" }[verdict];
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
    </article>
  `;
}

function renderConflictSide(decision) {
  const sourceHost = new URL(decision.sourceUrl).hostname;
  return `
    <article class="conflict-side">
      <div class="card-top">
        <span class="company-pill" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
        <span class="year">${escapeHtml(decision.year)}</span>
      </div>
      <h3>${escapeHtml(verdictLabel(decision.verdict))} ${escapeHtml(decision.subject)}</h3>
      <p>${escapeHtml(decision.context)}. ${escapeHtml(decision.reason)}</p>
      <a class="source-link" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourceHost)}</a>
    </article>
  `;
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
  $("[data-conflict-pill]").innerHTML = `<span class="conflict-pill">conflito detectado — ${escapeHtml(
    rejected.company.toLowerCase()
  )} vs ${escapeHtml(adopted.company.toLowerCase())}</span>`;
  panel.hidden = false;
  panel.innerHTML = `
    <h2>conflito — ${escapeHtml(rejected.subject.toLowerCase())} em contextos opostos</h2>
    <div class="conflict-compare">
      ${renderConflictSide(rejected)}
      <span class="versus">vs</span>
      ${renderConflictSide(adopted)}
    </div>
  `;
}

function renderDetail(decision) {
  const conflicts = findConflictsFor(decision, state.decisions);
  const others = conflicts.map(([rej, adp]) => (rej.id === decision.id ? adp : rej));

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
      <dt>contexto</dt>
      <dd>${escapeHtml(decision.context)}</dd>
      <dt>razao</dt>
      <dd>${escapeHtml(decision.reason)}</dd>
    </dl>
    <div class="detail-tags">${decision.tags.map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("")}</div>
    <a class="source-link" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">
      ver fonte → ${escapeHtml(new URL(decision.sourceUrl).hostname)}
    </a>
    ${conflictsHtml}
  `;

  $("[data-decision-grid]").hidden = true;
  $("[data-conflict-panel]").hidden = true;
  $("[data-result-meta]").hidden = true;
  $("[data-detail-panel]").hidden = false;
}

function closeDetail() {
  $("[data-decision-grid]").hidden = false;
  $("[data-result-meta]").hidden = false;
  $("[data-detail-panel]").hidden = true;
  renderConflict(findConflict(state.results));
}

function renderResults() {
  state.results = searchDecisions(state.decisions, state.query);
  $("[data-query-input]").value = state.query;
  $("[data-result-count]").textContent = `${state.results.length} decisoes encontradas`;
  $("[data-decision-grid]").innerHTML = state.results.map(renderDecisionCard).join("");
  renderConflict(findConflict(state.results));
}

function renderSaved() {
  const savedItems = state.decisions.filter((decision) => state.saved.has(decision.id));
  $("[data-saved-grid]").innerHTML = savedItems.map(renderDecisionCard).join("");
  $("[data-saved-empty]").style.display = savedItems.length ? "none" : "block";
}

function renderLoadError(error) {
  const message = escapeHtml(error.message);
  $("[data-result-count]").textContent = "erro ao carregar dados";
  $("[data-decision-grid]").innerHTML = `<p class="empty-state">${message}</p>`;
}

function setQuery(query) {
  state.query = query;
  renderResults();
  location.hash = "app";
}

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
    if (chip) setQuery(chip.dataset.query);

    const saveButton = event.target.closest("[data-save]");
    if (saveButton) {
      const id = saveButton.dataset.save;
      state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
      localStorage.setItem("arbiter.saved", JSON.stringify([...state.saved]));
      renderResults();
      renderSaved();
    }

    const conflictButton = event.target.closest("[data-conflict-for]");
    if (conflictButton) {
      const decision = state.decisions.find((item) => item.id === conflictButton.dataset.conflictFor);
      if (!decision) return;
      const pair = findConflict([decision, ...state.decisions]);
      renderConflict(pair);
      $("[data-conflict-panel]").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    if (event.target.closest("[data-close-detail]")) {
      closeDetail();
      return;
    }

    const card = event.target.closest("[data-detail-for]");
    if (card && !event.target.closest("[data-save], [data-conflict-for], a")) {
      const decision = state.decisions.find((d) => d.id === card.dataset.detailFor);
      if (decision) renderDetail(decision);
    }

    const tab = event.target.closest("[data-view]");
    if (tab) {
      $$(".tab").forEach((item) => item.classList.toggle("active", item === tab));
      $$(".app-view").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab.dataset.view));
      if (tab.dataset.view === "salvos") renderSaved();
    }
  });
}

async function init() {
  renderChips("[data-chip-row]");
  renderChips("[data-app-chips]");
  bindEvents();

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
