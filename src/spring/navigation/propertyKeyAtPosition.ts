import * as vscode from 'vscode';
import { isPropertiesConfigDocument, isYamlConfigDocument } from '../springConfigLanguages';

function getPropertyKeyFromPropertiesLine(line: string, character: number): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
    return undefined;
  }

  const eqIndex = trimmed.indexOf('=');
  if (eqIndex < 0) {
    return undefined;
  }

  const key = trimmed.substring(0, eqIndex).trim();
  if (!key) {
    return undefined;
  }

  const keyStart = line.indexOf(trimmed);
  const eqPos = keyStart + eqIndex;
  if (character >= keyStart && character < eqPos) {
    return key;
  }

  if (character > eqPos) {
    return key;
  }

  return undefined;
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
      const fullKey = buildYamlKeyPath(stack.map((entry) => entry.key), key);
      const commentStart = rawLine.indexOf('#');
      if (commentStart >= 0 && position.character >= commentStart) {
        return undefined;
      }

      const keyStart = rawLine.indexOf(key, indent);
      const keyEnd = keyStart + key.length;
      if (position.character >= keyStart && position.character <= keyEnd) {
        return fullKey;
      }

      const colonPos = rawLine.indexOf(':', indent);
      if (value && colonPos >= 0 && position.character > colonPos) {
        return fullKey;
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
  if (isPropertiesConfigDocument(document)) {
    return getPropertyKeyFromPropertiesLine(document.lineAt(position.line).text, position.character);
  }

  if (isYamlConfigDocument(document)) {
    return getPropertyKeyFromYamlDocument(document, position);
  }

  return undefined;
}
