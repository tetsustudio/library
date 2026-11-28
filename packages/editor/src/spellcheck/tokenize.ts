export interface SpellToken {
  text: string;
  start: number;
  end: number;
}

// Latin-1 letters (À-Ö, Ø-ö, ø-ÿ around the ×/÷ gaps) cover á é í ó ú ü ñ
// without the regex `u` flag. Digits and punctuation split words; an inner
// apostrophe or hyphen does not.
const WORD_PATTERN = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');
const TRAILING_WORD = /[A-Za-zÀ-ÖØ-öø-ÿ]+$/;

function stripDiacritics(word: string): string {
  return word.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

/** Suggestions that are the same word with other accents ("día" for "dia"). */
export function accentOnlyFixes(word: string, suggestions: string[]): string[] {
  const base = stripDiacritics(word);
  return suggestions.filter((suggestion) => stripDiacritics(suggestion) === base);
}

/**
 * nspell ranks by edit distance only, which buries the fix a Spanish typist
 * wants ("dia" put "día" sixth). A missing accent is the most common Spanish
 * misspelling and it is unambiguous, so accent-only fixes go first.
 */
export function rankSuggestions(word: string, suggestions: string[]): string[] {
  const fixes = new Set(accentOnlyFixes(word, suggestions));
  return [...suggestions.filter((s) => fixes.has(s)), ...suggestions.filter((s) => !fixes.has(s))];
}

/** The word the caret just finished: the letters right before the boundary being typed. */
export function trailingWord(text: string): string | null {
  const match = TRAILING_WORD.exec(text);
  return match ? match[0] : null;
}

export function tokenizeText(text: string): SpellToken[] {
  const tokens: SpellToken[] = [];
  WORD_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_PATTERN.exec(text))) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}
