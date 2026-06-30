import * as vscode from 'vscode';
import { parseQueryLiteralSegments } from '../parsing/javaAnnotations';
import { JPQL_KEYWORD_SET, SQL_KEYWORD_SET } from '../parsing/queryKeywords';

const WORD_REGEX = /\b[A-Za-z_][\w]*\b/g;

export function collectQueryKeywordRanges(document: vscode.TextDocument): vscode.Range[] {
  const ranges: vscode.Range[] = [];

  if (document.languageId !== 'java') {
    return ranges;
  }

  const content = document.getText();
  if (!content.includes('@Query')) {
    return ranges;
  }

  for (const query of parseQueryLiteralSegments(content)) {
    const keywordSet = query.nativeQuery ? SQL_KEYWORD_SET : JPQL_KEYWORD_SET;

    for (const segment of query.segments) {
      if (!segment.text) {
        continue;
      }

      let match: RegExpExecArray | null;
      WORD_REGEX.lastIndex = 0;
      while ((match = WORD_REGEX.exec(segment.text)) !== null) {
        const word = match[0].toUpperCase();
        if (!keywordSet.has(word)) {
          continue;
        }

        const startIndex = match.index;
        const endIndex = startIndex + match[0].length - 1;
        if (endIndex >= segment.offsets.length) {
          continue;
        }

        const startOffset = segment.offsets[startIndex];
        const endOffset = segment.offsets[endIndex] + 1;
        ranges.push(new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset)));
      }
    }
  }

  return ranges;
}
