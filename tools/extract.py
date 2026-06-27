#!/usr/bin/env python3
"""
Arbiter — pipeline de ingestão.

Extrai decisões de engenharia de uma URL usando Claude e compara
com o corpus existente para detectar conflitos.

Uso:
  python tools/extract.py <url>           # extrai e imprime no terminal
  python tools/extract.py <url> --append  # extrai e adiciona ao decisions.json
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
DECISIONS_PATH = REPO_ROOT / "data" / "decisions.json"

KNOWN_TOPICS = [
    "message-queue", "database", "api-style", "language", "framework",
    "infrastructure", "caching", "storage", "monitoring", "deployment",
    "architecture", "authentication", "search", "streaming", "orchestration",
    "observability", "testing", "ci-cd",
]

UI_PALETTE = [
    {"color": "#edeaff", "tone": "#534ab7"},
    {"color": "#dcf5ec", "tone": "#14866d"},
    {"color": "#fff3d8", "tone": "#9c6414"},
    {"color": "#e8f1ff", "tone": "#2f679b"},
    {"color": "#fce8e8", "tone": "#c0392b"},
    {"color": "#f0fce8", "tone": "#2b7c14"},
]

VERDICT_PT = {"adopted": "adotou", "rejected": "rejeitou", "kept": "manteve"}

PROMPT = """\
You are extracting engineering decisions from a blog post for the Arbiter project.

## Task

Read the content below and extract every concrete technical decision into structured JSON.
A "decision" is when a company chose to adopt, reject, or keep a specific technology.

## Schema (per decision)

{{
  "id": "company-subject-verdict",        // kebab-case slug
  "empresa": "Company Name",
  "year": "YYYY",                          // year of post/decision, or null
  "topic": "<one from fixed list below>",
  "subject": "exact technology name",
  "verdict": "adopted | rejected | kept",
  "title": "short Portuguese headline — e.g. 'rejeitou Kafka'",
  "context": "1–2 sentences: team size, scale, existing stack, constraints",
  "reason": "1–2 sentences anchored in THEIR context explaining WHY",
  "source_url": "{url}",
  "tags": ["keyword", "array", "for", "search"]
}}

## Quality bar — context and reason are the HEART of each card

BAD (generic — useless):
  context: "company needed a message queue"
  reason: "Kafka provides high throughput and low latency"

GOOD (anchored — useful):
  context: "3-person startup, Postgres already in stack, near-real-time pipeline logs only"
  reason: "operational cost of new infra didn't justify it; Postgres handled the volume with far less complexity"

Rule: the `reason` MUST reference facts from `context`. If the source doesn't give enough detail to write an anchored reason, skip the decision.

## Fixed topic taxonomy

{topics}

## Output

Return ONLY a valid JSON array — no prose, no markdown fences. If nothing extractable exists, return [].

---

URL: {url}

