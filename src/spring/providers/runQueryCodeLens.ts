import * as vscode from 'vscode';
import { parseQueriesFromSource } from '../parsing/javaAnnotations';
import { translateJpqlToSql, JpqlTranslationError } from '../parsing/jpqlToSql';
import { SqlDialect } from '../parsing/jpqlFunctions';
import { getEntityIndex } from '../index/entityIndex';
import { readSpringDatasource } from '../parsing/springConfig';
import { resolveSpringConnection } from '../springConnection';
import { promptQueryParameters, substituteQueryParameters } from '../queryParams';
import { log, runQueryString } from '../../runner';

const codeLensCache = new Map<string, vscode.CodeLens[]>();

function getCodeLensCacheKey(document: vscode.TextDocument): string {
  return `${document.uri.toString()}#${document.version}`;
}

export function inferSqlDialect(jdbcUrl?: string): SqlDialect {
  if (!jdbcUrl) {
    return 'generic';
  }
  const lower = jdbcUrl.toLowerCase();
  if (lower.includes('postgresql') || lower.includes('postgres')) {
    return 'postgres';
  }
  if (lower.includes('mysql') || lower.includes('mariadb')) {
    return 'mysql';
  }
  return 'generic';
}

function isTranslationError(result: ReturnType<typeof translateJpqlToSql>): result is JpqlTranslationError {
  return 'message' in result && !('sql' in result);
}

async function resolveSqlForQuery(
  query: ReturnType<typeof parseQueriesFromSource>[number],
  workspaceFolder?: vscode.WorkspaceFolder
): Promise<string | undefined> {
  if (query.nativeQuery) {
    return query.sql;
  }

  const datasource = await readSpringDatasource(workspaceFolder);
  const dialect = inferSqlDialect(datasource?.url);
  const result = translateJpqlToSql(query.sql, getEntityIndex(), { dialect });

  if (isTranslationError(result)) {
    vscode.window.showErrorMessage(result.message);
    return undefined;
  }

  if (result.warnings.length > 0) {
    vscode.window.showWarningMessage(`JPQL translated with warnings: ${result.warnings.join('; ')}`);
  }

  log(`JPQL:\n${query.sql}`);
  log(`Translated SQL:\n${result.sql}`);
  return result.sql;
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
          title: query.nativeQuery ? '▶ Run Query (native SQL)' : '▶ Run Query (JPQL → SQL)',
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

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const sql = await resolveSqlForQuery(query, workspaceFolder);

  if (!sql) {
    if (!query.nativeQuery) {
      await vscode.env.clipboard.writeText(query.sql);
      vscode.window.showInformationMessage('Translation failed; raw JPQL copied to clipboard.');
    }
    return;
  }

  await vscode.env.clipboard.writeText(sql);
  vscode.window.showInformationMessage(
    query.nativeQuery ? 'SQL copied to clipboard.' : 'Translated SQL copied to clipboard.'
  );
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

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
  const sql = await resolveSqlForQuery(query, workspaceFolder);
  if (!sql) {
    return;
  }

  const params = await promptQueryParameters(query);
  if (params === undefined) {
    return;
  }

  const finalSql = substituteQueryParameters(sql, params);
  const connId = await resolveSpringConnection(workspaceFolder);

  if (!connId) {
    return;
  }

  const label = query.nativeQuery
    ? `@Query at ${uri.fsPath}:${line + 1}`
    : `@Query (JPQL→SQL) at ${uri.fsPath}:${line + 1}`;
  await runQueryString(finalSql, connId, label);
}
