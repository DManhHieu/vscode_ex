import * as vscode from 'vscode';

function getPropertyKeyFromPropertiesLine(line: string, character: number): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
    return undefined;
  }

  const eqIndex = trimmed.indexOf('=');
  if (eqIndex < 0) {
    return undefined;
  }

  const keyStart = line.indexOf(trimmed);
  const keyEnd = keyStart + eqIndex;
  if (character < keyStart || character > keyEnd) {
    return undefined;
  }

  return trimmed.substring(0, eqIndex).trim() || undefined;
}

function buildYamlKeyPath(stack: string[], key: string): string {
  return [...stack, key].join('.');
}

function getPropertyKeyFromYamlDocument(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  const stack: Array<{ indent: number; key: string }> = [];

  for (let lineNum = 0; lineNum <= position.line; lineNum++) {
    const rawLine = document.lineAt(lineNum).text;
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
    let value = trimmed.substring(colonIndex + 1).trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    if (lineNum === position.line) {
      const keyStart = rawLine.indexOf(key, indent);
      const keyEnd = keyStart + key.length;
      if (position.character >= keyStart && position.character <= keyEnd) {
        return buildYamlKeyPath(stack.map((entry) => entry.key), key);
      }
      return undefined;
    }

    if (value) {
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      void value;
    } else {
      stack.push({ indent, key });
    }
  }

  return undefined;
}

export function getPropertyKeyAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  const languageId = document.languageId;
  if (languageId === 'properties' || document.fileName.endsWith('.properties')) {
    return getPropertyKeyFromPropertiesLine(document.lineAt(position.line).text, position.character);
  }

  if (
    languageId === 'yaml' ||
    document.fileName.endsWith('.yml') ||
    document.fileName.endsWith('.yaml')
  ) {
    return getPropertyKeyFromYamlDocument(document, position);
  }

  return undefined;
}
