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
  viewMode: "compact",
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

// 2d — peso de evidência: ADR=3, eng blog=2, thread=1
function sourceWeight(url) {
  const t = sourceType(url);
  if (t === "ADR") return 3;
  if (t === "eng blog") return 2;
  return 1;
}

function sourceWeightDots(url) {
  const w = sourceWeight(url);
  const filled = "●".repeat(w);
  const empty = '<span style="opacity:0.22">●</span>'.repeat(3 - w);
  const color = w === 3 ? "#1a7a43" : w === 2 ? "#b4571c" : "#a9a497";
  return `<span style="color:${color};font-size:11px;font-family:'JetBrains Mono',monospace;letter-spacing:-1px;">${filled}${empty}</span>`;
}

function sourceFreshness(year) {
  const age = new Date().getFullYear() - parseInt(year, 10);
  if (age <= 3) return { label: "↑ atual", color: "#1a7a43", bg: "#dcf3e4" };
  if (age <= 6) return { label: "↗ recente", color: "#b4571c", bg: "#fbe9d6" };
  return { label: "⚠ envelhecida", color: "#9a4d12", bg: "#fff6e0" };
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

const CHIP = "bg-white border border-[#e0dccf] rounded-full text-[#6f6a5e] cursor-pointer text-[0.82rem] font-semibold min-h-[29px] px-[17px] hover:bg-[#ece9df] transition-colors duration-150";
const TEXT_BTN = "bg-transparent border-0 text-[#6f6a5e] cursor-pointer text-[13px] font-semibold p-0 hover:text-[#16140f] transition-colors duration-150";
const PILL = "text-[12px] font-bold px-[10px] py-[4px] rounded-[7px]";
const YEAR = "font-mono text-[12px] text-[#a9a497]";
const SRC_LINK = "bg-[#eceaff] rounded-[9px] text-[#4a3fce] inline-flex text-[13px] font-semibold mt-2 px-3 py-[7px] hover:bg-[#e0dbff] transition-colors";

const TAG = {
  adopted: "ml-auto rounded-[7px] inline-flex items-center text-[12px] font-bold px-[11px] py-[4px] bg-[#dcf3e4] text-[#1a7a43]",
  rejected: "ml-auto rounded-[7px] inline-flex items-center text-[12px] font-bold px-[11px] py-[4px] bg-[#fbe9d6] text-[#b4571c]",
  kept:     "ml-auto rounded-[7px] inline-flex items-center text-[12px] font-bold px-[11px] py-[4px] bg-[#e8f1ff] text-[#2f7db6]",
};

const TAG_FLAT = {
  adopted: "rounded-[7px] inline-flex items-center text-[12px] font-bold px-[11px] py-[4px] bg-[#dcf3e4] text-[#1a7a43]",
  rejected: "rounded-[7px] inline-flex items-center text-[12px] font-bold px-[11px] py-[4px] bg-[#fbe9d6] text-[#b4571c]",
  kept:     "rounded-[7px] inline-flex items-center text-[12px] font-bold px-[11px] py-[4px] bg-[#e8f1ff] text-[#2f7db6]",
};

const CONFLICT_AXES = {
  "message-queue:Kafka":      "volume e escala × custo operacional e simplicidade",
  "architecture:Microservices": "autonomia de times e deploy × simplicidade operacional",
  "api-style:GraphQL":        "flexibilidade de query × complexidade de cache e schema",
  "database:Postgres":        "consistência SQL × escala horizontal e sharding",
  "language:Go":              "ecossistema e concorrência × latência de GC",
  "language:TypeScript":      "type safety × velocidade de iteração",
  "architecture:React Native":"code sharing × controle de plataforma nativa",
  "deploy:Kubernetes":        "portabilidade e escalabilidade × complexidade operacional",
  "api-style:gRPC":           "performance e tipagem forte × complexidade de integração",
  "database:MongoDB":         "schema flexível × consistência transacional",
  "database:Elasticsearch":   "busca full-text e analytics × operação e consistência",
  "deploy:Serverless":        "elasticidade automática × latência de cold start e custo em escala",
};

// ── render helpers ────────────────────────────────────────────────────────────

function renderChips(rootSelector) {
  $(rootSelector).innerHTML = sampleQueries
    .map((q) => `<button class="${CHIP}" type="button" data-query="${escapeHtml(q)}">${escapeHtml(q)}</button>`)
    .join("");
}

function renderSources(rootSelector) {
  const root = $(rootSelector);
  if (!root) return;
  root.innerHTML = state.sources
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
    <article class="card-appear bg-white border border-[#e8e4d8] rounded-[16px] shadow-sm cursor-pointer transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 px-[22px] pt-[22px] pb-[16px]" data-detail-for="${escapeHtml(decision.id)}">
      <div class="flex items-center gap-2.5 mb-4">
        <span class="${PILL} flex-none" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
        <span class="${YEAR}">${escapeHtml(decision.year)}</span>
        ${decision.revisedAt ? `<span class="text-[11px] font-bold px-2 py-[2px] rounded-[5px] bg-[#fff6e8] text-[#9a4d12]">rev. ${escapeHtml(decision.revisedAt)}</span>` : ""}
        <span class="${escapeHtml(TAG[decision.verdict] || TAG.kept)}">${escapeHtml(verdictLabel(decision.verdict))}</span>
      </div>
      <h3 class="text-[1.05rem] font-bold mb-2 mt-0 text-[#16140f] leading-snug">${escapeHtml(decision.title)}</h3>
      <p class="text-[#6f6a5e] text-[0.9rem] font-medium leading-relaxed min-h-[50px] m-0">${escapeHtml(decision.reason)}</p>
      <div class="border-t border-[#e8e4d8] flex gap-4 mt-4 pt-3.5">
        <a class="${TEXT_BTN}" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">ver fonte <span class="opacity-40 text-[0.78rem]">${escapeHtml(sourceType(decision.sourceUrl))}</span></a>
        ${state.hasConflict.has(decision.id) ? `<button class="${TEXT_BTN}" type="button" data-conflict-for="${escapeHtml(decision.id)}">ver conflito</button>` : ""}
        <button class="bg-transparent border-0 cursor-pointer text-[13px] font-semibold p-0 transition-colors duration-150 ${isSaved ? "text-[#5b4fe0]" : "text-[#a9a497] hover:text-[#16140f]"}" type="button" data-save="${escapeHtml(decision.id)}">
          ${isSaved ? (inSavedPanel ? "— remover" : "salvo ✓") : "+ salvar"}
        </button>
      </div>
    </article>`;
}

function renderCompactCard(decision) {
  const isSaved = state.saved.has(decision.id);
  return `
    <div class="flex items-center gap-4 bg-white border border-[#e8e4d8] rounded-[13px] px-[18px] py-[14px] cursor-pointer hover:bg-[#faf9f7] transition-colors" data-detail-for="${escapeHtml(decision.id)}">
      <span class="${PILL} flex-none whitespace-nowrap" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
      <span class="${YEAR} flex-none">${escapeHtml(decision.year)}</span>
      ${decision.revisedAt ? `<span class="text-[11px] font-bold px-1.5 py-[1px] rounded-[5px] bg-[#fff6e8] text-[#9a4d12] flex-none">rev.</span>` : ""}
      <span class="font-semibold text-[15px] text-[#16140f] flex-1 truncate leading-snug">${escapeHtml(decision.title)}</span>
      <span class="${TAG_FLAT[decision.verdict] || TAG_FLAT.kept} flex-none">${escapeHtml(verdictLabel(decision.verdict))}</span>
      <a class="text-[#5b4fe0] text-[13px] font-semibold hover:underline flex-none inline-flex items-center gap-1" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${escapeHtml(sourceType(decision.sourceUrl))} ${sourceWeightDots(decision.sourceUrl)} ↗</a>
      ${state.hasConflict.has(decision.id) ? `<button class="bg-transparent border-0 cursor-pointer text-[13px] font-semibold p-0 flex-none text-[#a9a497] hover:text-[#9a4d12] transition-colors" type="button" data-conflict-for="${escapeHtml(decision.id)}">conflito</button>` : ""}
      <button class="bg-transparent border-0 cursor-pointer text-[13px] font-semibold p-0 flex-none transition-colors ${isSaved ? "text-[#5b4fe0]" : "text-[#a9a497] hover:text-[#16140f]"}" type="button" data-save="${escapeHtml(decision.id)}">${isSaved ? "salvo ✓" : "salvar"}</button>
    </div>`;
}

// 2c — mapa de consenso: barra divergente por tamanho implícito (pequeno/grande)
function renderConsensusMap(topic, subject) {
  const pool = state.decisions.filter((d) => d.topic === topic && d.subject === subject);
  if (pool.length < 2) return "";
  const adopted = pool.filter((d) => d.verdict === "adopted").length;
  const rejected = pool.filter((d) => d.verdict === "rejected").length;
  const total = adopted + rejected;
  if (!total) return "";
  const rejPct = Math.round((rejected / total) * 100);
  const adoPct = 100 - rejPct;
  return `
    <div class="mt-6 pt-5 border-t border-[#2a2519]">
      <div class="flex items-baseline gap-3 mb-4">
        <span class="font-mono text-[11px] font-bold text-[#6b6555] uppercase tracking-[0.1em]">MAPA DE CONSENSO</span>
        <span class="text-[#a09880] text-[12px]">${escapeHtml(subject)} · ${total} decisões na base</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-[12px] font-semibold text-[#b4571c] w-[68px] text-right">rejeitou</span>
        <div class="flex flex-1 h-[22px] rounded-[6px] overflow-hidden">
          <div class="h-full flex items-center justify-end px-2" style="width:${rejPct}%;background:#b4571c;">
            ${rejPct > 20 ? `<span class="text-white text-[11px] font-bold">${rejected}</span>` : ""}
          </div>
          <div class="h-full flex items-center justify-start px-2" style="width:${adoPct}%;background:#1a7a43;">
            ${adoPct > 20 ? `<span class="text-white text-[11px] font-bold">${adopted}</span>` : ""}
          </div>
        </div>
        <span class="text-[12px] font-semibold text-[#1a7a43] w-[52px]">adotou</span>
      </div>
      ${rejPct > 60 ? `<p class="text-[#a09880] text-[12px] mt-3 mb-0">a maioria das empresas na base rejeitou — contexto importa.</p>` :
        adoPct > 60 ? `<p class="text-[#a09880] text-[12px] mt-3 mb-0">a maioria na base adotou — mas o contexto pode inverter.</p>` :
        `<p class="text-[#a09880] text-[12px] mt-3 mb-0">veredictos divididos — o contexto é o que decide.</p>`}
    </div>`;
}

// 2a — formulário "aplicar ao meu contexto"
function renderContextForm(rejected, adopted) {
  return `
    <div class="mt-6 pt-5 border-t border-[#2a2519]" data-context-form>
      <span class="font-mono text-[11px] font-bold text-[#6b6555] uppercase tracking-[0.1em]">APLICAR AO MEU CONTEXTO</span>
      <div class="mt-4 grid gap-3" style="grid-template-columns:1fr 1fr">
        <div>
          <div class="text-[12px] text-[#6b6555] mb-2">tamanho do time</div>
          <div class="flex gap-2">
            <button class="ctx-btn text-[12px] font-semibold px-3 py-[5px] rounded-[8px] border border-[#2a2519] text-[#6b6555] hover:border-[#5b4fe0] hover:text-[#5b4fe0] transition-colors cursor-pointer bg-transparent" data-ctx="team" data-val="pequeno">pequeno</button>
            <button class="ctx-btn text-[12px] font-semibold px-3 py-[5px] rounded-[8px] border border-[#2a2519] text-[#6b6555] hover:border-[#5b4fe0] hover:text-[#5b4fe0] transition-colors cursor-pointer bg-transparent" data-ctx="team" data-val="médio">médio</button>
            <button class="ctx-btn text-[12px] font-semibold px-3 py-[5px] rounded-[8px] border border-[#2a2519] text-[#6b6555] hover:border-[#5b4fe0] hover:text-[#5b4fe0] transition-colors cursor-pointer bg-transparent" data-ctx="team" data-val="grande">grande</button>
          </div>
        </div>
        <div>
          <div class="text-[12px] text-[#6b6555] mb-2">estágio</div>
          <div class="flex gap-2">
            <button class="ctx-btn text-[12px] font-semibold px-3 py-[5px] rounded-[8px] border border-[#2a2519] text-[#6b6555] hover:border-[#5b4fe0] hover:text-[#5b4fe0] transition-colors cursor-pointer bg-transparent" data-ctx="stage" data-val="inicial">inicial</button>
            <button class="ctx-btn text-[12px] font-semibold px-3 py-[5px] rounded-[8px] border border-[#2a2519] text-[#6b6555] hover:border-[#5b4fe0] hover:text-[#5b4fe0] transition-colors cursor-pointer bg-transparent" data-ctx="stage" data-val="em escala">em escala</button>
          </div>
        </div>
      </div>
      <button class="mt-4 w-full bg-[#5b4fe0] text-white text-[13px] font-bold py-[10px] rounded-[11px] border-0 cursor-pointer hover:bg-[#4a3fce] transition-colors" type="button" data-ctx-evaluate data-rejected="${escapeHtml(rejected.id)}" data-adopted="${escapeHtml(adopted.id)}">avaliar qual lado combina mais com meu caso</button>
      <div data-ctx-result class="mt-4"></div>
    </div>`;
}

function renderConflictSide(decision, dark = false) {
  if (dark) {
    const borderColor = decision.verdict === "rejected" ? "#e0863c" : "#4ea36b";
    return `
      <article class="bg-[#1f1c16] rounded-[14px] p-[22px] cursor-pointer hover:bg-[#252015] transition-colors" style="border-top:3px solid ${borderColor}" data-detail-for="${escapeHtml(decision.id)}">
        <div class="flex items-center gap-2.5 mb-[18px]">
          <span class="${PILL}" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
          <span class="font-mono text-[12px] text-[#6b6555]">${escapeHtml(decision.year)}</span>
        </div>
        <h3 class="text-[1.05rem] font-bold mb-2 mt-0 text-white">${escapeHtml(verdictLabel(decision.verdict))} ${escapeHtml(decision.subject)}</h3>
        <p class="text-[#a09880] text-[0.9rem] leading-[1.5] m-0">${escapeHtml(decision.context)}. ${escapeHtml(decision.reason)}</p>
        <a class="bg-[#2a2519] rounded-[9px] text-[#d4a96a] inline-flex text-[13px] font-semibold mt-3 px-3 py-[7px] hover:bg-[#332e1e] transition-colors" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${escapeHtml(hostname(decision.sourceUrl))}</a>
      </article>`;
  }
  return `
    <article class="bg-white border border-[#e8e4d8] rounded-[13px] p-[22px] cursor-pointer hover:bg-[#faf9f7] transition-colors" data-detail-for="${escapeHtml(decision.id)}">
      <div class="flex items-center gap-2.5 mb-[18px]">
        <span class="${PILL}" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
        <span class="${YEAR}">${escapeHtml(decision.year)}</span>
      </div>
      <h3 class="text-[1.05rem] font-bold mb-2 mt-0 text-[#16140f]">${escapeHtml(verdictLabel(decision.verdict))} ${escapeHtml(decision.subject)}</h3>
      <p class="text-[#6f6a5e] text-[0.9rem] leading-[1.5] m-0">${escapeHtml(decision.context)}. ${escapeHtml(decision.reason)}</p>
      <a class="${SRC_LINK}" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer" onclick="event.stopPropagation()">${escapeHtml(hostname(decision.sourceUrl))}</a>
    </article>`;
}

function renderConflict(pair) {
  const panel = $("[data-conflict-panel]");
  const banner = $("[data-conflict-banner]");
  if (!pair) {
    panel.style.display = "none";
    panel.innerHTML = "";
    if (banner) banner.innerHTML = "";
    return;
  }
  const [rejected, adopted] = pair;
  if (banner) {
    banner.innerHTML = `
      <div class="flex items-center justify-between gap-4 rounded-[14px] px-5 py-[13px] mb-4" style="background:linear-gradient(90deg,#fff6e8,#fdeede);border:1px solid #f1d9b8">
        <div>
          <div class="flex items-center gap-2 mb-[3px]">
            <span class="text-[#9a4d12] text-[13px] font-bold">⚡ conflito detectado</span>
            <span class="text-[#b8875a] text-[13px]">— ${escapeHtml(rejected.company)} vs ${escapeHtml(adopted.company)}</span>
          </div>
          <p class="text-[#c09070] text-[12px] m-0">a mesma escolha, veredictos opostos. compare o porquê.</p>
        </div>
        <button class="text-white text-[13px] font-semibold px-4 py-[8px] rounded-[9px] cursor-pointer border-0 hover:opacity-90 transition-opacity flex-none" style="background:#9a4d12" type="button" data-scroll-conflict>ver conflito →</button>
      </div>`;
  }
  const axisKey = `${rejected.topic}:${rejected.subject}`;
  const axis = CONFLICT_AXES[axisKey] || null;
  panel.style.display = "block";
  panel.className = "bg-[#16140f] rounded-[20px] mt-7 p-7";
  panel.innerHTML = `
    <h2 class="text-[1.1rem] font-bold mb-2 mt-0 text-white">⚡ conflito — ${escapeHtml(rejected.subject.toLowerCase())} em contextos opostos</h2>
    <p class="text-[#6b6555] text-[13px] leading-[1.55] mb-[22px] mt-0">a mesma decisão técnica levou dois times a veredictos opostos. a diferença não está na tecnologia — está no contexto.</p>
    <div class="grid items-start gap-[18px]" style="grid-template-columns:1fr auto 1fr">
      ${renderConflictSide(rejected, true)}
      <span class="text-[#6b6555] text-[0.8rem] font-bold text-center mt-8">vs</span>
      ${renderConflictSide(adopted, true)}
    </div>
    ${axis ? `<div class="flex items-center gap-3 mt-6 pt-5 border-t border-[#2a2519]">
      <span class="font-mono text-[11px] font-bold text-[#6b6555] uppercase tracking-[0.1em] flex-none">O EIXO</span>
      <span class="text-[#a09880] text-[13px]">${escapeHtml(axis)}</span>
    </div>` : ""}
    ${renderConsensusMap(rejected.topic, rejected.subject)}
    ${renderContextForm(rejected, adopted)}`;
}

function filterChipCls(isActive, verdict) {
  const base = "rounded-[999px] cursor-pointer text-[0.78rem] font-semibold min-h-[26px] px-3 border transition-all duration-100";
  if (!isActive) return `${base} bg-white border-[#ddd9cf] text-[#6f6a5e]`;
  const colors = { adopted: "bg-[#1a7a43] border-[#1a7a43]", rejected: "bg-[#b4571c] border-[#b4571c]", kept: "bg-[#2f7db6] border-[#2f7db6]" };
  return `${base} ${colors[verdict] || "bg-[#16140f] border-[#16140f]"} text-white`;
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
  const countLabel = state.filters.topic
    ? `${state.results.length} decisões · ${state.filters.topic}`
    : `${state.results.length} decisões encontradas`;
  $("[data-result-count]").textContent = countLabel;

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

  const companiesBar = $("[data-companies-bar]");
  if (companiesBar) {
    if (hasActiveSearch) {
      companiesBar.innerHTML = "";
    } else {
      const companies = [...new Set(state.decisions.map((d) => d.company))].sort();
      companiesBar.innerHTML = `
        <div class="mt-10 pt-7 border-t border-[#e8e4d8]">
          <p class="font-mono text-[11px] font-bold text-[#a9a497] uppercase tracking-[0.1em] mb-4">${companies.length} empresas indexadas</p>
          <div class="flex flex-wrap gap-2">
            ${companies.map((c) => {
              const d = state.decisions.find((dec) => dec.company === c);
              return `<button class="inline-flex items-center gap-1.5 bg-white border border-[#e8e4d8] rounded-[8px] px-3 py-[6px] text-[13px] font-semibold text-[#6f6a5e] hover:bg-[#f4f1ea] hover:border-[#d0ccc0] transition-colors cursor-pointer" type="button" data-filter="company" data-value="${escapeHtml(c)}">
                <span class="w-[8px] h-[8px] rounded-full flex-none" style="background:${escapeHtml(d?.color || "#ccc")}"></span>
                ${escapeHtml(c)}
              </button>`;
            }).join("")}
          </div>
        </div>`;
    }
  }
}

// 2f — matriz de comparação de salvos
function renderComparisonMatrix(items) {
  if (items.length < 2) return "";
  const rows = [
    { key: "VEREDICTO", fn: (d) => `<span class="text-[12px] font-bold px-2 py-[2px] rounded-[6px] ${TAG_FLAT[d.verdict]||TAG_FLAT.kept}">${escapeHtml(verdictLabel(d.verdict))}</span>` },
    { key: "ANO", fn: (d) => `<span class="font-mono text-[12px] text-[#6f6a5e]">${escapeHtml(d.year)}</span>` },
    { key: "TÓPICO", fn: (d) => `<span class="text-[12px] text-[#46423a]">${escapeHtml(d.topic)}</span>` },
    { key: "RAZÃO", fn: (d) => `<span class="text-[12px] text-[#46423a] leading-[1.5]">${escapeHtml(d.reason.slice(0,90))}${d.reason.length>90?"…":""}</span>` },
    { key: "FONTE", fn: (d) => `<a href="${escapeHtml(d.sourceUrl)}" target="_blank" rel="noreferrer" class="text-[12px] font-semibold text-[#5b4fe0] hover:underline">${escapeHtml(hostname(d.sourceUrl))} ↗</a>` },
  ];
  const cols = `118px ${items.map(() => "1fr").join(" ")}`;
  return `
    <div class="mt-5 overflow-x-auto">
      <div style="display:grid;grid-template-columns:${cols};border:1px solid #e8e4d8;border-radius:14px;overflow:hidden;background:#fff;min-width:500px">
        <div class="bg-[#faf8f2] p-3 border-b border-[#e8e4d8] border-r border-[#e8e4d8]"></div>
        ${items.map((d) => `<div class="bg-[#faf8f2] p-3 border-b border-[#e8e4d8] border-r border-[#e8e4d8] last:border-r-0"><span class="font-bold text-[13px] px-2 py-[3px] rounded-[6px]" style="background:${escapeHtml(d.color)};color:${escapeHtml(d.tone)}">${escapeHtml(d.company)}</span></div>`).join("")}
        ${rows.map(({ key, fn }) => `
          <div class="p-3 border-b border-[#efece3] border-r border-[#e8e4d8] last-of-type:border-b-0 font-mono text-[10px] font-bold text-[#a9a497] tracking-[0.06em] uppercase align-middle">${key}</div>
          ${items.map((d) => `<div class="p-3 border-b border-[#efece3] border-r border-[#e8e4d8] last:border-r-0">${fn(d)}</div>`).join("")}
        `).join("")}
      </div>
    </div>`;
}

function renderSaved() {
  const items = state.decisions.filter((d) => state.saved.has(d.id));
  const matrixEl = $("[data-saved-matrix]");
  if (matrixEl) matrixEl.innerHTML = items.length >= 2 ? renderComparisonMatrix(items) : "";
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

  const fresh = sourceFreshness(decision.year);
  const weight = sourceWeight(decision.sourceUrl);
  const weightLabel = weight === 3 ? "ADR público" : weight === 2 ? "eng blog" : "thread";
  const weightColor = weight === 3 ? "#1a7a43" : weight === 2 ? "#b4571c" : "#a9a497";

  // 2b — timeline de revisão
  const timelineHtml = decision.revisedAt ? `
    <div class="rounded-[14px] border border-[#e8e4d8] overflow-hidden">
      <div class="px-5 pt-4 pb-3 border-b border-[#f0ece4]">
        <span class="font-mono text-[11px] font-bold text-[#a9a497] uppercase tracking-[0.08em]">linha do tempo</span>
      </div>
      <div class="px-5 py-5 relative">
        <div class="absolute left-[58px] right-[58px] top-[42px] h-[3px] rounded-full" style="background:linear-gradient(90deg,#5b4fe0,#b4571c,#1a7a43)"></div>
        <div class="grid gap-4" style="grid-template-columns:1fr 1fr 1fr">
          <div>
            <div class="flex items-center gap-2 mb-3">
              <span class="w-3 h-3 rounded-full flex-none border-2 border-[#f4f1ea]" style="background:#5b4fe0;box-shadow:0 0 0 2px #5b4fe0"></span>
              <span class="font-mono text-[13px] font-semibold text-[#16140f]">${escapeHtml(decision.year)}</span>
            </div>
            <div class="bg-white border border-[#e8e4d8] rounded-[11px] p-3">
              <span class="text-[11px] font-bold text-[#1a7a43] bg-[#dcf3e4] px-2 py-[2px] rounded-[5px]">adotou</span>
              <div class="font-bold text-[#16140f] text-[14px] mt-2">${escapeHtml(decision.subject)}</div>
              <p class="text-[#6f6a5e] text-[12px] leading-[1.5] mt-1 mb-0">${escapeHtml(decision.context)}</p>
            </div>
          </div>
          <div>
            <div class="flex items-center gap-2 mb-3">
              <span class="w-3 h-3 rounded-full flex-none border-2 border-[#f4f1ea]" style="background:#b4571c;box-shadow:0 0 0 2px #b4571c"></span>
              <span class="font-mono text-[13px] font-semibold text-[#16140f]">tensão</span>
            </div>
            <div class="bg-[#fff6e8] border border-[#f1d9b8] rounded-[11px] p-3">
              <span class="text-[11px] font-bold text-[#9a4d12] bg-[#fbe9d6] px-2 py-[2px] rounded-[5px]">tensão</span>
              <div class="font-bold text-[#16140f] text-[14px] mt-2">pressão para revisão</div>
              <p class="text-[#a86b30] text-[12px] leading-[1.5] mt-1 mb-0">${escapeHtml(decision.reason).slice(0, 80)}…</p>
            </div>
          </div>
          <div>
            <div class="flex items-center gap-2 mb-3">
              <span class="w-3 h-3 rounded-full flex-none border-2 border-[#f4f1ea]" style="background:#1a7a43;box-shadow:0 0 0 2px #1a7a43"></span>
              <span class="font-mono text-[13px] font-semibold text-[#16140f]">${escapeHtml(decision.revisedAt)}</span>
            </div>
            <div class="bg-white border border-[#e8e4d8] rounded-[11px] p-3">
              <span class="text-[11px] font-bold text-[#1a7a43] bg-[#dcf3e4] px-2 py-[2px] rounded-[5px]">revisou</span>
              <div class="font-bold text-[#16140f] text-[14px] mt-2">nova decisão</div>
              <p class="text-[#6f6a5e] text-[12px] leading-[1.5] mt-1 mb-0">${escapeHtml(decision.revisionNote || "")}</p>
            </div>
          </div>
        </div>
      </div>
    </div>` : "";

  // 2g — markdown para citar
  const mdSnippet = `> **${decision.company} ${verdictLabel(decision.verdict)} ${decision.subject}** (${decision.year})\n>   ${decision.reason}\n>   — via [arbiter](${location.origin}/d/${decision.id})`;

  body.innerHTML = `
    <div class="flex items-center gap-2.5">
      <span class="${PILL}" style="background:${escapeHtml(decision.color)};color:${escapeHtml(decision.tone)}">${escapeHtml(decision.company)}</span>
      <span class="${YEAR}">${escapeHtml(decision.year)}</span>
      <span class="${TAG[decision.verdict] || TAG.kept}">${escapeHtml(verdictLabel(decision.verdict))}</span>
      <span class="ml-auto text-[11px] font-bold px-2 py-[3px] rounded-[6px]" style="color:${fresh.color};background:${fresh.bg}">${fresh.label}</span>
    </div>
    ${timelineHtml}
    <dl class="detail-body">
      <dt class="font-mono text-[#6f6a5e] text-[0.72rem] font-bold tracking-[0.08em] uppercase pt-[3px]">contexto</dt>
      <dd class="text-[#16140f] font-semibold leading-[1.55] m-0">${escapeHtml(decision.context)}</dd>
      <dt class="font-mono text-[#6f6a5e] text-[0.72rem] font-bold tracking-[0.08em] uppercase pt-[3px]">razão</dt>
      <dd class="text-[#16140f] font-semibold leading-[1.55] m-0">${escapeHtml(decision.reason)}</dd>
    </dl>
    <div class="flex flex-wrap gap-2">
      ${decision.tags.map((t) => `<span class="${CHIP} cursor-default">${escapeHtml(t)}</span>`).join("")}
    </div>
    <div class="flex items-center gap-3 flex-wrap">
      <a class="bg-[#5b4fe0] text-white rounded-[10px] inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-[9px] hover:bg-[#4a3fce] transition-colors" href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer">
        abrir fonte ↗
      </a>
      <button class="border rounded-[10px] text-[13px] font-semibold px-4 py-[9px] cursor-pointer transition-colors"
        style="${isSaved ? "color:#5b4fe0;background:#eceaff;border-color:#c7c0f0" : "color:#6f6a5e;background:white;border-color:#e0dccf"}"
        type="button" data-save="${escapeHtml(decision.id)}">${isSaved ? "salvo ✓" : "salvar"}</button>
      <button class="bg-transparent border-0 text-[#a9a497] text-[13px] font-semibold cursor-pointer hover:text-[#16140f] transition-colors ml-auto" type="button" data-copy-link="/d/${escapeHtml(decision.id)}">copiar link</button>
    </div>
    <!-- 2d/2e — evidência + frescor -->
    <div class="rounded-[12px] border border-[#e8e4d8] px-4 py-3 flex items-center gap-4 flex-wrap">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[10px] font-bold text-[#a9a497] uppercase tracking-[0.08em]">evidência</span>
        ${sourceWeightDots(decision.sourceUrl)}
        <span class="text-[12px] font-semibold" style="color:${weightColor}">${escapeHtml(weightLabel)}</span>
      </div>
      <div class="w-px h-4 bg-[#e8e4d8]"></div>
      <div class="flex items-center gap-2">
        <span class="font-mono text-[10px] font-bold text-[#a9a497] uppercase tracking-[0.08em]">frescor</span>
        <span class="text-[12px] font-semibold px-2 py-[2px] rounded-[5px]" style="color:${fresh.color};background:${fresh.bg}">${fresh.label}</span>
      </div>
      <div class="ml-auto">
        <a href="${escapeHtml(decision.sourceUrl)}" target="_blank" rel="noreferrer" class="font-mono text-[11px] text-[#5b4fe0] hover:underline">${escapeHtml(hostname(decision.sourceUrl))} ↗</a>
      </div>
    </div>
    <!-- 2g — citar -->
    <div class="rounded-[12px] border border-[#e8e4d8] overflow-hidden">
      <div class="px-4 py-3 border-b border-[#f0ece4] flex items-center justify-between">
        <span class="font-mono text-[11px] font-bold text-[#a9a497] uppercase tracking-[0.08em]">citar / incorporar</span>
        <button class="text-[#5b4fe0] text-[12px] font-semibold hover:underline cursor-pointer bg-transparent border-0 p-0" type="button" data-copy-md="${escapeHtml(btoa(mdSnippet))}">copiar markdown</button>
      </div>
      <pre class="bg-[#16140f] m-0 px-4 py-3 text-[12px] leading-[1.7] overflow-x-auto" style="color:#d8d3c4;font-family:'JetBrains Mono',monospace">${escapeHtml(mdSnippet)}</pre>
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

    if (event.target.closest("[data-scroll-conflict]")) {
      const panel = $("[data-conflict-panel]");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    // 2a — seleção de contexto (toggle ativo)
    const ctxBtn = event.target.closest(".ctx-btn");
    if (ctxBtn) {
      const ctx = ctxBtn.dataset.ctx;
      const form = ctxBtn.closest("[data-context-form]");
      form.querySelectorAll(`.ctx-btn[data-ctx="${ctx}"]`).forEach((b) => {
        const active = b === ctxBtn;
        b.style.background = active ? "#5b4fe0" : "transparent";
        b.style.color = active ? "#fff" : "";
        b.style.borderColor = active ? "#5b4fe0" : "";
      });
      return;
    }

    // 2a — avaliar contexto
    const evalBtn = event.target.closest("[data-ctx-evaluate]");
    if (evalBtn) {
      const form = evalBtn.closest("[data-context-form]");
      const team = form.querySelector(".ctx-btn[data-ctx='team'][style*='#5b4fe0']")?.dataset.val || null;
      const stage = form.querySelector(".ctx-btn[data-ctx='stage'][style*='#5b4fe0']")?.dataset.val || null;
      const rejectedId = evalBtn.dataset.rejected;
      const adoptedId = evalBtn.dataset.adopted;
      const rejectedD = state.decisions.find((d) => d.id === rejectedId);
      const adoptedD = state.decisions.find((d) => d.id === adoptedId);
      const result = $("[data-ctx-result]", form);
      if (!team && !stage) { result.innerHTML = `<p class="text-[#6b6555] text-[13px]">selecione pelo menos uma opção acima.</p>`; return; }

      // heurística simples: time pequeno/inicial → rejeitou; grande/em escala → adotou
      const smallSignals = ["pequeno", "inicial"].filter(v => [team, stage].includes(v)).length;
      const largeSignals = ["grande", "em escala"].filter(v => [team, stage].includes(v)).length;
      const matchRejected = smallSignals > largeSignals;
      const match = matchRejected ? rejectedD : adoptedD;
      const other = matchRejected ? adoptedD : rejectedD;
      const pct = smallSignals === largeSignals ? 55 : (smallSignals > largeSignals ? 82 : 80);
      const matchColor = match?.verdict === "rejected" ? "#e0863c" : "#4ea36b";
      const otherPct = 100 - pct;

      result.innerHTML = `
        <div class="bg-[#1f1c16] border border-[#34302688] rounded-[14px] p-4" style="border-top:3px solid ${matchColor}">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="text-[13px] font-bold px-2 py-[3px] rounded-[6px]" style="background:${escapeHtml(match?.color||'#333')};color:${escapeHtml(match?.tone||'#fff')}">${escapeHtml(match?.company||'')}</span>
              <span class="text-white font-bold text-[15px]">${escapeHtml(verdictLabel(match?.verdict||'kept'))} ${escapeHtml(match?.subject||'')}</span>
            </div>
            <div class="text-right">
              <div class="font-bold text-[22px] leading-none" style="color:${matchColor}">${pct}%</div>
              <div class="font-mono text-[10px] text-[#6b6555]">match</div>
            </div>
          </div>
          <div class="mt-3 h-[6px] rounded-full overflow-hidden bg-[#2a2519]">
            <div class="h-full rounded-full" style="width:${pct}%;background:${matchColor}"></div>
          </div>
          <p class="text-[#a09880] text-[12px] mt-3 mb-0">contexto parecido com ${escapeHtml(match?.company||'')} — ${escapeHtml((match?.context||'').slice(0,80))}…</p>
          ${other ? `<p class="text-[#6b6555] text-[11px] mt-2 mb-0">⚠ mas se crescer rápido, reavalie — ${escapeHtml(other.company)} (${otherPct}% match) mostra outro caminho.</p>` : ""}
        </div>`;
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

    const copyMdBtn = event.target.closest("[data-copy-md]");
    if (copyMdBtn) {
      const md = atob(copyMdBtn.dataset.copyMd);
      navigator.clipboard.writeText(md).then(() => {
        const orig = copyMdBtn.textContent;
        copyMdBtn.textContent = "copiado!";
        setTimeout(() => { copyMdBtn.textContent = orig; }, 2000);
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
