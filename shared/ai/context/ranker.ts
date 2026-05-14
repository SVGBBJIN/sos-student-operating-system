// Trim a list of retrieved/conversational chunks to a token budget. Token
// counting is approximated (chars / 4) — adequate for budget enforcement;
// exact accounting happens in telemetry from the provider's usage metadata.

export interface Rankable {
  text: string;
  score: number;       // higher = keep
  pinned?: boolean;    // pinned items bypass the budget cut
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface TrimResult<T extends Rankable> {
  kept: T[];
  dropped: T[];
  tokensUsed: number;
}

export function trimToBudget<T extends Rankable>(items: T[], budgetTokens: number): TrimResult<T> {
  const sorted = [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.score - a.score;
  });
  const kept: T[] = [];
  const dropped: T[] = [];
  let used = 0;
  for (const item of sorted) {
    const cost = estimateTokens(item.text);
    if (item.pinned || used + cost <= budgetTokens) {
      kept.push(item);
      used += cost;
    } else {
      dropped.push(item);
    }
  }
  return { kept, dropped, tokensUsed: used };
}
