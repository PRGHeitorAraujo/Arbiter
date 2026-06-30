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
  query: "",
  results: [],
  filters: { topic: null, verdict: null, company: null },
  saved: new Set((() => { try { return JSON.parse(localStorage.getItem("arbiter.saved") || "[]"); } catch { return []; } })()),
  slugMap: new Map(),
  displayLimit: 12,
  viewMode: "grid",
  hasConflict: new Set(),
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

function hostname(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function sourceType(url) {
  try {
    const h = new URL(url).hostname;
    if (h.includes("github.com")) return "ADR";
    if (h.includes("ycombinator.com") || h.includes("reddit.com") || h.includes("lobste.rs")) return "thread";
    return "eng blog";
  } catch { return "eng blog"; }
}

function getSearchHistory() {
  try { return JSON.parse(localStorage.getItem("arbiter.history") || "[]"); } catch { return []; }
}

function addToSearchHistory(query) {
  const updated = [query, ...getSearchHistory().filter((q) => q !== query)].slice(0, 5);
  localStorage.setItem("arbiter.history", JSON.stringify(updated));
}

function renderSearchHistory() {
  const row = $("[data-history-row]");
  if (!row) return;
  const history = getSearchHistory();
  if (!history.length) { row.innerHTML = ""; return; }
  row.innerHTML = `<span class="text-[#a19d95] text-[0.72rem] font-black tracking-[0.06em] uppercase">recentes</span>`
    + history.map((q) => `<button class="bg-transparent border border-[#dedbd2] rounded-full text-[#8b877e] cursor-pointer text-[0.78rem] font-extrabold px-3 py-[3px] hover:bg-[#f0eee8] transition-colors" type="button" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("");
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
    revisedAt: decision.revised_at || null,
    revisionNote: decision.revision_note || null,
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
    if (state.filters.company && d.company !== state.filters.company) return false;
    return true;
  });
}

// Pool para detecção de conflito: aplica query e filtro de tópico, mas ignora
// veredicto e empresa — sem isso, filtrar por "adotou" esconde conflitos.
function getConflictPool() {
  const searched = searchDecisions(state.decisions, state.query);
  return state.filters.topic ? searched.filter((d) => d.topic === state.filters.topic) : searched;
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

function renderDecisionCard(decision, inSavedPanel = false) {
  const isSaved = state.saved.has(decision.id);
  return `
    <article class="card-appear bg-white border border-[#dfdcd4] rounded-xl shadow-sm cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 px-7 pt-7 pb-[18px]" data-detail-for="${escapeHtml(decision.id)}">
      <div class="flex items-center gap-2.5 mb-[18px]">
        <span class="${PILL}" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
        <span class="${YEAR}">${escapeHtml(decision.year)}</span>
        ${decision.revisedAt ? `<span class="text-[0.72rem] font-black px-2 py-[2px] rounded-full bg-[#fff3d8] text-[#9c6414]">rev. ${escapeHtml(decision.revisedAt)}</span>` : ""}
        <span class="${escapeHtml(TAG[decision.verdict] || TAG.kept)}">${escapeHtml(verdictLabel(decision.verdict))}</span>
      </div>
      <h3 class="text-[1.12rem] font-bold mb-2 mt-0">${escapeHtml(decision.title)}</h3>
      <p class="text-[#85827c] text-[0.96rem] font-bold leading-[1.5] min-h-[54px] m-0">${escapeHtml(decision.reason)}</p>
      <div class="border-t border-[#ece9e2] flex gap-[18px] mt-[18px] pt-[14px]">
        <a class="${TEXT_BTN}" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">ver fonte <span class="opacity-40 font-extrabold">${escapeHtml(sourceType(decision.sourceUrl))}</span></a>
        ${state.hasConflict.has(decision.id) ? `<button class="${TEXT_BTN}" type="button" data-conflict-for="${escapeHtml(decision.id)}">ver conflito</button>` : ""}
        <button class="bg-transparent border-0 cursor-pointer text-[0.82rem] font-black p-0 transition-colors duration-150 ${isSaved ? "text-[#534ab7]" : "text-[#817d74] hover:text-[#232323]"}" type="button" data-save="${escapeHtml(decision.id)}">
          ${isSaved ? (inSavedPanel ? "— remover" : "salvo") : "+ salvar"}
        </button>
      </div>
    </article>`;
}

function renderCompactCard(decision) {
  const isSaved = state.saved.has(decision.id);
  return `
    <div class="flex items-center gap-3 bg-white border border-[#dfdcd4] rounded-lg px-4 py-2.5 cursor-pointer hover:bg-[#f8f7f3] transition-colors" data-detail-for="${escapeHtml(decision.id)}">
      <span class="${PILL} flex-none" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
      <span class="${YEAR} flex-none">${escapeHtml(decision.year)}</span>
      ${decision.revisedAt ? `<span class="text-[0.68rem] font-black px-1.5 py-[1px] rounded-full bg-[#fff3d8] text-[#9c6414] flex-none">rev.</span>` : ""}
      <span class="font-bold text-[0.9rem] flex-1 truncate">${escapeHtml(decision.title)}</span>
      <span class="${TAG_FLAT[decision.verdict] || TAG_FLAT.kept} flex-none">${escapeHtml(verdictLabel(decision.verdict))}</span>
      <a class="text-[#4d81b2] text-[0.78rem] font-black hover:underline flex-none" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${escapeHtml(sourceType(decision.sourceUrl))}</a>
      <button class="bg-transparent border-0 cursor-pointer text-[0.78rem] font-black p-0 flex-none transition-colors ${isSaved ? "text-[#534ab7]" : "text-[#a19d95] hover:text-[#232323]"}" type="button" data-save="${escapeHtml(decision.id)}">${isSaved ? "salvo" : "salvar"}</button>
    </div>`;
}

function renderConflictSide(decision) {
  return `
    <article class="bg-white rounded-lg p-[22px] cursor-pointer hover:shadow-md transition-shadow duration-150" data-detail-for="${escapeHtml(decision.id)}">
      <div class="flex items-center gap-2.5 mb-[18px]">
        <span class="${PILL}" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
        <span class="${YEAR}">${escapeHtml(decision.year)}</span>
      </div>
      <h3 class="text-[1.12rem] font-bold mb-2 mt-0">${escapeHtml(verdictLabel(decision.verdict))} ${escapeHtml(decision.subject)}</h3>
      <p class="text-[#85827c] text-[0.96rem] font-bold leading-[1.5] m-0">${escapeHtml(decision.context)}. ${escapeHtml(decision.reason)}</p>
      <a class="${SRC_LINK}" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${escapeHtml(hostname(decision.sourceUrl))}</a>
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
  const companies = [...new Set(state.decisions.map((d) => d.company))].sort();
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
    </div>
    <div class="flex items-center gap-2.5">
      <span class="text-[#85827c] text-[0.75rem] font-black tracking-[0.06em] min-w-[52px] uppercase">empresa</span>
      <select class="bg-white border border-[#dfdcd4] rounded-lg text-[0.82rem] font-extrabold text-[#232323] px-3 py-1.5 cursor-pointer outline-none focus:border-[#534ab7] transition-colors" data-company-select>
        <option value="">todas</option>
        ${companies.map((c) => `<option value="${escapeHtml(c)}" ${state.filters.company === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
      </select>
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

  const hasActiveSearch = !!(state.query || state.filters.topic || state.filters.verdict || state.filters.company);

  $("[data-query-input]").value = state.query;
  $("[data-result-count]").textContent = `${state.results.length} decisoes encontradas`;

  // usar style.display para sobrescrever classes Tailwind (hidden attr nao sobrescreve flex/inline-flex)
  $("[data-filter-bar]").style.display = hasActiveSearch ? "" : "none";
  $("[data-result-meta]").style.display = hasActiveSearch ? "" : "none";

  const grid = $("[data-decision-grid]");
  const isCompact = state.viewMode === "compact";
  grid.className = isCompact ? "flex flex-col gap-2" : "grid gap-4 grid-cols-2";

  const visible = state.results.slice(0, state.displayLimit);
  const remaining = state.results.length - visible.length;

  if (!hasActiveSearch) {
    // sem busca ativa: mostra primeiras 12 decisoes como conteudo exploravel
    grid.innerHTML = state.decisions.slice(0, 12).map(isCompact ? renderCompactCard : renderDecisionCard).join("");
  } else {
    grid.innerHTML = state.results.length
      ? visible.map(isCompact ? renderCompactCard : renderDecisionCard).join("")
      : `<div class="${isCompact ? "" : "col-span-2 "}bg-white border border-dashed border-[#dfdcd4] rounded-xl text-[#85827c] p-8 text-center">
          <p class="font-black text-[1rem] mb-1 mt-0 text-[#232323]">nenhuma decisão encontrada</p>
          <p class="font-bold text-[0.9rem] m-0">tente outros termos ou remova algum filtro ativo</p>
        </div>`;
  }

  const verMaisBtn = $("[data-ver-mais]");
  if (verMaisBtn) {
    verMaisBtn.style.display = (hasActiveSearch && remaining > 0) ? "" : "none";
    if (remaining > 0) verMaisBtn.textContent = `ver mais ${remaining} decisões`;
  }

  const viewToggle = $("[data-view-toggle]");
  if (viewToggle) {
    viewToggle.title = isCompact ? "modo grade" : "modo compacto";
    viewToggle.innerHTML = isCompact
      ? `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="8" y="1" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="1" y="8" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/><rect x="8" y="8" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.5"/></svg>`
      : `<svg width="15" height="15" viewBox="0 0 15 15" fill="none"><line x1="1" y1="3.5" x2="14" y2="3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="7.5" x2="14" y2="7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="1" y1="11.5" x2="14" y2="11.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }

  if (hasActiveSearch) {
    renderComparisonTable(state.results);
    renderConflict(findConflict(getConflictPool()));
    renderFilterBar();
  } else {
    $("[data-comparison]").innerHTML = "";
    renderConflict(null);
  }
}

function renderSaved() {
  const items = state.decisions.filter((d) => state.saved.has(d.id));
  $("[data-saved-grid]").innerHTML = items.map((d) => renderDecisionCard(d, true)).join("");
  $("[data-saved-empty]").style.display = items.length ? "none" : "block";
  $("[data-export-saved]").hidden = items.length === 0;
}

const _collapsedTopics = new Set();

function renderTopics() {
  const grouped = state.decisions.reduce((acc, d) => {
    (acc[d.topic] ??= []).push(d);
    return acc;
  }, {});
  $("[data-topics-content]").innerHTML = Object.entries(grouped)
    .map(([topic, decisions]) => {
      const collapsed = _collapsedTopics.has(topic);
      return `
        <section class="mb-3 border border-[#dfdcd4] rounded-xl overflow-hidden">
          <button type="button" class="w-full flex items-center justify-between px-5 py-4 bg-white hover:bg-[#f8f7f3] transition-colors cursor-pointer border-0 text-left" data-topic-toggle="${escapeHtml(topic)}">
            <div class="flex items-center gap-3">
              <span class="text-[0.78rem] font-black tracking-[0.08em] uppercase text-[#85827c]">${escapeHtml(topic)}</span>
              <span class="text-[0.72rem] font-black text-[#a19d95]">${decisions.length} ${decisions.length === 1 ? "decisão" : "decisões"}</span>
            </div>
            <svg class="text-[#a19d95] flex-none transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 5l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div class="px-5 pb-5 pt-4 border-t border-[#dfdcd4] bg-[#faf9f6]" data-topic-body="${escapeHtml(topic)}" ${collapsed ? "hidden" : ""}>
            <div class="grid gap-4 grid-cols-2">${decisions.map(renderDecisionCard).join("")}</div>
          </div>
        </section>`;
    })
    .join("");
}

function renderDetail(decision, pushUrl = true) {
  const header = $("[data-modal-header]");
  const initial = $("[data-modal-initial]");
  const title = $("[data-modal-title]");
  const body = $("[data-modal-body]");

  header.style.background = decision.color;
  header.style.color = decision.tone;
  initial.textContent = decision.company.charAt(0).toUpperCase();
  initial.style.color = decision.tone;
  title.textContent = decision.title;

  const isSaved = state.saved.has(decision.id);
  const others = findConflictsFor(decision, state.decisions).map(([r, a]) => (r.id === decision.id ? a : r));
  const conflictsHtml = others.length
    ? `<div class="bg-[#f0eee8] rounded-xl px-6 py-[22px]">
        <h3 class="text-[#85827c] text-[0.78rem] font-black tracking-[0.08em] uppercase mb-[18px] mt-0">decisoes opostas</h3>
        <div class="flex flex-col gap-3">
          ${others.map((d, i) => renderConflictSide(d) + (i < others.length - 1 ? '<div class="text-[#9f9a90] text-[0.8rem] font-black text-center py-1">vs</div>' : "")).join("")}
        </div>
      </div>`
    : "";

  const related = state.decisions.filter((d) => d.id !== decision.id && d.topic === decision.topic).slice(0, 4);
  const relatedHtml = related.length
    ? `<div class="bg-[#f5f4f0] rounded-xl px-6 py-[22px]">
        <h3 class="text-[#85827c] text-[0.78rem] font-black tracking-[0.08em] uppercase mb-[14px] mt-0">mesmo tópico — ${escapeHtml(decision.topic)}</h3>
        <div class="flex flex-col gap-2">
          ${related.map((d) => `
            <div class="bg-white rounded-lg px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-[#edeaff] transition-colors" data-detail-for="${escapeHtml(d.id)}">
              <span class="${PILL} flex-none" style="background:${escapeHtml(d.color)};color:${escapeHtml(d.tone)}">${escapeHtml(d.company)}</span>
              <span class="font-bold text-[0.9rem] flex-1 leading-[1.3]">${escapeHtml(d.title)}</span>
              <span class="${TAG_FLAT[d.verdict] || TAG_FLAT.kept} flex-none">${escapeHtml(verdictLabel(d.verdict))}</span>
            </div>`).join("")}
        </div>
      </div>`
    : "";

  body.innerHTML = `
    <div class="flex items-center gap-2.5">
      <span class="${PILL}" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
      <span class="${YEAR}">${escapeHtml(decision.year)}</span>
      <span class="${TAG[decision.verdict] || TAG.kept}">${escapeHtml(verdictLabel(decision.verdict))}</span>
    </div>
    ${decision.revisedAt ? `<div class="bg-[#fff8e8] border border-[#f0d880] rounded-lg px-4 py-3">
      <p class="text-[0.75rem] font-black text-[#9c6414] uppercase tracking-[0.06em] mb-1 mt-0">revisado em ${escapeHtml(decision.revisedAt)}</p>
      ${decision.revisionNote ? `<p class="text-[#232323] font-bold text-[0.9rem] m-0">${escapeHtml(decision.revisionNote)}</p>` : ""}
    </div>` : ""}
    <dl class="detail-body">
      <dt class="text-[#85827c] text-[0.78rem] font-black tracking-[0.06em] uppercase pt-[3px]">contexto</dt>
      <dd class="text-[#232323] font-bold leading-[1.55] m-0">${escapeHtml(decision.context)}</dd>
      <dt class="text-[#85827c] text-[0.78rem] font-black tracking-[0.06em] uppercase pt-[3px]">razao</dt>
      <dd class="text-[#232323] font-bold leading-[1.55] m-0">${escapeHtml(decision.reason)}</dd>
    </dl>
    <div class="flex flex-wrap gap-2">
      ${decision.tags.map((t) => `<span class="${CHIP} cursor-default">${escapeHtml(t)}</span>`).join("")}
    </div>
    <div class="flex items-center gap-3">
      <a class="${SRC_LINK}" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">
        ver fonte → ${escapeHtml(hostname(decision.sourceUrl))}
        <span class="ml-1 opacity-50 text-[0.72rem]">${escapeHtml(sourceType(decision.sourceUrl))}</span>
      </a>
      <button class="bg-transparent border border-[#dedbd2] rounded-lg text-[#817d74] text-[0.82rem] font-black px-3 py-[7px] cursor-pointer hover:bg-[#f0eee8] transition-colors" type="button" data-copy-link="/d/${escapeHtml(decision.id)}">copiar link</button>
      <button class="border rounded-lg text-[0.82rem] font-black px-3 py-[7px] cursor-pointer transition-colors"
        style="${isSaved ? "color:#534ab7;background:#edeaff;border-color:#c7c0f0" : "color:#817d74;background:transparent;border-color:#dedbd2"}"
        type="button" data-save="${escapeHtml(decision.id)}">${isSaved ? "salvo" : "+ salvar"}</button>
    </div>
    ${conflictsHtml}
    ${relatedHtml}`;

  if (pushUrl) {
    history.pushState({ from: location.pathname + location.search }, "", "/d/" + encodeURIComponent(decision.id));
    setMeta(`${decision.title} — ${decision.company} | Arbiter`, decision.reason);
  }
  $("[data-modal-overlay]").classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeDetail() {
  $("[data-modal-overlay]").classList.remove("open");
  document.body.style.overflow = "";
  if (location.pathname.startsWith("/d/")) {
    if (history.state?.from) {
      history.back();
    } else {
      const fallback = state.query ? "/app?q=" + encodeURIComponent(state.query) : "/app";
      history.replaceState(null, "", fallback);
      setMeta(state.query ? `${state.query} — Arbiter` : "Arbiter — consultar", "");
    }
  }
}

function renderLoadError(error) {
  $("[data-result-count]").textContent = "erro ao carregar dados";
  $("[data-decision-grid]").innerHTML = `<p class="bg-white border border-dashed border-[#dfdcd4] rounded-xl text-[#85827c] font-extrabold p-7">${escapeHtml(error.message)}</p>`;
}

// ── meta dinâmica ─────────────────────────────────────────────────────────────

function setMeta(title, description) {
  document.title = title;
  const tag = document.querySelector('meta[name="description"]');
  if (tag) tag.setAttribute("content", description);
}

// ── routing ───────────────────────────────────────────────────────────────────

let _firstRoute = true;

function scrollToApp() {
  if (_firstRoute) document.getElementById("app")?.scrollIntoView({ behavior: "instant" });
}

function route() {
  const { pathname, search } = location;

  if (pathname === "/" || pathname === "/index.html" || pathname === "") {
    setMeta("Arbiter", "Arbiter mostra decisoes reais de engenharia e conflitos entre contextos diferentes.");
    _firstRoute = false;
    switchTab("consultar");
    renderResults();
    return;
  }

  scrollToApp();
  _firstRoute = false;

  if (pathname === "/app" || pathname === "/app/") {
    const params = new URLSearchParams(search);
    const q = params.get("q");
    const v = params.get("v");
    const co = params.get("co");
    switchTab("consultar");
    state.query = q || "";
    state.displayLimit = 12;
    state.filters = {
      topic: null,
      verdict: (v && ["adopted", "rejected", "kept"].includes(v)) ? v : null,
      company: co || null,
    };
    renderResults();
    setMeta(q ? `${q} — Arbiter` : "Arbiter — consultar decisões", q ? `Decisões de engenharia sobre "${q}"` : "Busque decisões reais de times como Stripe, Discord e Shopify.");
    return;
  }

  if (pathname.startsWith("/d/")) {
    const slug = decodeURIComponent(pathname.slice(3));
    const decision = state.slugMap.get(slug);
    switchTab("consultar");
    if (decision) {
      renderResults();
      renderDetail(decision, false);
      setMeta(`${decision.title} — ${decision.company} | Arbiter`, decision.reason);
    } else {
      history.replaceState(null, "", "/app");
      renderResults();
      setMeta("Arbiter — consultar", "");
    }
    return;
  }

  if (pathname.startsWith("/t/")) {
    const params = new URLSearchParams(search);
    const v = params.get("v");
    const co = params.get("co");
    const topic = decodeURIComponent(pathname.slice(3));
    state.query = "";
    state.displayLimit = 12;
    state.filters = {
      topic,
      verdict: (v && ["adopted", "rejected", "kept"].includes(v)) ? v : null,
      company: co || null,
    };
    switchTab("consultar");
    renderResults();
    setMeta(`${topic} — Arbiter`, `Decisões de engenharia sobre ${topic}`);
    return;
  }

  // Rota desconhecida → /app
  history.replaceState(null, "", "/app");
  switchTab("consultar");
  renderResults();
  setMeta("Arbiter", "");
}

function setQuery(query) {
  state.query = query;
  state.displayLimit = 12;
  addToSearchHistory(query);
  renderSearchHistory();
  switchTab("consultar");
  renderResults();
  const p = new URLSearchParams();
  p.set("q", query);
  if (state.filters.verdict) p.set("v", state.filters.verdict);
  if (state.filters.company) p.set("co", state.filters.company);
  history.pushState(null, "", "/app?" + p.toString());
  setMeta(`${query} — Arbiter`, `Decisões de engenharia sobre "${query}"`);
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

// ── command palette ───────────────────────────────────────────────────────────

let _paletteIndex = -1;

function openPalette() {
  const overlay = $("[data-palette-overlay]");
  overlay.style.display = "flex";
  const input = $("[data-palette-input]");
  input.value = "";
  $("[data-palette-results]").innerHTML = "";
  _paletteIndex = -1;
  setTimeout(() => input.focus(), 10);
}

function closePalette() {
  $("[data-palette-overlay]").style.display = "none";
  _paletteIndex = -1;
}

function setPaletteActive(index) {
  const items = $$("[data-palette-idx]");
  if (!items.length) return;
  const clamped = Math.max(0, Math.min(index, items.length - 1));
  items.forEach((item, i) => item.classList.toggle("bg-[#edeaff]", i === clamped));
  _paletteIndex = clamped;
}

function renderPaletteResults(query) {
  const list = $("[data-palette-results]");
  _paletteIndex = -1;
  if (!query.trim()) { list.innerHTML = ""; return; }
  const results = searchDecisions(state.decisions, query).slice(0, 8);
  if (!results.length) {
    list.innerHTML = `<li class="px-5 py-3 text-[#85827c] font-bold text-[0.9rem]">nenhuma decisão encontrada</li>`;
    return;
  }
  list.innerHTML = results.map((d, i) => `
    <li class="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-[#f5f4f0] transition-colors" data-palette-idx="${i}" data-detail-for="${escapeHtml(d.id)}">
      <span class="${PILL} flex-none" style="background:${escapeHtml(d.color)};color:${escapeHtml(d.tone)}">${escapeHtml(d.company)}</span>
      <span class="font-bold text-[0.9rem] flex-1 leading-[1.3]">${escapeHtml(d.title)}</span>
      <span class="${TAG_FLAT[d.verdict] || TAG_FLAT.kept} flex-none">${escapeHtml(verdictLabel(d.verdict))}</span>
    </li>`).join("");
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

  document.addEventListener("change", (e) => {
    const select = e.target.closest("[data-company-select]");
    if (!select) return;
    state.filters.company = select.value || null;
    state.displayLimit = 12;
    renderResults();
    const p = new URLSearchParams(location.search);
    if (state.filters.company) p.set("co", state.filters.company); else p.delete("co");
    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  });

  window.addEventListener("popstate", route);

  $("[data-palette-input]").addEventListener("input", (e) => renderPaletteResults(e.target.value));

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      openPalette();
      return;
    }
    const paletteOpen = $("[data-palette-overlay]").style.display !== "none";
    if (paletteOpen) {
      if (e.key === "Escape") { closePalette(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setPaletteActive(_paletteIndex + 1); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setPaletteActive(_paletteIndex - 1); return; }
      if (e.key === "Enter" && _paletteIndex >= 0) {
        const active = $$("[data-palette-idx]")[_paletteIndex];
        if (active) {
          const decision = state.decisions.find((d) => d.id === active.dataset.detailFor);
          if (decision) { closePalette(); renderDetail(decision); }
        }
        return;
      }
      return;
    }
    if (e.key === "Escape") closeDetail();
  });

  document.addEventListener("click", (event) => {
    if (event.target === $("[data-palette-overlay]")) { closePalette(); return; }

    const paletteItem = event.target.closest("[data-palette-idx]");
    if (paletteItem) {
      const decision = state.decisions.find((d) => d.id === paletteItem.dataset.detailFor);
      if (decision) { closePalette(); renderDetail(decision); }
      return;
    }

    const verMaisBtn = event.target.closest("[data-ver-mais]");
    if (verMaisBtn) {
      state.displayLimit += 12;
      renderResults();
      return;
    }

    const viewToggle = event.target.closest("[data-view-toggle]");
    if (viewToggle) {
      state.viewMode = state.viewMode === "grid" ? "compact" : "grid";
      renderResults();
      return;
    }

    const darkToggle = event.target.closest("[data-dark-toggle]");
    if (darkToggle) { toggleDarkMode(); return; }

    const chip = event.target.closest("[data-query]");
    if (chip) { setQuery(chip.dataset.query); return; }

    const filterChip = event.target.closest("[data-filter]");
    if (filterChip) {
      const { filter, value } = filterChip.dataset;
      const newVal = state.filters[filter] === value ? null : value;
      state.filters[filter] = newVal;
      state.displayLimit = 12;
      renderResults();
      if (filter === "topic") {
        if (newVal) {
          const p = new URLSearchParams();
          if (state.filters.verdict) p.set("v", state.filters.verdict);
          const qs = p.toString();
          history.pushState(null, "", "/t/" + encodeURIComponent(newVal) + (qs ? "?" + qs : ""));
          setMeta(`${newVal} — Arbiter`, `Decisões de engenharia sobre ${newVal}`);
        } else {
          const p = new URLSearchParams();
          if (state.query) p.set("q", state.query);
          if (state.filters.verdict) p.set("v", state.filters.verdict);
          const qs = p.toString();
          history.replaceState(null, "", "/app" + (qs ? "?" + qs : ""));
          setMeta(state.query ? `${state.query} — Arbiter` : "Arbiter — consultar", "");
        }
      } else if (filter === "verdict") {
        const p = new URLSearchParams(location.search);
        if (newVal) p.set("v", newVal); else p.delete("v");
        const qs = p.toString();
        history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
      } else if (filter === "company") {
        const p = new URLSearchParams(location.search);
        if (newVal) p.set("co", newVal); else p.delete("co");
        const qs = p.toString();
        history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
      }
      return;
    }

    const saveButton = event.target.closest("[data-save]");
    if (saveButton) {
      const id = saveButton.dataset.save;
      state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
      localStorage.setItem("arbiter.saved", JSON.stringify([...state.saved]));
      renderResults();
      renderSaved();
      const modSaveBtn = $("[data-modal-overlay].open [data-save]");
      if (modSaveBtn && modSaveBtn.dataset.save === id) {
        const nowSaved = state.saved.has(id);
        modSaveBtn.textContent = nowSaved ? "salvo" : "+ salvar";
        modSaveBtn.style.color = nowSaved ? "#534ab7" : "#817d74";
        modSaveBtn.style.background = nowSaved ? "#edeaff" : "transparent";
        modSaveBtn.style.borderColor = nowSaved ? "#c7c0f0" : "#dedbd2";
      }
      return;
    }

    const conflictButton = event.target.closest("[data-conflict-for]");
    if (conflictButton) {
      const decision = state.decisions.find((d) => d.id === conflictButton.dataset.conflictFor);
      if (!decision) return;
      switchTab("consultar");
      const pair = findConflict([decision, ...state.decisions]);
      renderConflict(pair);
      if (pair) $("[data-conflict-panel]").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const copyBtn = event.target.closest("[data-copy-link]");
    if (copyBtn) {
      const url = location.origin + copyBtn.dataset.copyLink;
      navigator.clipboard.writeText(url).then(() => {
        const orig = copyBtn.textContent;
        copyBtn.textContent = "copiado!";
        setTimeout(() => { copyBtn.textContent = orig; }, 2000);
      });
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

    const topicToggle = event.target.closest("[data-topic-toggle]");
    if (topicToggle) {
      const topic = topicToggle.dataset.topicToggle;
      if (_collapsedTopics.has(topic)) _collapsedTopics.delete(topic);
      else _collapsedTopics.add(topic);
      const body = $(`[data-topic-body="${CSS.escape(topic)}"]`);
      const chevron = topicToggle.querySelector("svg");
      if (body) body.hidden = _collapsedTopics.has(topic);
      if (chevron) chevron.classList.toggle("-rotate-90", _collapsedTopics.has(topic));
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

const DARK_KEY = "arbiter.dark";

function initDarkMode() {
  if (localStorage.getItem(DARK_KEY) === "1") document.documentElement.classList.add("dark");
  updateDarkToggle();
}

function toggleDarkMode() {
  const isDark = document.documentElement.classList.toggle("dark");
  localStorage.setItem(DARK_KEY, isDark ? "1" : "0");
  updateDarkToggle();
}

function updateDarkToggle() {
  const btn = $("[data-dark-toggle]");
  if (!btn) return;
  const isDark = document.documentElement.classList.contains("dark");
  btn.title = isDark ? "modo claro" : "modo escuro";
  btn.innerHTML = isDark
    ? `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="2.5"/><line x1="7" y1="0.5" x2="7" y2="2"/><line x1="7" y1="12" x2="7" y2="13.5"/><line x1="0.5" y1="7" x2="2" y2="7"/><line x1="12" y1="7" x2="13.5" y2="7"/><line x1="2.65" y1="2.65" x2="3.7" y2="3.7"/><line x1="10.3" y1="10.3" x2="11.35" y2="11.35"/><line x1="11.35" y1="2.65" x2="10.3" y2="3.7"/><line x1="3.7" y1="10.3" x2="2.65" y2="11.35"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.25 7.46A5.25 5.25 0 1 1 6.54 1.75 4.08 4.08 0 0 0 12.25 7.46z"/></svg>`;
}

async function init() {
  renderChips("[data-chip-row]");
  bindEvents();
  initDarkMode();

  try {
    const [rawDecisions, sources] = await Promise.all([loadJson("data/decisions.json"), loadJson("data/sources.json")]);
    rawDecisions.forEach(validateDecision);
    state.decisions = rawDecisions.map(normalizeDecision);
    state.slugMap = new Map(state.decisions.map((d) => [d.id, d]));
    state.hasConflict = new Set(
      state.decisions.filter((d) => findConflictsFor(d, state.decisions).length > 0).map((d) => d.id)
    );
    state.sources = sources;
    renderSources("[data-source-grid]");
    renderSaved();
    renderSearchHistory();
    route();
  } catch (error) {
    renderLoadError(error);
  }
}

init();
