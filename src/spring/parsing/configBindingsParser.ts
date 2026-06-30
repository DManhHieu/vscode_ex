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

function extractValuePropertyKey(valueExpr: string): string | undefined {
  const match = valueExpr.match(/\$\{([^}:]+)(?::[^}]*)?\}/);
  return match ? toCanonicalKey(match[1]) : undefined;
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

function parseValueBindings(content: string): ParsedConfigBinding[] {
  const bindings: ParsedConfigBinding[] = [];

  const fieldRegex =
    /@Value\s*\(\s*["']([^"']+)["']\s*\)\s*(?:(?:private|protected|public)\s+)?(?:[\w.<>,\s\[\]?]+\s+)?(\w+)\s*[;=]/g;
  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(content)) !== null) {
    const propertyKey = extractValuePropertyKey(match[1]);
    if (!propertyKey) {
      continue;
    }
    const pos = lineColumnAt(content, match.index ?? 0);
    const classMatch = content.substring(0, match.index).match(/class\s+(\w+)/g);
    const className = classMatch ? classMatch[classMatch.length - 1].replace('class ', '') : '';
    bindings.push({
      propertyKey,
      kind: 'value',
      className,
      memberName: match[2],
      line: pos.line,
      column: pos.column,
    });
  }

  const ctorParamRegex =
    /@Value\s*\(\s*["']([^"']+)["']\s*\)\s*([\w.<>,\s\[\]?]+)\s+(\w+)/g;
  while ((match = ctorParamRegex.exec(content)) !== null) {
    const before = content.substring(0, match.index ?? 0);
    if (!/\([^)]*$/.test(before.split('\n').pop() ?? before)) {
      continue;
    }
    const propertyKey = extractValuePropertyKey(match[1]);
    if (!propertyKey) {
      continue;
    }
    const pos = lineColumnAt(content, match.index ?? 0);
    const classMatch = before.match(/class\s+(\w+)/g);
    const className = classMatch ? classMatch[classMatch.length - 1].replace('class ', '') : '';
    bindings.push({
      propertyKey,
      kind: 'value',
      className,
      memberName: match[3],
      line: pos.line,
      column: pos.column,
    });
  }

  return bindings;
}

export function parseConfigBindingsFromSource(content: string): ParsedConfigBinding[] {
  if (!/@ConfigurationProperties\b/.test(content) && !/@Value\b/.test(content)) {
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

  bindings.push(...parseValueBindings(content));

  const seen = new Set<string>();
  return bindings.filter((b) => {
    const key = `${b.propertyKey}|${b.kind}|${b.className}|${b.memberName}|${b.line}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
