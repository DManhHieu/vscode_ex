import { buildPropertyKey, toCanonicalKey } from './relaxedBinding';

export interface ParsedConfigBinding {
  propertyKey: string;
  kind: 'configurationProperties' | 'value';
  className: string;
  memberName: string;
  line: number;
  column: number;
}

interface ParsedClassField {
  name: string;
  type: string;
  line: number;
  column: number;
  annotations: string;
}

interface ParsedConfigClass {
  className: string;
  prefix: string;
  bodyStart: number;
  bodyEnd: number;
  line: number;
}

interface ClassBodyInfo {
  className: string;
  bodyStart: number;
  bodyEnd: number;
  line: number;
  prefix?: string;
}

interface ParsedAnnotation {
  name: string;
  body: string;
  start: number;
  end: number;
}

function lineColumnAt(content: string, index: number): { line: number; column: number } {
  const before = content.substring(0, index);
  const line = before.split('\n').length - 1;
  const lastLine = before.split('\n').pop() ?? '';
  return { line, column: lastLine.length };
}

function extractConfigurationPropertiesPrefix(text: string): string | undefined {
  const directMatch = text.match(/@ConfigurationProperties\s*\(\s*["']([^"']+)["']\s*\)/);
  if (directMatch) {
    return directMatch[1];
  }
  const prefixMatch = text.match(/@ConfigurationProperties\s*\([^)]*prefix\s*=\s*["']([^"']+)["']/s);
  return prefixMatch?.[1];
}

/** Extract Spring property keys from ${key} and ${key:default} placeholders. */
export function extractPropertyKeysFromText(text: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const regex = /\$\{([^}:]+)(?::[^}]*)?\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const key = toCanonicalKey(match[1]);
    if (key && !seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }

  return keys;
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

function findMatchingBraceEnd(content: string, openBraceIndex: number): number {
  let depth = 1;
  let i = openBraceIndex + 1;
  while (i < content.length && depth > 0) {
    if (content[i] === '{') {
      depth++;
    } else if (content[i] === '}') {
      depth--;
    }
    i++;
  }
  return i - 1;
}

function findAnnotations(content: string): ParsedAnnotation[] {
  const annotations: ParsedAnnotation[] = [];
  const regex = /@([\w.]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const name = match[1];
    const start = match.index ?? 0;
    let cursor = start + match[0].length;

    while (cursor < content.length && /\s/.test(content[cursor])) {
      cursor++;
    }

    if (content[cursor] !== '(') {
      annotations.push({ name, body: '', start, end: cursor });
      continue;
    }

    const closeIndex = findMatchingParenEnd(content, cursor);
    if (closeIndex < 0) {
      continue;
    }

    annotations.push({
      name,
      body: content.substring(cursor + 1, closeIndex),
      start,
      end: closeIndex + 1,
    });
    regex.lastIndex = closeIndex + 1;
  }

  return annotations;
}

function resolveClassNameBefore(content: string, index: number): string {
  const before = content.substring(0, index);
  const classMatches = before.match(/class\s+(\w+)/g);
  return classMatches ? classMatches[classMatches.length - 1].replace('class ', '') : '';
}

function skipLeadingAnnotations(text: string): string {
  let rest = text;

  while (true) {
    const match = rest.match(/^\s*@([\w.]+)/);
    if (!match) {
      break;
    }

    let cursor = match[0].length;
    while (cursor < rest.length && /\s/.test(rest[cursor])) {
      cursor++;
    }

    if (rest[cursor] === '(') {
      const closeIndex = findMatchingParenEnd(rest, cursor);
      if (closeIndex < 0) {
        break;
      }
      cursor = closeIndex + 1;
    }

    rest = rest.substring(cursor);
  }

  return rest;
}

function resolveMemberNameAfter(content: string, annotationEnd: number): string | undefined {
  const rest = skipLeadingAnnotations(content.substring(annotationEnd));

  const paramMatch = rest.match(/^([\w.<>,\s\[\]?]+)\s+(\w+)\s*[,)]/);
  if (paramMatch) {
    return paramMatch[2];
  }

  const fieldMatch = rest.match(/^(?:(?:private|protected|public)\s+)?(?:[\w.<>,\s\[\]?]+\s+)+(\w+)\s*[;=]/);
  if (fieldMatch) {
    return fieldMatch[1];
  }

  const methodMatch = rest.match(
    /^(?:(?:public|protected|private)\s+)?(?:(?:static|final|synchronized|default|abstract)\s+)*(?:[\w.<>,\s\[\]?]+\s+)+(\w+)\s*\(/
  );
  if (methodMatch) {
    return methodMatch[1];
  }

  const classMatch = rest.match(/^class\s+(\w+)/);
  if (classMatch) {
    return classMatch[1];
  }

  return undefined;
}

