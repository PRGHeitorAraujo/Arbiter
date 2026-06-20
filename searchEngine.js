function normalize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export function scoreDecision(decision, query) {
  const q = normalize(query);
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 2);

  let score = 0;

  if (q.includes(normalize(decision.subject))) score += 6;
  if (q.includes(normalize(decision.topic))) score += 4;
  for (const tag of decision.tags) {
    if (q.includes(normalize(tag))) score += 3;
  }

  const weighted = [
    { text: decision.context, weight: 2 },
    { text: decision.reason, weight: 1.5 },
    { text: decision.title, weight: 1 },
    { text: decision.company, weight: 0.5 },
  ];
  for (const { text, weight } of weighted) {
    const norm = normalize(text);
    for (const word of words) {
      if (norm.includes(word)) score += weight;
    }
  }

  return score;
}

export function searchDecisions(decisions, query) {
  return decisions
    .map((d) => ({ ...d, score: scoreDecision(d, query) }))
    .filter((d) => d.score > 0 || query.trim().length < 3)
    .sort((a, b) => b.score - a.score || a.company.localeCompare(b.company))
    .slice(0, 4);
}
