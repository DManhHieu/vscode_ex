import * as vscode from 'vscode';
import { parseQueriesFromSource } from '../parsing/javaAnnotations';
import { resolveSpringConnection } from '../springConnection';
import { promptQueryParameters, substituteQueryParameters } from '../queryParams';
import { runQueryString } from '../../runner';

const codeLensCache = new Map<string, vscode.CodeLens[]>();

function getCodeLensCacheKey(document: vscode.TextDocument): string {
  return `${document.uri.toString()}#${document.version}`;
}

export class RunQueryCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== 'java' || !document.getText().includes('@Query')) {
      return [];
    }

    const cacheKey = getCodeLensCacheKey(document);
    const cached = codeLensCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const content = document.getText();
    const queries = parseQueriesFromSource(content);
    const lenses: vscode.CodeLens[] = [];

    for (const query of queries) {
      const range = new vscode.Range(query.startLine, 0, query.startLine, 0);
      lenses.push(
        new vscode.CodeLens(range, {
          title: query.nativeQuery ? '▶ Run Query (native SQL)' : '▶ Run Query (JPQL — view only)',
          command: 'excuteSql.runSpringQuery',
          arguments: [document.uri, query.startLine],
        }),
        new vscode.CodeLens(range, {
          title: 'Copy SQL',
          command: 'excuteSql.copySpringQuery',
          arguments: [document.uri, query.startLine],
        })
      );
    }

    codeLensCache.set(cacheKey, lenses);
    if (codeLensCache.size > 50) {
      const oldest = codeLensCache.keys().next().value;
      if (oldest) {
        codeLensCache.delete(oldest);
      }
    }

    return lenses;
  }
}

export async function copySpringQueryAtLine(uri: vscode.Uri, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const content = document.getText();
  const queries = parseQueriesFromSource(content);
  const query = queries.find((q) => q.startLine === line);

  if (!query) {
    vscode.window.showWarningMessage('No @Query annotation found at this location.');
    return;
  }

  await vscode.env.clipboard.writeText(query.sql);
  vscode.window.showInformationMessage('SQL copied to clipboard.');
}

export async function runSpringQueryAtLine(uri: vscode.Uri, line: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const content = document.getText();
  const queries = parseQueriesFromSource(content);
  const query = queries.find((q) => q.startLine === line);

  if (!query) {
    vscode.window.showWarningMessage('No @Query annotation found at this location.');
    return;
  }

  if (!query.nativeQuery) {
    vscode.window.showInformationMessage(
      'JPQL execution is not supported in v1. Set nativeQuery = true to run SQL via SQLTools.'
    );
    return;
  }

  const params = await promptQueryParameters(query);
  if (params === undefined) {
    return;
  }

  const sql = substituteQueryParameters(query.sql, params);
  const connId = await resolveSpringConnection(
    vscode.workspace.getWorkspaceFolder(uri)
  );

  if (!connId) {
    return;
  }

  await runQueryString(sql, connId, `@Query at ${uri.fsPath}:${line + 1}`);
}
