/** Literal OR terms; prefix matching is automatic, with an optional trailing *. */
export function searchTerms(query: string): string[] {
  // Keep punctuation inside each term. Removing it joins words that SQLite's
  // tokenizer indexes separately (fresh-index becomes freshindex).
  return [...new Set(query.split(/\s+/).map(term => term.replace(/\*+$/, '')).filter(Boolean))];
}
