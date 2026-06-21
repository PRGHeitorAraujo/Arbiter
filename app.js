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

// ── class constants ───────────────────────────────────────────────────────────

const CHIP = "bg-white border border-[#dedbd2] rounded-full text-[#8b877e] cursor-pointer text-[0.82rem] font-extrabold min-h-[29px] px-[17px] hover:bg-[#f0eee8] transition-colors duration-150";
const TEXT_BTN = "bg-transparent border-0 text-[#817d74] cursor-pointer text-[0.82rem] font-black p-0 hover:text-[#232323] transition-colors duration-150";
const PILL = "rounded-md text-[0.78rem] font-black px-2.5 py-1.5";
const YEAR = "text-[#a19d95] text-[0.82rem] font-extrabold";
const SRC_LINK = "bg-[#eaf3ff] rounded-lg text-[#4d81b2] inline-flex text-[0.82rem] font-black mt-2 px-3 py-[7px] hover:bg-blue-100 transition-colors";

const TAG = {
  adopted: "ml-auto rounded-full inline-flex items-center text-[0.78rem] font-black min-h-[25px] px-3 bg-[#e6f4df] text-[#47771d]",
  rejected: "ml-auto rounded-full inline-flex items-center text-[0.78rem] font-black min-h-[25px] px-3 bg-[#fff3d8] text-[#9c6414]",
  kept:     "ml-auto rounded-full inline-flex items-center text-[0.78rem] font-black min-h-[25px] px-3 bg-[#e8f1ff] text-[#2f679b]",
};

const TAG_FLAT = {
  adopted: "rounded-full inline-flex items-center text-[0.78rem] font-black min-h-[25px] px-3 bg-[#e6f4df] text-[#47771d]",
  rejected: "rounded-full inline-flex items-center text-[0.78rem] font-black min-h-[25px] px-3 bg-[#fff3d8] text-[#9c6414]",
  kept:     "rounded-full inline-flex items-center text-[0.78rem] font-black min-h-[25px] px-3 bg-[#e8f1ff] text-[#2f679b]",
};

// ── render helpers ────────────────────────────────────────────────────────────

