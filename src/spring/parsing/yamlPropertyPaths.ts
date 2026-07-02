import { keysMatch } from './relaxedBinding';

export interface PropertyKeyLocation {
  line: number;
  column: number;
}

function buildYamlKeyPath(stack: string[], key: string): string {
  return [...stack, key].join('.');
}

/** Find the line/column of a property key in YAML content using relaxed binding. */
export function findPropertyLocationInYaml(content: string, propertyKey: string): PropertyKeyLocation | undefined {
  const stack: Array<{ indent: number; key: string }> = [];
  const lines = content.split('\n');

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

    if (!value) {
      stack.push({ indent, key });
    }
  }

  return undefined;
}
