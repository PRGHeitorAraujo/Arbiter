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

function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

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

function scoreDecision(decision, query) {
  const normalizedQuery = normalize(query);
  const haystack = normalize(
    [
      decision.company,
      decision.topic,
      decision.subject,
      decision.title,
      decision.context,
      decision.reason,
      decision.tags.join(" "),
    ].join(" ")
  );
  const words = normalizedQuery.split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const exactSubject = normalizedQuery.includes(normalize(decision.subject)) ? 4 : 0;
  const exactTopic = decision.tags.some((tag) => normalizedQuery.includes(normalize(tag))) ? 3 : 0;
  return words.reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), exactSubject + exactTopic);
}

function searchDecisions(query) {
  return state.decisions
    .map((decision) => ({ ...decision, score: scoreDecision(decision, query) }))
    .filter((decision) => decision.score > 0 || query.trim().length < 3)
    .sort((a, b) => b.score - a.score || a.company.localeCompare(b.company))
    .slice(0, 4);
}

function findConflict(results) {
  for (const left of results) {
    const opposite = results.find(
      (right) =>
        right.id !== left.id &&
        right.topic === left.topic &&
        right.subject === left.subject &&
        right.verdict !== left.verdict &&
        [left.verdict, right.verdict].includes("adopted") &&
        [left.verdict, right.verdict].includes("rejected")
    );
    if (opposite) {
      return left.verdict === "rejected" ? [left, opposite] : [opposite, left];
    }
  }
  return null;
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
  return {
    adopted: "adotou",
    rejected: "rejeitou",
    kept: "manteve",
  }[verdict];
}

function renderDecisionCard(decision) {
  const isSaved = state.saved.has(decision.id);
  return `
    <article class="decision-card">
      <div class="card-top">
        <span class="company-pill" style="background:${escapeHtml(decision.color)}; color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
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

function renderConflict(pair) {
  const panel = $("[data-conflict-panel]");
  if (!pair) {
    panel.hidden = true;
    panel.innerHTML = "";
    $("[data-conflict-pill]").innerHTML = "";
    return;
  }

  const [rejected, adopted] = pair;
  $("[data-conflict-pill]").innerHTML = `<span class="conflict-pill">conflito detectado - ${escapeHtml(
    rejected.company.toLowerCase()
  )} vs ${escapeHtml(adopted.company.toLowerCase())}</span>`;
  panel.hidden = false;
  panel.innerHTML = `
    <h2>conflito - ${escapeHtml(rejected.subject.toLowerCase())} em contextos opostos</h2>
    <div class="conflict-compare">
      ${renderConflictSide(rejected)}
      <span class="versus">vs</span>
      ${renderConflictSide(adopted)}
    </div>
  `;
}

function renderConflictSide(decision) {
  const sourceHost = new URL(decision.sourceUrl).hostname;
  return `
    <article class="conflict-side">
      <div class="card-top">
        <span class="company-pill" style="background:${escapeHtml(decision.color)}; color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
        <span class="year">${escapeHtml(decision.year)}</span>
      </div>
      <h3>${decision.verdict === "rejected" ? "saiu sem Kafka" : "usou Kafka"}</h3>
      <p>${escapeHtml(decision.context)}. ${escapeHtml(decision.reason)}</p>
      <a class="source-link" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourceHost)}</a>
    </article>
  `;
}

function renderResults() {
  state.results = searchDecisions(state.query);
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
