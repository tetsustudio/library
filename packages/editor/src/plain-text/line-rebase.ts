/** A text edit: replace `[from, to)` with `insert`. */
export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/** A span `[aFrom, aTo)` of A that is `[bFrom, bTo)` in B: lines, or document blocks. */
export interface Span {
  aFrom: number;
  aTo: number;
  bFrom: number;
  bTo: number;
}

// Above this the LCS table is too large: the whole middle becomes one span.
// Only happens when two versions differ in thousands of lines.
const MAX_LCS_CELLS = 4_000_000;

/** Lines with their `\n` included, so joining them gives the text back. */
function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

/** The spans that differ between two sequences, by longest common subsequence. */
export function diffSequences(a: string[], b: string[]): Span[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const n = a.length - prefix - suffix;
  const m = b.length - prefix - suffix;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_LCS_CELLS) {
    return [{ aFrom: prefix, aTo: prefix + n, bFrom: prefix, bTo: prefix + m }];
  }

  // lcs[i][j]: length of the LCS of a[i..] and b[j..] within the middle.
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[prefix + i] === b[prefix + j] ? lcs[(i + 1) * width + j + 1]! + 1 : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!);
    }
  }

  const spans: Span[] = [];
  let open: Span | null = null;
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[prefix + i] === b[prefix + j]) {
      if (open) spans.push(open);
      open = null;
      i++;
      j++;
      continue;
    }
    open ??= { aFrom: prefix + i, aTo: prefix + i, bFrom: prefix + j, bTo: prefix + j };
    if (j < m && (i === n || lcs[i * width + j + 1]! >= lcs[(i + 1) * width + j]!)) {
      j++;
      open.bTo = prefix + j;
    } else {
      i++;
      open.aTo = prefix + i;
    }
  }
  if (open) spans.push(open);
  return spans;
}

function delta(s: Span): number {
  return s.bTo - s.bFrom - (s.aTo - s.aFrom);
}

// Where line boundary `k` of A lands in B, for a `k` inside no span. `before`
// skips spans that only insert at `k` (lands before the insertion); `after`
// counts them (lands after it).
function boundaryBefore(spans: Span[], k: number): number {
  let total = k;
  for (const s of spans) if (s.aTo <= k && s.aFrom < k) total += delta(s);
  return total;
}

function boundaryAfter(spans: Span[], k: number): number {
  let total = k;
  for (const s of spans) if (s.aTo <= k) total += delta(s);
  return total;
}

function crosses(s: Span, from: number, to: number): boolean {
  if (from === to) return s.aFrom < from && s.aTo > from;
  return s.aFrom < to && s.aTo > from;
}

/**
 * How to apply to the user's text what changed on the document side.
 *
 * - `base` is what the serializer writes for the document the user's text stands for.
 * - `user` is the text as the user has it: same content as `base`, in their
 *   own way of writing it (`*` instead of `-`, no escapes, extra blank lines).
 * - `remote` is what the serializer writes for the current document.
 *
 * What changed from `base` to `remote` is applied over `user`. Where a remote
 * change touches a line the user wrote differently than the serializer, that
 * zone takes the serializer's form: the only normalization. The rest of the
 * user's text is left alone.
 */
export function rebaseRemote(base: string, user: string, remote: string): TextChange[] {
  if (base === remote) return [];
  // Every text ends in `\n`, or a last line with and without it would differ
  // and an insertion at the end would stick to the last line.
  const missingFinalNewline = user !== '' && !user.endsWith('\n');
  const withNewline = (t: string) => (t === '' || t.endsWith('\n') ? t : `${t}\n`);
  const baseLines = splitLines(withNewline(base));
  const userLines = splitLines(withNewline(user));
  const remoteLines = splitLines(withNewline(remote));

  // Drift is almost always line by line (each `*` bullet, each escape): a span
  // with the same line count on both sides splits into pairs, or one bullet the
  // remote touched would normalize the whole list.
  const drift = diffSequences(baseLines, userLines).flatMap((s) =>
    s.aTo - s.aFrom === s.bTo - s.bFrom
      ? Array.from({ length: s.aTo - s.aFrom }, (_, k) => ({ aFrom: s.aFrom + k, aTo: s.aFrom + k + 1, bFrom: s.bFrom + k, bTo: s.bFrom + k + 1 }))
      : [s],
  );
  const remotes = diffSequences(baseLines, remoteLines);
  if (remotes.length === 0) return [];
  const all = [...drift, ...remotes];

  const zones: Array<{ from: number; to: number }> = [];
  for (const r of remotes) {
    let from = r.aFrom;
    let to = r.aTo;
    for (let changed = true; changed; ) {
      changed = false;
      for (const s of all) {
        if (!crosses(s, from, to)) continue;
        if (s.aFrom < from || s.aTo > to) {
          from = Math.min(from, s.aFrom);
          to = Math.max(to, s.aTo);
          changed = true;
        }
      }
    }
    zones.push({ from, to });
  }
  zones.sort((x, y) => x.from - y.from || x.to - y.to);
  const merged: Array<{ from: number; to: number }> = [];
  for (const zone of zones) {
    const last = merged[merged.length - 1];
    // Touching zones merge too: a zone ending at `k` already includes what
    // the remote inserts at `k`, and another zone at `k` would insert it again.
    if (last && zone.from <= last.to) last.to = Math.max(last.to, zone.to);
    else merged.push({ ...zone });
  }

  const offsets = [0];
  for (const line of userLines) offsets.push(offsets[offsets.length - 1]! + line.length);

  const changes: TextChange[] = [];
  for (const zone of merged) {
    const bFrom = boundaryAfter(drift, zone.from);
    const bTo = Math.max(bFrom, boundaryBefore(drift, zone.to));
    const rFrom = boundaryBefore(remotes, zone.from);
    const rTo = boundaryAfter(remotes, zone.to);
    const insert = remoteLines.slice(rFrom, rTo).join('');
    const from = offsets[bFrom]!;
    const to = offsets[bTo]!;
    if (insert !== userLines.slice(bFrom, bTo).join('')) changes.push({ from, to, insert });
  }
  if (!missingFinalNewline || changes.length === 0) return changes;

  // The user had no final `\n` and one was added to compare. When the last
  // change reaches that added newline, it is rebuilt from the full result.
  const last = changes[changes.length - 1]!;
  if (last.to < user.length + 1) return changes;
  let result = withNewline(user);
  let shift = 0;
  for (const c of changes) {
    result = result.slice(0, c.from + shift) + c.insert + result.slice(c.to + shift);
    shift += c.insert.length - (c.to - c.from);
  }
  if (result.endsWith('\n')) result = result.slice(0, -1);
  const previous = changes.slice(0, -1);
  const previousShift = previous.reduce((s, c) => s + c.insert.length - (c.to - c.from), 0);
  // Dropping the final newline can eat the `\n` before the zone, and what is
  // inserted at the end starts after the added newline: the smallest wins.
  const from = Math.min(last.from, user.length, result.length - previousShift);
  if (previous.some((c) => c.to > from)) return [{ from: 0, to: user.length, insert: result }];
  return [...previous, { from, to: user.length, insert: result.slice(from + previousShift) }];
}