function parseClassFields(body: string, bodyStartOffset: number, content: string): ParsedClassField[] {
  const fields: ParsedClassField[] = [];
  const fieldRegex =
    /(?:(@[\w.]+(?:\([^)]*\))?\s*)*)((?:private|protected|public)\s+)([\w.<>,\s\[\]?]+?)\s+(\w+)\s*(?:=\s*[^;]+)?\s*;/g;
  let match: RegExpExecArray | null;

  while ((match = fieldRegex.exec(body)) !== null) {
    const beforeInBody = body.substring(0, match.index ?? 0);
    const openBraces = (beforeInBody.match(/\{/g) ?? []).length;
    const closeBraces = (beforeInBody.match(/\}/g) ?? []).length;
    if (openBraces > closeBraces) {
      continue;
    }

    const memberName = match[4];
    if (memberName === 'serialVersionUID') {
      continue;
    }
    const absoluteIndex = bodyStartOffset + (match.index ?? 0);
    const pos = lineColumnAt(content, absoluteIndex);
    fields.push({
      name: memberName,
      type: match[3].trim().replace(/\?$/, ''),
      line: pos.line,
      column: pos.column,
      annotations: match[1] ?? '',
    });
  }

  return fields;
}

function findAllClassBodies(content: string): ClassBodyInfo[] {
  const classes: ClassBodyInfo[] = [];
  const classRegex =
    /(?:(@[\w.]+(?:\([^)]*\))?\s*)*)((?:public\s+|protected\s+|private\s+|static\s+)*)class\s+(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = classRegex.exec(content)) !== null) {
    const annotations = match[1] ?? '';
    const className = match[3];
    const classIndex = match.index ?? 0;
    const braceStart = content.indexOf('{', classIndex + match[0].length);
    if (braceStart < 0) {
      continue;
    }

    const bodyEnd = findMatchingBraceEnd(content, braceStart);
    const pos = lineColumnAt(content, classIndex);
    classes.push({
      className,
      bodyStart: braceStart + 1,
      bodyEnd,
      line: pos.line,
      prefix: extractConfigurationPropertiesPrefix(annotations),
    });
  }

  return classes;
}

function resolveNestedClass(fieldType: string, allClasses: ClassBodyInfo[]): ClassBodyInfo | undefined {
  const simpleName = fieldType.split('.').pop()?.replace(/\?$/, '').trim();
  if (!simpleName) {
    return undefined;
  }
  return allClasses.find((c) => c.className === simpleName);
}

function collectConfigurationPropertyBindings(
  configClass: ParsedConfigClass,
  content: string,
  allClasses: ClassBodyInfo[],
  parentSegments: string[] = []
): ParsedConfigBinding[] {
  const bindings: ParsedConfigBinding[] = [];
  const body = content.substring(configClass.bodyStart, configClass.bodyEnd);
  const fields = parseClassFields(body, configClass.bodyStart, content);

  for (const field of fields) {
    const segments = [...parentSegments, field.name];
    const propertyKey = buildPropertyKey(configClass.prefix, segments);
    bindings.push({
      propertyKey,
      kind: 'configurationProperties',
      className: configClass.className,
      memberName: field.name,
      line: field.line,
      column: field.column,
    });

    const isNested =
      /@NestedConfigurationProperty\b/.test(field.annotations) ||
      resolveNestedClass(field.type, allClasses) !== undefined;
    const nestedClass = resolveNestedClass(field.type, allClasses);
    if (isNested && nestedClass) {
      bindings.push(
        ...collectConfigurationPropertyBindings(
          {
            className: nestedClass.className,
            prefix: configClass.prefix,
            bodyStart: nestedClass.bodyStart,
            bodyEnd: nestedClass.bodyEnd,
            line: nestedClass.line,
          },
          content,
          allClasses,
          segments
        )
      );
    }
  }

  return bindings;
}

/** Index ${...} placeholders in any Spring annotation (@Value, @Scheduled, @KafkaListener, etc.). */
function parsePlaceholderBindings(content: string): ParsedConfigBinding[] {
  const bindings: ParsedConfigBinding[] = [];

  for (const annotation of findAnnotations(content)) {
    if (annotation.name === 'ConfigurationProperties' || annotation.name.endsWith('.ConfigurationProperties')) {
      continue;
    }

    const propertyKeys = extractPropertyKeysFromText(annotation.body);
    if (propertyKeys.length === 0) {
      continue;
    }

    const className = resolveClassNameBefore(content, annotation.start);
    const memberName = resolveMemberNameAfter(content, annotation.end) ?? className;
    const pos = lineColumnAt(content, annotation.start);

    for (const propertyKey of propertyKeys) {
      bindings.push({
        propertyKey,
        kind: 'value',
        className,
        memberName,
        line: pos.line,
        column: pos.column,
      });
    }
  }

  return bindings;
}

export function parseConfigBindingsFromSource(content: string): ParsedConfigBinding[] {
  if (!/\$\{/.test(content) && !/@ConfigurationProperties\b/.test(content)) {
    return [];
  }

  const bindings: ParsedConfigBinding[] = [];
  const allClasses = findAllClassBodies(content);
  const configClasses = allClasses.filter((c) => c.prefix);

  for (const configClass of configClasses) {
    bindings.push(
      ...collectConfigurationPropertyBindings(
        {
          className: configClass.className,
          prefix: configClass.prefix!,
          bodyStart: configClass.bodyStart,
          bodyEnd: configClass.bodyEnd,
          line: configClass.line,
        },
        content,
        allClasses
      )
    );
  }

  bindings.push(...parsePlaceholderBindings(content));

  const seen = new Set<string>();
  return bindings.filter((b) => {
    const key = `${b.propertyKey}|${b.kind}|${b.className}|${b.memberName}|${b.line}|${b.column}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
