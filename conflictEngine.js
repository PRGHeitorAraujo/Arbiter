function isOpposite(a, b) {
  return (
    a.id !== b.id &&
    a.topic === b.topic &&
    a.subject === b.subject &&
    a.verdict !== b.verdict &&
    [a.verdict, b.verdict].includes("adopted") &&
    [a.verdict, b.verdict].includes("rejected")
  );
}

function ordered(a, b) {
  return a.verdict === "rejected" ? [a, b] : [b, a];
}

// Returns the first [rejected, adopted] pair from a result list, or null.
export function findConflict(results) {
  for (const left of results) {
    const right = results.find((r) => isOpposite(left, r));
    if (right) return ordered(left, right);
  }
  return null;
}

// Returns all [rejected, adopted] pairs where decision conflicts with someone in pool.
export function findConflictsFor(decision, pool) {
  return pool
    .filter((d) => isOpposite(decision, d))
    .map((d) => ordered(decision, d));
}
