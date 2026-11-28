// GitHub's heading-anchor algorithm: lowercase, drop punctuation (including
// Spanish ¿¡), spaces to hyphens, and repeated slugs get -1, -2... suffixes, so
// hand-written tables of contents resolve. `seen` is passed in so independent
// callers (anchors, collapse, an app's outline) keep their own counts.
export function slugify(text: string, seen: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[.,/#!$%^&*;:{}=_`~()[\]"'?¿¡<>\\|+]/g, '')
    .replace(/\s+/g, '-');
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count > 0 ? `${base}-${count}` : base;
}
