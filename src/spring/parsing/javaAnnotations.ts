export interface EntityAssociation {
  kind: 'ManyToOne' | 'OneToMany' | 'OneToOne' | 'ManyToMany';
  targetEntity: string;
  joinColumn?: string;
  mappedBy?: string;
  joinTable?: string;
}

export interface EntityField {
  name: string;
  columnName: string;
  type: string;
  association?: EntityAssociation;
}

export interface ParsedEntity {
  className: string;
  entityName: string;
  tableName: string;
  fields: EntityField[];
  classStartLine: number;
  superClassName?: string;
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

function extractSimpleJavaType(type: string): string {
  return type.replace(/\[\]$/, '').trim().split(/[<,>]/)[0]?.trim() ?? type;
}

function parseFieldAssociation(annotations: string, fieldType: string): EntityAssociation | undefined {
  const manyToOne = /@ManyToOne\b/.test(annotations);
  const oneToMany = /@OneToMany\b/.test(annotations);
  const oneToOne = /@OneToOne\b/.test(annotations);
  const manyToMany = /@ManyToMany\b/.test(annotations);

  if (!manyToOne && !oneToMany && !oneToOne && !manyToMany) {
    return undefined;
  }

  const kind = manyToMany ? 'ManyToMany' : oneToMany ? 'OneToMany' : oneToOne ? 'OneToOne' : 'ManyToOne';
  const joinColumnMatch = annotations.match(/@JoinColumn\s*\([^)]*name\s*=\s*["']([^"']+)["']/);
  const mappedByMatch = annotations.match(/mappedBy\s*=\s*["']([^"']+)["']/);
  const joinTableMatch = annotations.match(/@JoinTable\s*\([^)]*name\s*=\s*["']([^"']+)["']/);

  return {
    kind,
    targetEntity: extractSimpleJavaType(fieldType),
    joinColumn: joinColumnMatch?.[1],
    mappedBy: mappedByMatch?.[1],
    joinTable: joinTableMatch?.[1],
  };
}

export function extractAnnotationValue(text: string, annotation: string, attr?: string): string | undefined {
  const pattern = attr
    ? new RegExp(`@${annotation}\\s*\\([^)]*${attr}\\s*=\\s*["']([^"']+)["']`, 's')
    : new RegExp(`@${annotation}(?:\\s*\\(\\s*name\\s*=\\s*["']([^"']+)["']\\s*\\))?`);
  const match = text.match(pattern);
  return match?.[1];
}

export interface ParsedClassHierarchy {
  className: string;
  superClassName?: string;
  fields: EntityField[];
}

const CLASS_DECL_REGEX =
  /(?:public\s+|protected\s+|private\s+|abstract\s+|final\s+|sealed\s+|non-sealed\s+)*\bclass\s+(\w+)(?:\s+extends\s+([\w.]+))?/;

const FIELD_DECL_REGEX =
  /(?:(@[\w.]+(?:\([^)]*\))?\s*)*)(?:private|protected)\s+([\w.<>,\s\[\]]+?)\s+(\w+)\s*(?:=\s*[^;]+)?\s*;/g;

function parseFieldsFromSource(content: string): EntityField[] {
  const fields: EntityField[] = [];
  let fieldMatch: RegExpExecArray | null;

  while ((fieldMatch = FIELD_DECL_REGEX.exec(content)) !== null) {
    const annotations = fieldMatch[1] ?? '';
    const fieldName = fieldMatch[3];
    const fieldType = fieldMatch[2].trim();

    if (fieldName === 'serialVersionUID') {
      continue;
    }

    const columnMatch = annotations.match(/@Column\s*\([^)]*name\s*=\s*["']([^"']+)["']/);
    const columnName = columnMatch?.[1] ?? camelToSnake(fieldName);
    const association = parseFieldAssociation(annotations, fieldType);
    fields.push({ name: fieldName, columnName, type: fieldType, association });
  }

  return fields;
}

export function parseClassHierarchyFromSource(content: string): ParsedClassHierarchy | undefined {
  const classMatch = content.match(CLASS_DECL_REGEX);
  if (!classMatch) {
    return undefined;
  }

  const className = classMatch[1];
  const superClassRef = classMatch[2];
  const superClassName = superClassRef ? extractSimpleJavaType(superClassRef) : undefined;

  return {
    className,
    superClassName,
    fields: parseFieldsFromSource(content),
  };
}

