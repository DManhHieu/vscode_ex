import * as vscode from 'vscode';
import { collectQuerySyntaxRanges } from './queryKeywordRanges';

export const QUERY_TOKEN_LEGEND = new vscode.SemanticTokensLegend(['sqlKeyword', 'sqlFunction'], []);

const KEYWORD_TOKEN_TYPE = 0;
const FUNCTION_TOKEN_TYPE = 1;

function pushRange(
  builder: vscode.SemanticTokensBuilder,
  range: vscode.Range,
  tokenType: number
): void {
  if (range.start.line !== range.end.line) {
    return;
  }

  const length = range.end.character - range.start.character;
  if (length <= 0) {
    return;
  }

  builder.push(range.start.line, range.start.character, length, tokenType, 0);
}

export class QuerySemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(QUERY_TOKEN_LEGEND);
    const { keywords, functions } = collectQuerySyntaxRanges(document);

    for (const range of keywords) {
      pushRange(builder, range, KEYWORD_TOKEN_TYPE);
    }
    for (const range of functions) {
      pushRange(builder, range, FUNCTION_TOKEN_TYPE);
    }

    return builder.build();
  }
}