function renderChips(rootSelector) {
  $(rootSelector).innerHTML = sampleQueries
    .map((q) => `<button class="${CHIP}" type="button" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
    .join("");
}

function renderSources(rootSelector) {
  $(rootSelector).innerHTML = state.sources
    .map(
      (s) => `
        <article class="flex items-center gap-2.5 bg-[#f0eee8] rounded-[7px] min-h-[58px] px-4 py-3">
          <span class="rounded-full flex-none w-[9px] h-[9px]" style="background:${escapeHtml(s.color)}"></span>
          <div>
            <strong class="text-[0.95rem] leading-[1.1] block font-bold">${escapeHtml(s.name)}</strong>
            <span class="text-[#85827c] text-[0.78rem] font-extrabold block">${escapeHtml(s.type)}</span>
          </div>
        </article>`
    )
    .join("");
}

function renderDecisionCard(decision) {
  const isSaved = state.saved.has(decision.id);
  return `
    <article class="card-appear bg-white border border-[#dfdcd4] rounded-xl shadow-sm cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 px-7 pt-7 pb-[18px]" data-detail-for="${escapeHtml(decision.id)}">
      <div class="flex items-center gap-2.5 mb-[18px]">
        <span class="${PILL}" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
        <span class="${YEAR}">${escapeHtml(decision.year)}</span>
        <span class="${escapeHtml(TAG[decision.verdict] || TAG.kept)}">${escapeHtml(verdictLabel(decision.verdict))}</span>
      </div>
      <h3 class="text-[1.12rem] font-bold mb-2 mt-0">${escapeHtml(decision.title)}</h3>
      <p class="text-[#85827c] text-[0.96rem] font-bold leading-[1.5] min-h-[54px] m-0">${escapeHtml(decision.reason)}</p>
      <div class="border-t border-[#ece9e2] flex gap-[18px] mt-[18px] pt-[14px]">
        <a class="${TEXT_BTN}" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">ver fonte</a>
        <button class="${TEXT_BTN}" type="button" data-conflict-for="${escapeHtml(decision.id)}">ver conflito</button>
        <button class="bg-transparent border-0 cursor-pointer text-[0.82rem] font-black p-0 transition-colors duration-150 ${isSaved ? "text-[#534ab7]" : "text-[#817d74] hover:text-[#232323]"}" type="button" data-save="${escapeHtml(decision.id)}">
          ${isSaved ? "salvo" : "+ salvar"}
        </button>
      </div>
    </article>`;
}

function renderConflictSide(decision) {
  return `
    <article class="bg-white rounded-lg p-[22px]">
      <div class="flex items-center gap-2.5 mb-[18px]">
        <span class="${PILL}" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
        <span class="${YEAR}">${escapeHtml(decision.year)}</span>
      </div>
      <h3 class="text-[1.12rem] font-bold mb-2 mt-0">${escapeHtml(verdictLabel(decision.verdict))} ${escapeHtml(decision.subject)}</h3>
      <p class="text-[#85827c] text-[0.96rem] font-bold leading-[1.5] m-0">${escapeHtml(decision.context)}. ${escapeHtml(decision.reason)}</p>
      <a class="${SRC_LINK}" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(new URL(decision.sourceUrl).hostname)}</a>
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
  $("[data-conflict-pill]").innerHTML = `<span class="bg-[#fff1d5] text-[#a0640e] rounded-full inline-flex items-center text-[0.78rem] font-black min-h-[25px] px-3">conflito detectado — ${escapeHtml(rejected.company.toLowerCase())} vs ${escapeHtml(adopted.company.toLowerCase())}</span>`;
  panel.hidden = false;
  panel.className = "bg-[#f0eee8] border border-[#dfdcd4] rounded-xl mt-7 p-7";
  panel.innerHTML = `
    <h2 class="text-[1.18rem] font-black mb-[22px] mt-0">conflito — ${escapeHtml(rejected.subject.toLowerCase())} em contextos opostos</h2>
    <div class="grid items-center gap-[22px]" style="grid-template-columns:1fr auto 1fr">
      ${renderConflictSide(rejected)}
      <span class="text-[#9f9a90] text-[0.8rem] font-black text-center">vs</span>
      ${renderConflictSide(adopted)}
    </div>`;
}

function filterChipCls(isActive, verdict) {
  const base = "rounded-full cursor-pointer text-[0.78rem] font-extrabold min-h-[26px] px-3 border transition-all duration-100";
  if (!isActive) return `${base} bg-white border-[#dfdcd4] text-[#85827c]`;
  const colors = { adopted: "bg-[#1c8a70] border-[#1c8a70]", rejected: "bg-[#a36f15] border-[#a36f15]", kept: "bg-[#2f7db6] border-[#2f7db6]" };
  return `${base} ${colors[verdict] || "bg-[#232323] border-[#232323]"} text-white`;
}

function renderFilterBar() {
  const topics = [...new Set(state.decisions.map((d) => d.topic))].sort();
  const verdicts = ["adopted", "rejected", "kept"];
  $("[data-filter-bar]").innerHTML = `
    <div class="flex items-center gap-2.5 flex-wrap">
      <span class="text-[#85827c] text-[0.75rem] font-black tracking-[0.06em] min-w-[52px] uppercase">tópico</span>
      <div class="flex flex-wrap gap-1.5">
        ${topics.map((t) => `<button class="${filterChipCls(state.filters.topic === t, null)}" type="button" data-filter="topic" data-value="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join("")}
      </div>
    </div>
    <div class="flex items-center gap-2.5 flex-wrap">
      <span class="text-[#85827c] text-[0.75rem] font-black tracking-[0.06em] min-w-[52px] uppercase">decisão</span>
      <div class="flex flex-wrap gap-1.5">
        ${verdicts.map((v) => `<button class="${filterChipCls(state.filters.verdict === v, v)}" type="button" data-filter="verdict" data-value="${escapeHtml(v)}">${escapeHtml(verdictLabel(v))}</button>`).join("")}
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
        <div class="bg-[#f0eee8] border border-[#dfdcd4] rounded-xl mb-5 overflow-hidden">
          <p class="border-b border-[#dfdcd4] text-[#85827c] text-[0.78rem] font-black tracking-[0.06em] m-0 px-[18px] py-3 uppercase">${escapeHtml(subject)} — ${decisions.length} decisões</p>
          <table class="w-full border-collapse">
            <thead><tr>
              <th class="text-[#85827c] text-[0.75rem] font-black tracking-[0.05em] px-[18px] py-2.5 text-left uppercase">empresa</th>
              <th class="text-[#85827c] text-[0.75rem] font-black tracking-[0.05em] px-[18px] py-2.5 text-left uppercase">contexto</th>
              <th class="text-[#85827c] text-[0.75rem] font-black tracking-[0.05em] px-[18px] py-2.5 text-left uppercase">decisão</th>
            </tr></thead>
            <tbody>
              ${decisions.map((d) => `
                <tr class="bg-white cursor-pointer hover:bg-[#edeaff] transition-colors" data-detail-for="${escapeHtml(d.id)}">
                  <td class="border-t border-[#dfdcd4] px-[18px] py-3 align-middle"><span class="${PILL}" style="background:${escapeHtml(d.color)};color:${escapeHtml(d.tone)}">${escapeHtml(d.company)}</span></td>
                  <td class="border-t border-[#dfdcd4] px-[18px] py-3 align-middle text-[#85827c] text-[0.88rem] font-bold max-w-[420px]">${escapeHtml(d.context)}</td>
                  <td class="border-t border-[#dfdcd4] px-[18px] py-3 align-middle"><span class="${TAG_FLAT[d.verdict] || TAG_FLAT.kept}">${escapeHtml(verdictLabel(d.verdict))}</span></td>
                </tr>`).join("")}
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
        <section class="mb-10">
          <h3 class="text-[#85827c] text-[0.78rem] font-black tracking-[0.08em] mb-3.5 mt-0 uppercase">${escapeHtml(topic)}</h3>
          <div class="grid gap-4 grid-cols-2">${decisions.map(renderDecisionCard).join("")}</div>
        </section>`
    )
    .join("");
}

function renderDetail(decision) {
  const header = $("[data-modal-header]");
  const initial = $("[data-modal-initial]");
  const title = $("[data-modal-title]");
  const body = $("[data-modal-body]");

  header.style.background = decision.color;
  header.style.color = decision.tone;
  initial.textContent = decision.company.charAt(0).toUpperCase();
  initial.style.color = decision.tone;
  title.textContent = decision.title;

  const others = findConflictsFor(decision, state.decisions).map(([r, a]) => (r.id === decision.id ? a : r));
  const conflictsHtml = others.length
    ? `<div class="bg-[#f0eee8] rounded-xl px-6 py-[22px]">
        <h3 class="text-[#85827c] text-[0.78rem] font-black tracking-[0.08em] uppercase mb-[18px] mt-0">decisoes opostas</h3>
        <div class="flex items-center gap-[22px]">
          ${others.map((d, i) => renderConflictSide(d) + (i < others.length - 1 ? '<span class="text-[#9f9a90] text-[0.8rem] font-black">vs</span>' : "")).join("")}
        </div>
      </div>`
    : "";

  body.innerHTML = `
    <div class="flex items-center gap-2.5">
      <span class="${PILL}" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
      <span class="${YEAR}">${escapeHtml(decision.year)}</span>
      <span class="${TAG[decision.verdict] || TAG.kept}">${escapeHtml(verdictLabel(decision.verdict))}</span>
    </div>
    <dl class="detail-body">
      <dt class="text-[#85827c] text-[0.78rem] font-black tracking-[0.06em] uppercase pt-[3px]">contexto</dt>
      <dd class="text-[#232323] font-bold leading-[1.55] m-0">${escapeHtml(decision.context)}</dd>
      <dt class="text-[#85827c] text-[0.78rem] font-black tracking-[0.06em] uppercase pt-[3px]">razao</dt>
      <dd class="text-[#232323] font-bold leading-[1.55] m-0">${escapeHtml(decision.reason)}</dd>
    </dl>
    <div class="flex flex-wrap gap-2">
      ${decision.tags.map((t) => `<span class="${CHIP} cursor-default">${escapeHtml(t)}</span>`).join("")}
    </div>
    <a class="${SRC_LINK}" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">
      ver fonte → ${escapeHtml(new URL(decision.sourceUrl).hostname)}
    </a>
    ${conflictsHtml}`;

  $("[data-modal-overlay]").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeDetail() {
  $("[data-modal-overlay]").classList.remove("open");
  document.body.style.overflow = "";
}

function renderLoadError(error) {
  $("[data-result-count]").textContent = "erro ao carregar dados";
  $("[data-decision-grid]").innerHTML = `<p class="bg-white border border-dashed border-[#dfdcd4] rounded-xl text-[#85827c] font-extrabold p-7">${escapeHtml(error.message)}</p>`;
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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDetail();
  });

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

    if (event.target.closest("[data-modal-close]")) { closeDetail(); return; }
    if (event.target === $("[data-modal-overlay]")) { closeDetail(); return; }
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