export function parseEntityFromSource(content: string, filePath: string): ParsedEntity | undefined {
  const isEntity = /@Entity\b/.test(content);
  const isMappedSuperclass = /@MappedSuperclass\b/.test(content);
  const isEmbeddable = /@Embeddable\b/.test(content);
  if (!isEntity && !isMappedSuperclass && !isEmbeddable) {
    return undefined;
  }

  const classMatch = content.match(CLASS_DECL_REGEX);
  if (!classMatch) {
    return undefined;
  }

  const className = classMatch[1];
  const superClassRef = classMatch[2];
  const superClassName = superClassRef ? extractSimpleJavaType(superClassRef) : undefined;
  const entityName = extractAnnotationValue(content, 'Entity', 'name') ?? className;
  const tableName = extractAnnotationValue(content, 'Table', 'name') ?? camelToSnake(className);
  const classStartLine = content.substring(0, classMatch.index ?? 0).split('\n').length - 1;

  const fields = parseFieldsFromSource(content);

  return { className, entityName, tableName, fields, classStartLine, superClassName };
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

/** Collapse incidental whitespace in a SQL fragment (e.g. Java text blocks). */
function normalizeConcatSegment(segment: string): string {
  if (!/[\r\n]/.test(segment)) {
    return segment;
  }
  return segment.replace(/\s+/g, ' ').trim();
}

function joinSqlSegments(segments: string[]): string {
  if (segments.length === 0) {
    return '';
  }
  if (segments.length === 1) {
    return segments[0].trim();
  }

  return segments
    .map((s) => normalizeConcatSegment(s.trim()))
    .filter((s) => s.length > 0)
    .reduce((acc, seg) => {
      if (!acc) {
        return seg;
      }
      if (/[(\[,]$/.test(acc) || /^[)\],;.]/.test(seg)) {
        return acc + seg;
      }
      return `${acc} ${seg}`;
    }, '')
    .trim();
}

export interface QueryLiteralSegment {
  text: string;
  /** Document offset for each character in `text`. */
  offsets: number[];
}

function unescapeJavaChar(ch: string): string {
  switch (ch) {
    case 'n':
      return '\n';
    case 't':
      return '\t';
    case 'r':
      return '\r';
    case '"':
      return '"';
    case "'":
      return "'";
    case '\\':
      return '\\';
    default:
      return ch;
  }
}

const QUERY_SQL_ATTRIBUTES = ['value', 'countQuery'] as const;

const QUERY_ANNOTATION_ATTRIBUTES = [
  'countQuery',
  'nativeQuery',
  'flushAutomatically',
  'readOnly',
  'timeout',
  'value',
] as const;

function isQueryAnnotationAttribute(section: string, index: number): boolean {
  for (const attr of QUERY_ANNOTATION_ATTRIBUTES) {
    if (!section.startsWith(attr, index)) {
      continue;
    }
    const next = section[index + attr.length];
    if (next === undefined || /[\s=,)]/.test(next)) {
      return true;
    }
  }
  return false;
}

function skipBalanced(section: string, start: number, open: string, close: string): number {
  let depth = 0;
  let pos = start;
  while (pos < section.length) {
    const ch = section[pos];
    if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return pos + 1;
      }
    }
    pos++;
  }
  return pos;
}

/** Find index after the closing `)` of an annotation, ignoring parens inside string literals. */
function findAnnotationCloseParen(content: string, parenStart: number): number {
  let depth = 1;
  let i = parenStart + 1;

  while (i < content.length && depth > 0) {
    const c = content[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < content.length) {
        if (content[i] === '\\' && i + 1 < content.length) {
          i += 2;
          continue;
        }
        if (content[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (content.startsWith('"""', i)) {
      i += 3;
      const end = content.indexOf('"""', i);
      if (end < 0) {
        return content.length;
      }
      i = end + 3;
      continue;
    }
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
    }
    i++;
  }

  return i;
}

function getQueryAnnotationBody(content: string, queryMatchIndex: number): string | undefined {
  const parenStart = content.indexOf('(', queryMatchIndex);
  if (parenStart < 0) {
    return undefined;
  }
  const closeIndex = findAnnotationCloseParen(content, parenStart);
  return content.substring(parenStart + 1, closeIndex - 1);
}

export function getQueryAnnotationBodyAtLine(content: string, line: number): string | undefined {
  const queryRegex = /@Query\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = queryRegex.exec(content)) !== null) {
    const startLine = content.substring(0, match.index).split('\n').length - 1;
    if (startLine !== line) {
      continue;
    }
    return getQueryAnnotationBody(content, match.index);
  }

  return undefined;
}

