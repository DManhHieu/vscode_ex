/** Convert camelCase / PascalCase to kebab-case for property path segments. */
export function fieldNameToPropertySegment(fieldName: string): string {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

/** Normalize a property key for canonical storage and lookup. */
export function toCanonicalKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

function normalizeSegment(segment: string): string {
  return segment.toLowerCase().replace(/_/g, '-');
}

/** Compare two property keys using Spring relaxed binding rules. */
export function keysMatch(propertyKey: string, bindingKey: string): boolean {
  const a = toCanonicalKey(propertyKey).split('.');
  const b = toCanonicalKey(bindingKey).split('.');
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (normalizeSegment(a[i]) !== normalizeSegment(b[i])) {
      return false;
    }
  }
  return true;
}

/** Build a dotted property key from prefix and field path segments. */
export function buildPropertyKey(prefix: string, segments: string[]): string {
  const parts: string[] = [];
  if (prefix.trim()) {
    parts.push(toCanonicalKey(prefix));
  }
  for (const seg of segments) {
    parts.push(fieldNameToPropertySegment(seg));
  }
  return parts.filter(Boolean).join('.');
}
