export interface EntityField {
  name: string;
  columnName: string;
  type: string;
}

export interface ParsedEntity {
  className: string;
  entityName: string;
  tableName: string;
  fields: EntityField[];
  classStartLine: number;
}

export interface ParsedQuery {
  sql: string;
  nativeQuery: boolean;
  startLine: number;
  endLine: number;
  namedParams: string[];
  positionalParams: number[];
}

export interface ParsedRepository {
  interfaceName: string;
  entityType: string;
  idType: string;
  methods: Array<{ name: string; line: number; column: number }>;
  startLine: number;
}

export function camelToSnake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

export function extractAnnotationValue(text: string, annotation: string, attr?: string): string | undefined {
  const pattern = attr
    ? new RegExp(`@${annotation}\\s*\\([^)]*${attr}\\s*=\\s*["']([^"']+)["']`, 's')
    : new RegExp(`@${annotation}(?:\\s*\\(\\s*name\\s*=\\s*["']([^"']+)["']\\s*\\))?`);
  const match = text.match(pattern);
  return match?.[1];
}

export function parseEntityFromSource(content: string, filePath: string): ParsedEntity | undefined {
  if (!/@Entity\b/.test(content)) {
    return undefined;
  }

  const classMatch = content.match(/(?:public\s+|abstract\s+)*class\s+(\w+)/);
  if (!classMatch) {
    return undefined;
  }

  const className = classMatch[1];
  const entityName = extractAnnotationValue(content, 'Entity', 'name') ?? className;
  const tableName = extractAnnotationValue(content, 'Table', 'name') ?? camelToSnake(className);
  const classStartLine = content.substring(0, classMatch.index ?? 0).split('\n').length - 1;

  const fields: EntityField[] = [];
  const fieldRegex = /(?:(@[\w.]+(?:\([^)]*\))?\s*)*)(?:private|protected)\s+([\w.<>,\s\[\]]+?)\s+(\w+)\s*;/g;
  let fieldMatch: RegExpExecArray | null;

  while ((fieldMatch = fieldRegex.exec(content)) !== null) {
    const annotations = fieldMatch[1] ?? '';
    const fieldName = fieldMatch[3];
    const fieldType = fieldMatch[2].trim();

    if (fieldName === 'serialVersionUID') {
      continue;
    }

    const columnMatch = annotations.match(/@Column\s*\([^)]*name\s*=\s*["']([^"']+)["']/);
    const columnName = columnMatch?.[1] ?? camelToSnake(fieldName);
    fields.push({ name: fieldName, columnName, type: fieldType });
  }

  return { className, entityName, tableName, fields, classStartLine };
}

export function parseRepositoriesFromSource(content: string): ParsedRepository[] {
  const repos: ParsedRepository[] = [];
  const interfaceRegex =
    /(?:public\s+)?interface\s+(\w+)\s+extends\s+[\w.]*(?:Jpa|Crud|PagingAndSorting)Repository\s*<\s*(\w+)\s*,\s*([\w.<>,\s]+?)\s*>/g;

  let match: RegExpExecArray | null;
  while ((match = interfaceRegex.exec(content)) !== null) {
    const interfaceName = match[1];
    const entityType = match[2];
    const idType = match[3].trim();
    const startLine = content.substring(0, match.index).split('\n').length - 1;

    const interfaceBodyStart = match.index + match[0].length;
    const braceStart = content.indexOf('{', interfaceBodyStart);
    if (braceStart < 0) {
      continue;
    }

    let depth = 1;
    let i = braceStart + 1;
    while (i < content.length && depth > 0) {
      if (content[i] === '{') {
        depth++;
      } else if (content[i] === '}') {
        depth--;
      }
      i++;
    }

    const body = content.substring(braceStart + 1, i - 1);
    const methods: ParsedRepository['methods'] = [];
    const methodRegex = /(?:@[\w.]+(?:\([^)]*\))?\s*)*([\w.<>,\s\[\]?]+?)\s+(\w+)\s*\(/g;
    let methodMatch: RegExpExecArray | null;

    while ((methodMatch = methodRegex.exec(body)) !== null) {
      const methodName = methodMatch[2];
      if (['class', 'interface', 'enum', 'new'].includes(methodName)) {
        continue;
      }
      const absoluteIndex = braceStart + 1 + (methodMatch.index ?? 0);
      const beforeMethod = content.substring(0, absoluteIndex);
      const line = beforeMethod.split('\n').length - 1;
      const lastLine = beforeMethod.split('\n').pop() ?? '';
      methods.push({ name: methodName, line, column: lastLine.length });
    }

    repos.push({ interfaceName, entityType, idType, methods, startLine });
  }

  return repos;
}

