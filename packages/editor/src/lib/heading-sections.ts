/**
 * Which top-level blocks a set of collapsed headings hides. `levels[i]` is the
 * heading level (1..6) of block i, or 0 when it is not a heading. A collapsed
 * section hides everything up to the next heading of the same or a higher
 * level (a sibling `##` is not part of the `##` before it).
 */
export function resolveHiddenBlocks(levels: number[], isCollapsed: (index: number) => boolean): boolean[] {
  const hidden: boolean[] = new Array(levels.length).fill(false);
  let hiding = false;
  let hidingLevel = 0;
  for (let index = 0; index < levels.length; index += 1) {
    const level = levels[index]!;
    const isHeading = level > 0;
    if (hiding && isHeading && level <= hidingLevel) hiding = false;
    if (hiding) {
      hidden[index] = true;
      continue;
    }
    if (isHeading && isCollapsed(index)) {
      hiding = true;
      hidingLevel = level;
    }
  }
  return hidden;
}