export interface JavaConstantResolver {
  resolve(ref: string): string | undefined;
  skippedConstants?: string[];
}

/** Read a Java expression between string concatenation operators. */
export function readJavaConcatExpression(
  section: string,
  index: number
): { expr: string; end: number } | undefined {
  const start = index;
  const end = skipJavaConcatExpression(section, index);
  const expr = section.substring(start, end).trim();
  if (!expr || !isJavaConstantReference(expr)) {
    return undefined;
  }
  return { expr, end };
}

/** Skip a Java expression between string concatenation operators. */
function skipJavaConcatExpression(section: string, index: number): number {
  let pos = index;

  while (pos < section.length) {
    while (pos < section.length && /\s/.test(section[pos])) {
      pos++;
    }
    if (pos >= section.length) {
      break;
    }
    if (section[pos] === '+') {
      return pos;
    }
    if (section.startsWith('"""', pos) || section[pos] === '"' || section[pos] === "'") {
      return pos;
    }
    if (isQueryAnnotationAttribute(section, pos)) {
      return pos;
    }

    const ch = section[pos];
    if (/[A-Za-z_]/.test(ch)) {
      while (pos < section.length && /[\w.]/.test(section[pos])) {
        pos++;
      }
      continue;
    }
    if (ch === '(') {
      pos = skipBalanced(section, pos, '(', ')');
      continue;
    }
    if (ch === ')') {
      return pos;
    }

    pos++;
  }

  return pos;
}

