import * as fs from 'fs';
import * as vscode from 'vscode';
import { extractPropertyKeysFromText } from '../parsing/configBindingsParser';
import { getConfigBindingIndex } from '../index/configBindingIndex';
import { toCanonicalKey } from '../parsing/relaxedBinding';
import {
  findPropertyLocationInProperties,
  findPropertyLocationInYaml,
  findModuleConfigFileUris,
  findSpringConfigFileUris,
  resolveModuleRootFromJavaFile,
} from '../parsing/springConfig';

const PLACEHOLDER_REGEX = /\$\{([^}:]+)(?::[^}]*)?\}/g;

interface PlaceholderSpan {
  key: string;
  start: number;
  end: number;
}

function findMatchingParenEnd(content: string, openIndex: number): number {
  let depth = 1;
  let i = openIndex + 1;
  let inString: '"' | "'" | undefined;

  while (i < content.length && depth > 0) {
    const ch = content[i];
    const prev = content[i - 1];

    if (inString) {
      if (ch === inString && prev !== '\\') {
        inString = undefined;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      i++;
      continue;
    }

    if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    }
    i++;
  }

  return depth === 0 ? i - 1 : -1;
}

function findPlaceholderSpans(text: string): PlaceholderSpan[] {
  const spans: PlaceholderSpan[] = [];
  let match: RegExpExecArray | null;

  PLACEHOLDER_REGEX.lastIndex = 0;
  while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
    const start = match.index ?? 0;
    spans.push({
      key: toCanonicalKey(match[1]),
      start,
      end: start + match[0].length,
    });
  }

  return spans;
}

function findPlaceholderKeyAtOffset(content: string, offset: number): string | undefined {
  for (const span of findPlaceholderSpans(content)) {
    if (offset >= span.start && offset <= span.end) {
      return span.key;
    }
  }
  return undefined;
}

function findAnnotationBodyAtOffset(
  content: string,
  offset: number
): { body: string; start: number; end: number; bodyStart: number } | undefined {
  const regex = /@([\w.]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const start = match.index ?? 0;
    let cursor = start + match[0].length;

    while (cursor < content.length && /\s/.test(content[cursor])) {
      cursor++;
    }

    if (content[cursor] !== '(') {
      if (offset >= start && offset <= cursor) {
        return { body: '', start, end: cursor, bodyStart: cursor };
      }
      continue;
    }

    const closeIndex = findMatchingParenEnd(content, cursor);
    if (closeIndex < 0) {
      continue;
    }

    const end = closeIndex + 1;
    if (offset >= start && offset <= end) {
      return {
        body: content.substring(cursor + 1, closeIndex),
        start,
        end,
        bodyStart: cursor + 1,
      };
    }
  }

  return undefined;
}

function pickPlaceholderKeyForOffset(spans: PlaceholderSpan[], offset: number): string | undefined {
  if (spans.length === 0) {
    return undefined;
  }

  const direct = spans.find((span) => offset >= span.start && offset <= span.end);
  if (direct) {
    return direct.key;
  }

  if (spans.length === 1) {
    return spans[0].key;
  }

  let best = spans[0];
  let bestDistance = Infinity;
  for (const span of spans) {
    const distance = offset < span.start ? span.start - offset : offset > span.end ? offset - span.end : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = span;
    }
  }

  return best.key;
}

/** Return the canonical property key when the cursor is on a config placeholder usage. */
export function getPropertyPlaceholderAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  const content = document.getText();
  const offset = document.offsetAt(position);

  const direct = findPlaceholderKeyAtOffset(content, offset);
  if (direct) {
    return direct;
  }

  const annotation = findAnnotationBodyAtOffset(content, offset);
  if (!annotation) {
    return undefined;
  }

  const annotationText = content.substring(annotation.start, annotation.end);
  const keys = extractPropertyKeysFromText(annotationText);
  if (keys.length === 0) {
    return undefined;
  }

  const relativeOffset = offset - annotation.start;
  const spans = findPlaceholderSpans(annotationText).map((span) => ({
    ...span,
    start: span.start,
    end: span.end,
  }));

  if (spans.length > 0) {
    return pickPlaceholderKeyForOffset(spans, relativeOffset);
  }

  return keys.length === 1 ? keys[0] : undefined;
}

export function getConfigurationPropertiesPrefixAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  const content = document.getText();
  const offset = document.offsetAt(position);

  const annotation = findAnnotationBodyAtOffset(content, offset);
  if (!annotation) {
    return undefined;
  }

  const annotationName = content.substring(annotation.start, annotation.end).match(/^@([\w.]+)/)?.[1];
  if (
    annotationName !== 'ConfigurationProperties' &&
    !(annotationName ?? '').endsWith('.ConfigurationProperties')
  ) {
    return undefined;
  }

  const stringRegex = /["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(annotation.body)) !== null) {
    const value = match[1];
    const before = annotation.body.substring(0, match.index);
    const assignmentMatch = before.match(/(\w+)\s*=\s*$/);
    const attributeName = assignmentMatch?.[1];

    if (attributeName && attributeName !== 'prefix' && attributeName !== 'value') {
      continue;
    }

    const valueStartInContent = annotation.bodyStart + match.index + 1;
    const valueEndInContent = valueStartInContent + value.length;

    if (offset >= valueStartInContent && offset <= valueEndInContent) {
      return toCanonicalKey(value);
    }
  }

  return undefined;
}

export function isInPropertyPlaceholderContext(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  return (
    getPropertyPlaceholderAtPosition(document, position) !== undefined ||
    getConfigurationPropertiesPrefixAtPosition(document, position) !== undefined
  );
}

/** Return the bound property key when the cursor is on a @ConfigurationProperties field. */
export function getConfigurationPropertyKeyAtPosition(
  document: vscode.TextDocument,
  position: vscode.Position
): string | undefined {
  if (isInPropertyPlaceholderContext(document, position)) {
    return undefined;
  }

  const wordRange = document.getWordRangeAtPosition(position, /[A-Za-z_][\w]*/);
  if (!wordRange) {
    return undefined;
  }

  const memberName = document.getText(wordRange);
  const bindings = getConfigBindingIndex()
    .getBindingsForFile(document.uri)
    .filter((b) => b.kind === 'configurationProperties' && b.memberName === memberName);

  if (bindings.length === 0) {
    return undefined;
  }

  if (bindings.length === 1) {
    return bindings[0].propertyKey;
  }

  const onFieldLine = bindings.find((b) => b.line === position.line);
  return onFieldLine?.propertyKey ?? bindings[0].propertyKey;
}

async function collectConfigFileUris(nearJavaUri?: vscode.Uri): Promise<vscode.Uri[]> {
  const seen = new Set<string>();
  const uris: vscode.Uri[] = [];

  const addUri = (uri: vscode.Uri): void => {
    const key = uri.toString();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    uris.push(uri);
  };

  for (const uri of await findSpringConfigFileUris()) {
    addUri(uri);
  }

  if (nearJavaUri?.fsPath) {
    const moduleRoot = resolveModuleRootFromJavaFile(nearJavaUri.fsPath);
    if (moduleRoot) {
      for (const uri of await findModuleConfigFileUris(moduleRoot)) {
        addUri(uri);
      }
    }
  }

  return uris;
}

async function readConfigContent(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
  } catch {
    try {
      return fs.readFileSync(uri.fsPath, 'utf8');
    } catch {
      return undefined;
    }
  }
}

export async function findConfigPropertyLocations(
  propertyKey: string,
  nearJavaUri?: vscode.Uri,
  allowPrefix = false
): Promise<vscode.Location[]> {
  const uris = await collectConfigFileUris(nearJavaUri);
  const locations: vscode.Location[] = [];

  for (const uri of uris) {
    const content = await readConfigContent(uri);
    if (content === undefined) {
      continue;
    }

    const loc = uri.fsPath.toLowerCase().endsWith('.properties')
      ? findPropertyLocationInProperties(content, propertyKey, allowPrefix)
      : findPropertyLocationInYaml(content, propertyKey, allowPrefix);

    if (loc) {
      locations.push(new vscode.Location(uri, new vscode.Position(loc.line, loc.column)));
    }
  }

  return locations;
}