export function extractStringLiteralAt(
  content: string,
  position: number
): { start: number; end: number; value: string; isTextBlock: boolean } | undefined {
  const before = content.substring(0, position);

  const textBlockMatch = before.lastIndexOf('"""');
  if (textBlockMatch >= 0) {
    const afterOpen = textBlockMatch + 3;
    const closeIndex = content.indexOf('"""', afterOpen);
    if (closeIndex >= 0 && position >= afterOpen && position <= closeIndex) {
      return {
        start: textBlockMatch,
        end: closeIndex + 3,
        value: content.substring(afterOpen, closeIndex),
        isTextBlock: true,
      };
    }
  }

  for (let i = position; i >= 0; i--) {
    const ch = content[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let value = '';
      while (j < content.length) {
        const c = content[j];
        if (c === '\\' && j + 1 < content.length) {
          value += content[j + 1];
          j += 2;
          continue;
        }
        if (c === quote) {
          if (position >= i && position <= j) {
            return { start: i, end: j + 1, value, isTextBlock: false };
          }
          break;
        }
        value += c;
        j++;
      }
    }
  }

  return undefined;
}

export function unescapeJavaString(value: string): string {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function joinSqlSegments(segments: string[]): string {
  if (segments.length === 0) {
    return '';
  }
  if (segments.length === 1) {
    return segments[0].trim();
  }

  const hasMultiline = segments.some((s) => s.includes('\n'));
  if (hasMultiline) {
    return segments.map((s) => s.trim()).join('\n').trim();
  }

  return segments.map((s) => s.trim()).join(' ').trim();
}

function collectConcatenatedLiterals(section: string): string[] {
  const segments: string[] = [];
  let i = 0;

  while (i < section.length) {
    while (i < section.length && /[\s+]/.test(section[i])) {
      i++;
    }
    if (i >= section.length) {
      break;
    }

    if (section.startsWith('nativeQuery', i)) {
      break;
    }

    if (section.startsWith('"""', i)) {
      const end = section.indexOf('"""', i + 3);
      if (end < 0) {
        break;
      }
      segments.push(section.substring(i + 3, end));
      i = end + 3;
      continue;
    }

    const quote = section[i];
    if (quote === '"' || quote === "'") {
      let j = i + 1;
      let raw = '';
      while (j < section.length) {
        if (section[j] === '\\' && j + 1 < section.length) {
          raw += section[j] + section[j + 1];
          j += 2;
          continue;
        }
        if (section[j] === quote) {
          break;
        }
        raw += section[j];
        j++;
      }
      segments.push(unescapeJavaString(raw));
      i = j + 1;
      continue;
    }

    break;
  }

  return segments;
}

export function extractQuerySql(annotationBody: string): string {
  const textBlockMatch = annotationBody.match(/"""([\s\S]*?)"""/);
  if (textBlockMatch) {
    return textBlockMatch[1].trim();
  }

  let sqlSection = annotationBody.trim();
  const valueMatch = annotationBody.match(/\bvalue\s*=\s*/);
  if (valueMatch && valueMatch.index !== undefined) {
    sqlSection = annotationBody.substring(valueMatch.index + valueMatch[0].length);
  }

  const segments = collectConcatenatedLiterals(sqlSection);
  if (segments.length > 0) {
    return joinSqlSegments(segments);
  }

  const singleMatch = annotationBody.match(/^"((?:\\.|[^"\\])*)"/s);
  if (singleMatch) {
    return unescapeJavaString(singleMatch[1]).trim();
  }

  return '';
}

export function parseJpqlAliases(sql: string): Map<string, string> {
  const aliases = new Map<string, string>();

  const withAlias = /(?:FROM|JOIN)\s+(\w+)\s+(?:AS\s+)?(\w+)(?=\s|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = withAlias.exec(sql)) !== null) {
    const entity = match[1];
    const alias = match[2];
    if (!['WHERE', 'ORDER', 'GROUP', 'HAVING', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'ON', 'AND', 'OR'].includes(alias.toUpperCase())) {
      aliases.set(alias.toLowerCase(), entity);
    }
  }

  const withoutAlias = /(?:FROM|JOIN)\s+(\w+)(?=\s+(?:WHERE|ORDER|GROUP|HAVING|JOIN|LEFT|RIGHT|INNER|,|;|$))/gi;
  while ((match = withoutAlias.exec(sql)) !== null) {
    const entity = match[1];
    aliases.set(entity.toLowerCase(), entity);
  }

  return aliases;
}

export function extractQueryParams(sql: string): { namedParams: string[]; positionalParams: number[] } {
  const namedParams = [...sql.matchAll(/:([a-zA-Z_][\w]*)/g)].map((m) => m[1]);
  const positionalParams = [...sql.matchAll(/\?(\d+)/g)].map((m) => parseInt(m[1], 10));
  return { namedParams, positionalParams };
}