Content:
{content}
"""


def fetch(url: str) -> str:
    """Fetch via Jina reader (clean markdown), fall back to raw."""
    for target in [f"https://r.jina.ai/{url}", url]:
        req = urllib.request.Request(
            target,
            headers={"User-Agent": "Arbiter/1.0", "Accept": "text/plain,text/html"},
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", errors="replace")[:15000]
        except urllib.error.URLError:
            continue
    raise RuntimeError(f"Could not fetch {url}")


def extract(url: str, content: str, client) -> list[dict]:
    prompt = PROMPT.format(
        url=url,
        topics=", ".join(KNOWN_TOPICS),
        content=content,
    )
    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = msg.content[0].text.strip()
    # strip accidental markdown fences
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
    return json.loads(raw)


def validate(decisions: list[dict]) -> list[str]:
    issues = []
    required = ["id", "empresa", "topic", "subject", "verdict", "context", "reason", "source_url", "tags"]
    for d in decisions:
        label = d.get("id", "?")
        for f in required:
            if not d.get(f):
                issues.append(f"{label}: missing '{f}'")
        if d.get("verdict") not in {"adopted", "rejected", "kept"}:
            issues.append(f"{label}: invalid verdict '{d.get('verdict')}'")
        if d.get("topic") and d["topic"] not in KNOWN_TOPICS:
            issues.append(f"{label}: unknown topic '{d['topic']}' — add to KNOWN_TOPICS or normalise")
    return issues


def assign_ui(decisions: list[dict], corpus: list[dict]) -> list[dict]:
    company_ui = {d["empresa"]: d["ui"] for d in corpus if d.get("ui")}
    idx = 0
    for d in decisions:
        if d.get("empresa") in company_ui:
            d["ui"] = company_ui[d["empresa"]]
        elif not d.get("ui"):
            d["ui"] = UI_PALETTE[idx % len(UI_PALETTE)]
            idx += 1
    return decisions


def find_conflicts(new_decisions: list[dict], corpus: list[dict]) -> list[tuple]:
    out = []
    for n in new_decisions:
        for old in corpus:
            if (old["id"] != n["id"]
                    and old.get("topic") == n.get("topic")
                    and old.get("subject", "").lower() == n.get("subject", "").lower()
                    and old.get("verdict") != n.get("verdict")
                    and {"adopted", "rejected"} <= {old.get("verdict"), n.get("verdict")}):
                out.append((n, old))
    return out


def main():
    parser = argparse.ArgumentParser(description="Arbiter extractor")
    parser.add_argument("url", help="URL of the engineering post or ADR")
    parser.add_argument("--append", action="store_true", help="append to data/decisions.json")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    try:
        import anthropic
    except ImportError:
        print("Run: pip install anthropic", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    corpus = json.loads(DECISIONS_PATH.read_text(encoding="utf-8")) if DECISIONS_PATH.exists() else []

    print(f"→ fetching {args.url}")
    content = fetch(args.url)
    print(f"  {len(content):,} chars")

    print("→ extracting with Claude...")
    try:
        decisions = extract(args.url, content, client)
    except json.JSONDecodeError as e:
        print(f"  JSON parse error: {e}", file=sys.stderr)
        sys.exit(1)

    print(f"  {len(decisions)} decision(s) extracted\n")

    if not decisions:
        print("Nothing extractable. The post may not contain concrete decisions.")
        return

    issues = validate(decisions)
    if issues:
        print("── Validation issues ────────────────────────────────────────────")
        for issue in issues:
            print(f"  ⚠  {issue}")
        print()

    decisions = assign_ui(decisions, corpus)
    conflicts = find_conflicts(decisions, corpus)

    print("── Extracted decisions ──────────────────────────────────────────")
    for d in decisions:
        vl = VERDICT_PT.get(d.get("verdict", ""), d.get("verdict", ""))
        print(f"\n  {d.get('empresa')} {d.get('year', '')} · {d.get('topic')} · {vl} {d.get('subject')}")
        print(f"  context : {d.get('context')}")
        print(f"  reason  : {d.get('reason')}")
        print(f"  tags    : {', '.join(d.get('tags', []))}")

    if conflicts:
        print("\n── Conflicts against corpus ─────────────────────────────────────")
        for new, old in conflicts:
            new_vl = VERDICT_PT.get(new.get("verdict", ""), new.get("verdict", ""))
            old_vl = VERDICT_PT.get(old.get("verdict", ""), old.get("verdict", ""))
            print(f"\n  ✦ {new.get('empresa')} {new_vl} {new.get('subject')}")
            print(f"    vs {old.get('empresa')} {old_vl} {old.get('subject')}")
            print(f"    new context : {new.get('context')}")
            print(f"    old context : {old.get('context')}")

    print("\n── JSON output ──────────────────────────────────────────────────")
    print(json.dumps(decisions, ensure_ascii=False, indent=2))

    if args.append:
        existing_ids = {d["id"] for d in corpus}
        new_entries = [d for d in decisions if d["id"] not in existing_ids]
        if not new_entries:
            print("\nAll IDs already in corpus — nothing appended.")
            return
        updated = corpus + new_entries
        DECISIONS_PATH.write_text(json.dumps(updated, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n✓ {len(new_entries)} decision(s) appended to data/decisions.json")


if __name__ == "__main__":
    main()