function findSqlSectionEnd(annotationBody: string, sectionStart: number): number {
  const rest = annotationBody.substring(sectionStart);
  let i = 0;
  while (i < rest.length) {
    const attrMatch = rest.substring(i).match(
      /^\b(countQuery|nativeQuery|flushAutomatically|readOnly|timeout)\s*=/
    );
    if (attrMatch && i > 0) {
      return sectionStart + i;
    }

    const c = rest[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < rest.length) {
        if (rest[i] === '\\' && i + 1 < rest.length) {
          i += 2;
          continue;
        }
        if (rest[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (rest.startsWith('"""', i)) {
      i += 3;
      const end = rest.indexOf('"""', i);
      if (end < 0) {
        return annotationBody.length;
      }
      i = end + 3;
      continue;
    }
    i++;
  }
  return annotationBody.length;
}

function collectLiteralSegmentsWithOffsets(
  section: string,
  sectionBaseOffset: number
): QueryLiteralSegment[] {
  const segments: QueryLiteralSegment[] = [];
  let i = 0;

  while (i < section.length) {
    while (i < section.length && /[\s+]/.test(section[i])) {
      i++;
    }
    if (i >= section.length) {
      break;
    }

    if (isQueryAnnotationAttribute(section, i)) {
      break;
    }

    if (section.startsWith('"""', i)) {
      const contentStart = i + 3;
      const end = section.indexOf('"""', contentStart);
      if (end < 0) {
        break;
      }
      const seg: QueryLiteralSegment = { text: '', offsets: [] };
      for (let k = contentStart; k < end; k++) {
        seg.text += section[k];
        seg.offsets.push(sectionBaseOffset + k);
      }
      segments.push(seg);
      i = end + 3;
      continue;
    }

    const quote = section[i];
    if (quote === '"' || quote === "'") {
      const seg: QueryLiteralSegment = { text: '', offsets: [] };
      let j = i + 1;
      while (j < section.length) {
        const c = section[j];
        if (c === '\\' && j + 1 < section.length) {
          seg.text += unescapeJavaChar(section[j + 1]);
          seg.offsets.push(sectionBaseOffset + j);
          j += 2;
          continue;
        }
        if (c === quote) {
          break;
        }
        seg.text += c;
        seg.offsets.push(sectionBaseOffset + j);
        j++;
      }
      segments.push(seg);
      i = j + 1;
      continue;
    }

    i = skipJavaConcatExpression(section, i);
    if (i >= section.length || isQueryAnnotationAttribute(section, i)) {
      break;
    }
  }

  return segments;
}

export function getQueryLiteralSegmentsFromBody(
  annotationBody: string,
  bodyDocumentOffset: number
): QueryLiteralSegment[] {
  const textBlockStart = annotationBody.indexOf('"""');
  if (textBlockStart >= 0) {
    const contentStart = textBlockStart + 3;
    const contentEnd = annotationBody.indexOf('"""', contentStart);
    if (contentEnd >= 0) {
      const seg: QueryLiteralSegment = { text: '', offsets: [] };
      for (let k = contentStart; k < contentEnd; k++) {
        seg.text += annotationBody[k];
        seg.offsets.push(bodyDocumentOffset + k);
      }
      return [seg];
    }
  }

  let sqlSection = annotationBody;
  let sqlSectionOffset = bodyDocumentOffset;
  const segments: QueryLiteralSegment[] = [];

  for (const attr of QUERY_SQL_ATTRIBUTES) {
    const attrMatch = annotationBody.match(new RegExp(`\\b${attr}\\s*=\\s*`));
    if (!attrMatch || attrMatch.index === undefined) {
      continue;
    }

    const sectionStart = attrMatch.index + attrMatch[0].length;
    const sectionEnd = findSqlSectionEnd(annotationBody, sectionStart);
    const section = annotationBody.substring(sectionStart, sectionEnd);
    segments.push(
      ...collectLiteralSegmentsWithOffsets(section, bodyDocumentOffset + sectionStart)
    );
  }

  if (segments.length > 0) {
    return segments;
  }

  const valueMatch = annotationBody.match(/\bvalue\s*=\s*/);
  if (valueMatch && valueMatch.index !== undefined) {
    sqlSection = annotationBody.substring(valueMatch.index + valueMatch[0].length);
    sqlSectionOffset = bodyDocumentOffset + valueMatch.index + valueMatch[0].length;
  } else {
    const trimmed = annotationBody.trim();
    const trimStart = annotationBody.indexOf(trimmed);
    if (trimStart >= 0) {
      sqlSection = trimmed;
      sqlSectionOffset = bodyDocumentOffset + trimStart;
    }
  }

  return collectLiteralSegmentsWithOffsets(sqlSection, sqlSectionOffset);
}

export function parseQueryLiteralSegments(content: string): Array<{
  nativeQuery: boolean;
  segments: QueryLiteralSegment[];
}> {
  const results: Array<{ nativeQuery: boolean; segments: QueryLiteralSegment[] }> = [];
  const queryRegex = /@Query\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = queryRegex.exec(content)) !== null) {
    const parenStart = content.indexOf('(', match.index);
    if (parenStart < 0) {
      continue;
    }

    const closeIndex = findAnnotationCloseParen(content, parenStart);
    const annotationBody = content.substring(parenStart + 1, closeIndex - 1);
    const nativeQuery = /nativeQuery\s*=\s*true/.test(annotationBody);
    const segments = getQueryLiteralSegmentsFromBody(annotationBody, parenStart + 1);

    if (segments.length > 0) {
      results.push({ nativeQuery, segments });
    }
  }

  return results;
}

function extractInitializerUntilSemicolon(content: string, start: number): string | undefined {
  let parenDepth = 0;
  let i = start;

  while (i < content.length) {
    const c = content[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < content.length) {
        if (content[i] === '\\' && i + 1 < content.length) {
          i += 2;
          continue;
        }
        if (content[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (content.startsWith('"""', i)) {
      const end = content.indexOf('"""', i + 3);
      if (end < 0) {
        return undefined;
      }
      i = end + 3;
      continue;
    }
    if (c === '(') {
      parenDepth++;
      i++;
      continue;
    }
    if (c === ')') {
      parenDepth--;
      i++;
      continue;
    }
    if (c === ';' && parenDepth === 0) {
      return content.substring(start, i).trim();
    }
    i++;
  }

  return undefined;
}

function hasStringConcatenation(expr: string): boolean {
  let i = 0;
  while (i < expr.length) {
    if (expr.startsWith('"""', i)) {
      i += 3;
      const end = expr.indexOf('"""', i);
      if (end < 0) {
        return false;
      }
      i = end + 3;
      continue;
    }
    const c = expr[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < expr.length) {
        if (expr[i] === '\\' && i + 1 < expr.length) {
          i += 2;
          continue;
        }
        if (expr[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '+') {
      return true;
    }
    i++;
  }
  return false;
}

function looksLikeUnevaluatedJavaConcat(value: string): boolean {
  return /["']\s*\+\s*["']/.test(value) || (hasStringConcatenation(value) && /^\s*["']/.test(value));
}

/** Merge only quoted Java string-literal concatenation (`"a" + "b"`). */
export function mergeQuotedJavaConcat(value: string): string {
  let result = value;
  while (/["']\s*\+\s*["']/.test(result)) {
    result = result.replace(/"\s*\+\s*"/g, ' ').replace(/'\s*\+\s*'/g, ' ');
  }
  return result.replace(/\s+/g, ' ').trim();
}

/** @deprecated Use mergeQuotedJavaConcat; kept for tests. */
export function stripJavaConcatArtifacts(sql: string): string {
  return mergeQuotedJavaConcat(sql);
}

export function resolveJavaStringExpression(
  expr: string,
  resolver?: JavaConstantResolver,
  localConstants: Map<string, string> = new Map()
): string | undefined {
  const trimmed = expr.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!looksLikeUnevaluatedJavaConcat(trimmed)) {
    return trimmed;
  }

  const direct = evaluateStringInitializer(trimmed, localConstants, resolver);
  if (direct !== undefined) {
    return direct;
  }

  const quoteIdx = trimmed.search(/["']/);
  if (quoteIdx >= 0) {
    const fromQuote = evaluateStringInitializer(trimmed.substring(quoteIdx), localConstants, resolver);
    if (fromQuote !== undefined) {
      return fromQuote;
    }
  }

  const mergedQuotes = mergeQuotedJavaConcat(trimmed);
  if (mergedQuotes !== trimmed && !looksLikeUnevaluatedJavaConcat(mergedQuotes)) {
    return mergedQuotes;
  }

  return undefined;
}

function deepResolveConstantValue(value: string, resolver?: JavaConstantResolver): string {
  const resolved = resolveJavaStringExpression(value, resolver);
  return resolved ?? value;
}

export { deepResolveConstantValue };

function evaluateStringInitializer(
  initializer: string,
  constants: Map<string, string>,
  externalResolver?: JavaConstantResolver
): string | undefined {
  const trimmed = initializer.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith('"""')) {
    const end = trimmed.indexOf('"""', 3);
    if (end >= 0 && !hasStringConcatenation(trimmed.substring(end + 3))) {
      return normalizeConcatSegment(trimmed.substring(3, end));
    }
  }

  const quote = trimmed[0];
  if (
    (quote === '"' || quote === "'") &&
    trimmed.endsWith(quote) &&
    trimmed.length >= 2 &&
    !hasStringConcatenation(trimmed)
  ) {
    return unescapeJavaString(trimmed.slice(1, -1));
  }

  const localResolver: JavaConstantResolver = {
    resolve(ref: string) {
      const simple = ref.includes('.') ? ref.substring(ref.lastIndexOf('.') + 1) : ref;
      const fromLocal = constants.get(simple.toLowerCase());
      if (fromLocal !== undefined) {
        return fromLocal;
      }
      return externalResolver?.resolve(ref);
    },
  };

  const segments = collectConcatenatedLiterals(trimmed, localResolver);
  if (segments.length === 0) {
    return undefined;
  }
  return joinSqlSegments(segments);
}

const STRING_FIELD_REGEX =
  /(?:public\s+|protected\s+|private\s+)?(?:static\s+)?(?:final\s+)?String\s+(\w+)\s*=\s*/g;

export function parseStringConstantsFromSource(content: string): Map<string, string> {
  const constants = new Map<string, string>();
  let match: RegExpExecArray | null;

  while ((match = STRING_FIELD_REGEX.exec(content)) !== null) {
    const name = match[1];
    const initStart = match.index + match[0].length;
    const initializer = extractInitializerUntilSemicolon(content, initStart);
    if (!initializer) {
      continue;
    }

    const value = evaluateStringInitializer(initializer, constants);
    if (value !== undefined) {
      constants.set(name.toLowerCase(), value);
    }
  }

  return constants;
}

export function parseTypeNameFromSource(content: string): string | undefined {
  const classMatch = content.match(CLASS_DECL_REGEX);
  if (classMatch) {
    return classMatch[1];
  }

  const interfaceMatch = content.match(/(?:public\s+)?interface\s+(\w+)/);
  if (interfaceMatch) {
    return interfaceMatch[1];
  }

  return undefined;
}

export function parsePackageFromSource(content: string): string | undefined {
  const packageMatch = content.match(/^\s*package\s+([\w.]+)\s*;/m);
  return packageMatch?.[1];
}

export function isJavaConstantReference(expr: string): boolean {
  return /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*$/.test(expr.trim());
}

function collectConcatenatedLiterals(section: string, resolver?: JavaConstantResolver): string[] {
  const segments: string[] = [];
  let i = 0;

  while (i < section.length) {
    while (i < section.length && /[\s+]/.test(section[i])) {
      i++;
    }
    if (i >= section.length) {
      break;
    }

    if (isQueryAnnotationAttribute(section, i)) {
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

    const exprRead = readJavaConcatExpression(section, i);
    if (exprRead) {
      const value = resolver?.resolve(exprRead.expr);
      if (value !== undefined) {
        segments.push(deepResolveConstantValue(value, resolver));
      }
      i = exprRead.end;
      if (i >= section.length || isQueryAnnotationAttribute(section, i)) {
        break;
      }
      continue;
    }

    i = skipJavaConcatExpression(section, i);
    if (i >= section.length || isQueryAnnotationAttribute(section, i)) {
      break;
    }
  }

  return segments;
}

export function extractQuerySql(annotationBody: string, resolver?: JavaConstantResolver): string {
  const textBlockMatch = annotationBody.match(/"""([\s\S]*?)"""/);
  if (textBlockMatch) {
    return textBlockMatch[1].trim();
  }

  let sqlSection = annotationBody.trim();
  const valueMatch = annotationBody.match(/\bvalue\s*=\s*/);
  if (valueMatch && valueMatch.index !== undefined) {
    const sectionStart = valueMatch.index + valueMatch[0].length;
    sqlSection = annotationBody.substring(sectionStart, findSqlSectionEnd(annotationBody, sectionStart));
  }

  const segments = collectConcatenatedLiterals(sqlSection, resolver);
  if (segments.length > 0) {
    return joinSqlSegments(segments);
  }

  const singleMatch = annotationBody.match(/^"((?:\\.|[^"\\])*)"/s);
  if (singleMatch) {
    return unescapeJavaString(singleMatch[1]).trim();
  }

  return '';
}

export interface ParsedImport {
  fqn: string;
  simpleName: string;
  isStatic: boolean;
  isWildcard: boolean;
  staticMember?: string;
}

export function parseImportsDetailed(content: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const importRegex = /^\s*import\s+(static\s+)?([\w.]+)(\.\*)?\s*;/gm;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(content)) !== null) {
    const isStatic = Boolean(match[1]);
    const fqn = match[2];
    const isWildcard = Boolean(match[3]);
    const parts = fqn.split('.');

    if (isStatic && !isWildcard && parts.length > 1) {
      const staticMember = parts.pop()!;
      const classFqn = parts.join('.');
      const simpleName = parts[parts.length - 1];
      imports.push({
        fqn: classFqn,
        simpleName,
        isStatic: true,
        isWildcard: false,
        staticMember,
      });
      continue;
    }

    const simpleName = parts[parts.length - 1];
    imports.push({
      fqn,
      simpleName,
      isStatic,
      isWildcard,
    });
  }

  return imports;
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

  const closeIndex = findAnnotationCloseParen(content, parenStart);
  if (atIndex > closeIndex) {
    return undefined;
  }

  return content.substring(parenStart + 1, closeIndex - 1);
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

export function parseQueriesFromSource(content: string, resolver?: JavaConstantResolver): ParsedQuery[] {
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

    const closeIndex = findAnnotationCloseParen(content, parenStart);
    const annotationBody = content.substring(parenStart + 1, closeIndex - 1);
    const nativeQuery = /nativeQuery\s*=\s*true/.test(annotationBody);
    const sql = extractQuerySql(annotationBody, resolver);

    if (!sql) {
      continue;
    }

    const endLine = content.substring(0, closeIndex).split('\n').length - 1;
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

  if (!extractStringLiteralAt(annotationBody, relativePos)) {
    return false;
  }

  for (const attr of QUERY_SQL_ATTRIBUTES) {
    const attrMatch = annotationBody.match(new RegExp(`\\b${attr}\\s*=\\s*`));
    if (!attrMatch || attrMatch.index === undefined) {
      continue;
    }
    const sectionStart = attrMatch.index + attrMatch[0].length;
    const sectionEnd = findSqlSectionEnd(annotationBody, sectionStart);
    if (relativePos >= sectionStart && relativePos < sectionEnd) {
      return true;
    }
  }

  if (!annotationBody.match(/\bvalue\s*=/)) {
    const trimmed = annotationBody.trim();
    const trimStart = annotationBody.indexOf(trimmed);
    if (trimStart >= 0 && relativePos >= trimStart) {
      const nativeIdx = annotationBody.search(/\bnativeQuery\s*=/);
      const sectionEnd = nativeIdx >= 0 ? nativeIdx : annotationBody.length;
      return relativePos < sectionEnd;
    }
  }

  return false;
}

export function isInsideQueryString(content: string, position: number): ParsedQuery | undefined {
  const queryRegex = /@Query\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = queryRegex.exec(content)) !== null) {
    const parenStart = content.indexOf('(', match.index);
    if (parenStart < 0) {
      continue;
    }

    const closeIndex = findAnnotationCloseParen(content, parenStart);
    if (position < match.index || position > closeIndex) {
      continue;
    }

    const annotationBody = content.substring(parenStart + 1, closeIndex - 1);
    const relativePos = position - parenStart - 1;

    if (!isInsideQueryValueSection(annotationBody, relativePos)) {
      continue;
    }

    const nativeQuery = /nativeQuery\s*=\s*true/.test(annotationBody);
    const startLine = content.substring(0, match.index).split('\n').length - 1;
    const endLine = content.substring(0, closeIndex).split('\n').length - 1;
    const sql = extractQuerySql(annotationBody);
    const { namedParams, positionalParams } = extractQueryParams(sql);

    return { sql, nativeQuery, startLine, endLine, namedParams, positionalParams };
  }

  return undefined;
}

export function parseImportsFromSource(content: string): Map<string, string> {
  const imports = new Map<string, string>();
  const importRegex = /^\s*import\s+(?:static\s+)?([\w.]+)(?:\.\*)?\s*;/gm;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(content)) !== null) {
    const fqn = match[1];
    const simpleName = fqn.split('.').pop();
    if (simpleName) {
      imports.set(simpleName, fqn);
    }
  }

  return imports;
}

export function getCamelCaseSegmentAt(content: string, offset: number): string | undefined {
  if (offset < 0 || offset >= content.length) {
    return undefined;
  }

  const ch = content[offset];
  if (!/[A-Za-z_]/.test(ch)) {
    return undefined;
  }

  let start = offset;
  while (start > 0 && /[\w]/.test(content[start - 1])) {
    start--;
  }

  let end = offset;
  while (end < content.length && /[\w]/.test(content[end])) {
    end++;
  }

  const identifier = content.substring(start, end);
  const relativeOffset = offset - start;

  const segments: Array<{ text: string; start: number; end: number }> = [];
  const segmentRegex = /[A-Z][a-z0-9]*|[a-z0-9]+/g;
  let segmentMatch: RegExpExecArray | null;

  while ((segmentMatch = segmentRegex.exec(identifier)) !== null) {
    segments.push({
      text: segmentMatch[0],
      start: segmentMatch.index,
      end: segmentMatch.index + segmentMatch[0].length,
    });
  }

  for (const segment of segments) {
    if (relativeOffset >= segment.start && relativeOffset < segment.end) {
      return segment.text;
    }
  }

  return undefined;
}
