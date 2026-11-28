// Which link targets a click may open. A shared document is not always written
// by its reader, so `javascript:` and friends never open.
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function isSafeUrl(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return true;
  try {
    return SAFE_PROTOCOLS.has(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}
