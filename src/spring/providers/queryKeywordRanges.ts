import * as vscode from 'vscode';
import { parseQueryLiteralSegments, QueryLiteralSegment } from '../parsing/javaAnnotations';
import {
  JPQL_FUNCTION_SET,
  JPQL_KEYWORD_SET,
  SQL_FUNCTION_SET,
  SQL_KEYWORD_SET,
} from '../parsing/queryKeywords';

const WORD_REGEX = /\b[A-Za-z_][\w]*\b/g;

/** CTE definitions: WITH [RECURSIVE] name AS (  or  , name AS ( */
const CTE_DEFINITION_REGEX =
  /(?:\bWITH\s+(?:RECURSIVE\s+)?|,)\s*([A-Za-z_][\w]*)\s+(?:AS|as)\s*\(/g;

export interface QuerySyntaxRanges {
  keywords: vscode.Range[];
  functions: vscode.Range[];
  ctes: vscode.Range[];
}

function isFunctionCall(segment: QueryLiteralSegment, wordStart: number, wordLength: number): boolean {
  const after = segment.text.substring(wordStart + wordLength);
  return /^\s*\(/.test(after);
}

function toRange(
  document: vscode.TextDocument,
  segment: QueryLiteralSegment,
  startIndex: number,
  wordLength: number
): vscode.Range | undefined {
  const endIndex = startIndex + wordLength - 1;
  if (endIndex >= segment.offsets.length) {
    return undefined;
  }

  const startOffset = segment.offsets[startIndex];
  const endOffset = segment.offsets[endIndex] + 1;
  return new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset));
}

function collectCteNames(segments: QueryLiteralSegment[]): Set<string> {
  const merged = segments.map((s) => s.text).join(' ');
  const names = new Set<string>();

  let match: RegExpExecArray | null;
  CTE_DEFINITION_REGEX.lastIndex = 0;
  while ((match = CTE_DEFINITION_REGEX.exec(merged)) !== null) {
    names.add(match[1].toLowerCase());
  }

  return names;
}

function collectSyntaxRangesForQuery(
  document: vscode.TextDocument,
  segments: QueryLiteralSegment[],
  keywordSet: Set<string>,
  functionSet: Set<string>,
  includeCtes: boolean
): QuerySyntaxRanges {
  const keywords: vscode.Range[] = [];
  const functions: vscode.Range[] = [];
  const ctes: vscode.Range[] = [];
  const cteNames = includeCtes ? collectCteNames(segments) : new Set<string>();

  for (const segment of segments) {
    if (!segment.text) {
      continue;
    }

    let match: RegExpExecArray | null;
    WORD_REGEX.lastIndex = 0;
    while ((match = WORD_REGEX.exec(segment.text)) !== null) {
      const word = match[0];
      const upper = word.toUpperCase();
      const range = toRange(document, segment, match.index, match[0].length);
      if (!range) {
        continue;
      }

      const isCall = isFunctionCall(segment, match.index, match[0].length);
      if (isCall && functionSet.has(upper)) {
        functions.push(range);
      } else if (keywordSet.has(upper)) {
        keywords.push(range);
      } else if (cteNames.has(word.toLowerCase())) {
        ctes.push(range);
      }
    }
  }

  return { keywords, functions, ctes };
}

export function collectQuerySyntaxRanges(document: vscode.TextDocument): QuerySyntaxRanges {
  const keywords: vscode.Range[] = [];
  const functions: vscode.Range[] = [];
  const ctes: vscode.Range[] = [];

  if (document.languageId !== 'java') {
    return { keywords, functions, ctes };
  }

  const content = document.getText();
  if (!content.includes('@Query')) {
    return { keywords, functions, ctes };
  }

  for (const query of parseQueryLiteralSegments(content)) {
    const keywordSet = query.nativeQuery ? SQL_KEYWORD_SET : JPQL_KEYWORD_SET;
    const functionSet = query.nativeQuery ? SQL_FUNCTION_SET : JPQL_FUNCTION_SET;
    const ranges = collectSyntaxRangesForQuery(
      document,
      query.segments,
      keywordSet,
      functionSet,
      query.nativeQuery
    );
    keywords.push(...ranges.keywords);
    functions.push(...ranges.functions);
    ctes.push(...ranges.ctes);
  }

  return { keywords, functions, ctes };
}

/** @deprecated Use collectQuerySyntaxRanges */
export function collectQueryKeywordRanges(document: vscode.TextDocument): vscode.Range[] {
  return collectQuerySyntaxRanges(document).keywords;
}
