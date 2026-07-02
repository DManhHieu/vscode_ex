import { keysMatch, toCanonicalKey } from './relaxedBinding';

export interface PropertyKeyLocation {
  line: number;
  column: number;
}

function buildYamlKeyPath(stack: string[], key: string): string {
  return [...stack, key].join('.');
}

/** True when candidate is equal to prefix or is a descendant of it (relaxed binding). */
function isKeyOrPrefixMatch(candidate: string, target: string): boolean {
  if (keysMatch(candidate, target)) {
    return true;
  }
  const canonicalCandidate = toCanonicalKey(candidate);
  const canonicalTarget = toCanonicalKey(target);
  return canonicalCandidate.startsWith(`${canonicalTarget}.`);
}

/**
 * Find the line/column of a property key in YAML content using relaxed binding.
 * When allowPrefix is true, also matches a parent node whose descendants start with propertyKey.
 */
export function findPropertyLocationInYaml(
  content: string,
  propertyKey: string,
  allowPrefix = false
): PropertyKeyLocation | undefined {
  const stack: Array<{ indent: number; key: string }> = [];
  const lines = content.split('\n');
  let prefixFallback: PropertyKeyLocation | undefined;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const rawLine = lines[lineNum];
    const withoutComment = rawLine.split('#')[0];
    if (!withoutComment.trim()) {
      continue;
    }

    const indent = withoutComment.search(/\S/);
    if (indent < 0) {
      continue;
    }

    const trimmed = withoutComment.trim();
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex < 0) {
      continue;
    }

    const key = trimmed.substring(0, colonIndex).trim();
    const value = trimmed.substring(colonIndex + 1).trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const fullKey = buildYamlKeyPath(
      stack.map((entry) => entry.key),
      key
    );

    if (keysMatch(fullKey, propertyKey)) {
      const keyStart = rawLine.indexOf(key, indent);
      return { line: lineNum, column: keyStart >= 0 ? keyStart : indent };
    }

    if (allowPrefix && !prefixFallback && isKeyOrPrefixMatch(fullKey, propertyKey)) {
      const keyStart = rawLine.indexOf(key, indent);
      prefixFallback = { line: lineNum, column: keyStart >= 0 ? keyStart : indent };
    }

    if (!value) {
      stack.push({ indent, key });
    }
  }

  return prefixFallback;
}
