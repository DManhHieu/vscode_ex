import * as vscode from 'vscode';
import { getEntityIndex } from '../index/entityIndex';
import { isInsideQueryString } from '../parsing/javaAnnotations';
import { JPQL_KEYWORDS, SQL_KEYWORDS } from '../parsing/queryKeywords';

function getWordPrefix(document: vscode.TextDocument, position: vscode.Position): string {
  const line = document.lineAt(position.line).text;
  const before = line.substring(0, position.character);
  const match = before.match(/[\w.]*$/);
  return match?.[0] ?? '';
}

export class QueryCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.CompletionItem[] {
    if (document.languageId !== 'java') {
      return [];
    }

    const content = document.getText();
    if (!content.includes('@Query')) {
      return [];
    }

    const offset = document.offsetAt(position);
    const query = isInsideQueryString(content, offset);

    if (!query) {
      return [];
    }

    const prefix = getWordPrefix(document, position);
    const items: vscode.CompletionItem[] = [];
    const index = getEntityIndex();

    if (query.nativeQuery) {
      for (const entity of index.getAllEntities()) {
        if (!prefix || entity.tableName.toLowerCase().startsWith(prefix.toLowerCase())) {
          items.push(new vscode.CompletionItem(entity.tableName, vscode.CompletionItemKind.Class));
        }
        for (const field of entity.fields) {
          if (!prefix || field.columnName.toLowerCase().startsWith(prefix.toLowerCase())) {
            const item = new vscode.CompletionItem(field.columnName, vscode.CompletionItemKind.Field);
            item.detail = `${entity.tableName}.${field.name}`;
            items.push(item);
          }
        }
      }

      for (const kw of SQL_KEYWORDS) {
        if (!prefix || kw.toLowerCase().startsWith(prefix.toLowerCase())) {
          items.push(new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword));
        }
      }
    } else {
      for (const entity of index.getAllEntities()) {
        if (!prefix || entity.className.toLowerCase().startsWith(prefix.toLowerCase()) ||
            entity.entityName.toLowerCase().startsWith(prefix.toLowerCase())) {
          items.push(new vscode.CompletionItem(entity.className, vscode.CompletionItemKind.Class));
        }
        for (const field of entity.fields) {
          const fieldRef = `${entity.className.toLowerCase().charAt(0)}.${field.name}`;
          if (!prefix || field.name.toLowerCase().startsWith(prefix.toLowerCase()) ||
              fieldRef.toLowerCase().startsWith(prefix.toLowerCase())) {
            const item = new vscode.CompletionItem(field.name, vscode.CompletionItemKind.Field);
            item.detail = entity.className;
            items.push(item);
          }
        }
      }

      for (const kw of JPQL_KEYWORDS) {
        if (!prefix || kw.toLowerCase().startsWith(prefix.toLowerCase())) {
          items.push(new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword));
        }
      }
    }

    return items;
  }
}
