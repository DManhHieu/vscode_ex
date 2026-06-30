import * as vscode from 'vscode';
import { collectQueryKeywordRanges } from './queryKeywordRanges';

export const QUERY_TOKEN_LEGEND = new vscode.SemanticTokensLegend(['sqlKeyword'], []);

const KEYWORD_TOKEN_TYPE = 0;

export class QuerySemanticTokensProvider implements vscode.DocumentSemanticTokensProvider {
  provideDocumentSemanticTokens(document: vscode.TextDocument): vscode.SemanticTokens {
    const builder = new vscode.SemanticTokensBuilder(QUERY_TOKEN_LEGEND);

    for (const range of collectQueryKeywordRanges(document)) {
      if (range.start.line !== range.end.line) {
        continue;
      }

      const length = range.end.character - range.start.character;
      if (length <= 0) {
        continue;
      }

      builder.push(range.start.line, range.start.character, length, KEYWORD_TOKEN_TYPE, 0);
    }

    return builder.build();
  }
}