export function getAnnotationBody(content: string, atIndex: number): string | undefined {
  const queryStart = content.lastIndexOf('@Query', atIndex);
  if (queryStart < 0) {
    return undefined;
  }

  const parenStart = content.indexOf('(', queryStart);
  if (parenStart < 0) {
    return undefined;
  }

  let depth = 1;
  let i = parenStart + 1;
  while (i < content.length && depth > 0) {
    const c = content[i];
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    }
    i++;
  }

  if (atIndex > i) {
    return undefined;
  }

  return content.substring(parenStart + 1, i - 1);
}

export function findQueryAtPosition(content: string, position: number): ParsedQuery | undefined {
  const queries = parseQueriesFromSource(content);
  const offset = position;
  for (const q of queries) {
    const lines = content.split('\n');
    let startOffset = 0;
    for (let i = 0; i < q.startLine; i++) {
      startOffset += lines[i].length + 1;
    }
    let endOffset = startOffset;
    for (let i = q.startLine; i <= q.endLine && i < lines.length; i++) {
      endOffset += lines[i].length + (i < q.endLine ? 1 : 0);
    }
    if (offset >= startOffset && offset <= endOffset) {
      return q;
    }
  }
  return undefined;
}

export function parseQueriesFromSource(content: string): ParsedQuery[] {
  const results: ParsedQuery[] = [];
  const queryRegex = /@Query\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = queryRegex.exec(content)) !== null) {
    const startIndex = match.index;
    const startLine = content.substring(0, startIndex).split('\n').length - 1;

    const parenStart = content.indexOf('(', startIndex);
    if (parenStart < 0) {
      continue;
    }

    let depth = 1;
    let i = parenStart + 1;
    while (i < content.length && depth > 0) {
      const c = content[i];
      if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
      }
      i++;
    }

    const annotationBody = content.substring(parenStart + 1, i - 1);
    const nativeQuery = /nativeQuery\s*=\s*true/.test(annotationBody);
    const sql = extractQuerySql(annotationBody);

    if (!sql) {
      continue;
    }

    const endLine = content.substring(0, i).split('\n').length - 1;
    const { namedParams, positionalParams } = extractQueryParams(sql);

    results.push({ sql, nativeQuery, startLine, endLine, namedParams, positionalParams });
  }

  return results;
}

function isInsideQueryValueSection(annotationBody: string, relativePos: number): boolean {
  if (relativePos < 0 || relativePos >= annotationBody.length) {
    return false;
  }

  const textBlockStart = annotationBody.indexOf('"""');
  if (textBlockStart >= 0) {
    const textBlockEnd = annotationBody.indexOf('"""', textBlockStart + 3) + 3;
    if (relativePos >= textBlockStart && relativePos <= textBlockEnd) {
      return true;
    }
  }

  const valueMatch = annotationBody.match(/\bvalue\s*=\s*/);
  const sectionStart = valueMatch ? (valueMatch.index ?? 0) + valueMatch[0].length : 0;
  const nativeIdx = annotationBody.search(/\bnativeQuery\s*=/);
  const sectionEnd = nativeIdx >= 0 ? nativeIdx : annotationBody.length;

  if (relativePos < sectionStart || relativePos > sectionEnd) {
    return extractStringLiteralAt(annotationBody, relativePos) !== undefined;
  }

  return true;
}

export function isInsideQueryString(content: string, position: number): ParsedQuery | undefined {
  const queryRegex = /@Query\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = queryRegex.exec(content)) !== null) {
    const parenStart = content.indexOf('(', match.index);
    if (parenStart < 0) {
      continue;
    }

    let depth = 1;
    let i = parenStart + 1;
    while (i < content.length && depth > 0) {
      const c = content[i];
      if (c === '(') {
        depth++;
      } else if (c === ')') {
        depth--;
      }
      i++;
    }

    if (position < match.index || position > i) {
      continue;
    }

    const annotationBody = content.substring(parenStart + 1, i - 1);
    const relativePos = position - parenStart - 1;

    if (!isInsideQueryValueSection(annotationBody, relativePos)) {
      continue;
    }

    const nativeQuery = /nativeQuery\s*=\s*true/.test(annotationBody);
    const startLine = content.substring(0, match.index).split('\n').length - 1;
    const endLine = content.substring(0, i).split('\n').length - 1;
    const sql = extractQuerySql(annotationBody);
    const { namedParams, positionalParams } = extractQueryParams(sql);

    return { sql, nativeQuery, startLine, endLine, namedParams, positionalParams };
  }

  return undefined;
}
