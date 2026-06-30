import * as vscode from 'vscode';
import { parseQueryLiteralSegments, QueryLiteralSegment } from '../parsing/javaAnnotations';
import {
  JPQL_FUNCTION_SET,
  JPQL_KEYWORD_SET,
  SQL_FUNCTION_SET,
  SQL_KEYWORD_SET,
} from '../parsing/queryKeywords';

const WORD_REGEX = /\b[A-Za-z_][\w]*\b/g;

export interface QuerySyntaxRanges {
  keywords: vscode.Range[];
  functions: vscode.Range[];
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

export function collectQuerySyntaxRanges(document: vscode.TextDocument): QuerySyntaxRanges {
  const keywords: vscode.Range[] = [];
  const functions: vscode.Range[] = [];

  if (document.languageId !== 'java') {
    return { keywords, functions };
  }

  const content = document.getText();
  if (!content.includes('@Query')) {
    return { keywords, functions };
  }

  for (const query of parseQueryLiteralSegments(content)) {
    const keywordSet = query.nativeQuery ? SQL_KEYWORD_SET : JPQL_KEYWORD_SET;
    const functionSet = query.nativeQuery ? SQL_FUNCTION_SET : JPQL_FUNCTION_SET;

    for (const segment of query.segments) {
      if (!segment.text) {
        continue;
      }

      let match: RegExpExecArray | null;
      WORD_REGEX.lastIndex = 0;
      while ((match = WORD_REGEX.exec(segment.text)) !== null) {
        const word = match[0].toUpperCase();
        const range = toRange(document, segment, match.index, match[0].length);
        if (!range) {
          continue;
        }

        const isCall = isFunctionCall(segment, match.index, match[0].length);
        if (isCall && functionSet.has(word)) {
          functions.push(range);
        } else if (keywordSet.has(word)) {
          keywords.push(range);
        }
      }
    }
  }

  return { keywords, functions };
}

/** @deprecated Use collectQuerySyntaxRanges */
export function collectQueryKeywordRanges(document: vscode.TextDocument): vscode.Range[] {
  return collectQuerySyntaxRanges(document).keywords;
}
