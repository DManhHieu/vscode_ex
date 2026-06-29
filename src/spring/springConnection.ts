import * as vscode from 'vscode';
import { getSqlToolsConnections, pickSqlToolsConnection, SqlToolsConnection } from '../connection';
import { normalizeJdbcUrl, readSpringDatasource } from './parsing/springConfig';

function getConnectionMappings(): Record<string, string> {
  return vscode.workspace.getConfiguration('excuteSql.spring').get<Record<string, string>>('connectionMappings') ?? {};
}

function extractUrlFromConnection(conn: SqlToolsConnection & Record<string, unknown>): string | undefined {
  const candidates = [
    conn['connectionId'],
    (conn as { previewLimit?: unknown }).previewLimit,
  ];

  const connRecord = conn as Record<string, unknown>;
  for (const key of ['connectString', 'connectionString', 'server', 'host', 'database', 'url', 'jdbcUrl']) {
    const val = connRecord[key];
    if (typeof val === 'string' && val.length > 0) {
      candidates.push(val);
    }
  }

  const connStr = connRecord['conn'] as Record<string, unknown> | undefined;
  if (connStr) {
    for (const key of ['connectString', 'server', 'host', 'database', 'url']) {
      const val = connStr[key];
      if (typeof val === 'string') {
        candidates.push(val);
      }
    }
  }

  for (const c of candidates) {
    if (typeof c === 'string' && (c.includes('://') || c.includes('jdbc'))) {
      return c;
    }
  }

  return undefined;
}

function scoreConnectionMatch(
  conn: SqlToolsConnection & Record<string, unknown>,
  normalizedTarget: string,
  datasource: { url?: string; username?: string }
): number {
  let score = 0;
  const connUrl = extractUrlFromConnection(conn);
  if (connUrl) {
    const normalizedConn = normalizeJdbcUrl(connUrl);
    if (normalizedConn === normalizedTarget) {
      score += 100;
    } else if (normalizedConn.includes(normalizedTarget) || normalizedTarget.includes(normalizedConn)) {
      score += 50;
    }
  }

  const mappings = getConnectionMappings();
  if (datasource.url && mappings[datasource.url] === conn.name) {
    score += 200;
  }

  const connName = conn.name.toLowerCase();
  if (datasource.url) {
    const dbPart = datasource.url.split('/').pop()?.split('?')[0]?.toLowerCase();
    if (dbPart && connName.includes(dbPart)) {
      score += 30;
    }
  }

  if (datasource.username) {
    const connRecord = conn as Record<string, unknown>;
    const connUser = connRecord['username'] ?? (connRecord['conn'] as Record<string, unknown> | undefined)?.['username'];
    if (typeof connUser === 'string' && connUser.toLowerCase() === datasource.username.toLowerCase()) {
      score += 20;
    }
  }

  if (conn.isConnected) {
    score += 5;
  }

  return score;
}

export async function resolveSpringConnection(
  workspaceFolder?: vscode.WorkspaceFolder
): Promise<string | undefined> {
  const autoPick = vscode.workspace.getConfiguration('excuteSql.spring').get<boolean>('autoPickDatasource') ?? true;

  const datasource = await readSpringDatasource(workspaceFolder);
  const connections = await getSqlToolsConnections();

  if (connections.length === 0) {
    vscode.window.showErrorMessage(
      'No SQLTools connections found. Add a connection in the SQLTools sidebar first.'
    );
    return undefined;
  }

  if (autoPick && datasource?.url) {
    const normalizedTarget = normalizeJdbcUrl(datasource.url);
    let bestConn: SqlToolsConnection | undefined;
    let bestScore = 0;

    for (const conn of connections) {
      const score = scoreConnectionMatch(conn as SqlToolsConnection & Record<string, unknown>, normalizedTarget, datasource);
      if (score > bestScore) {
        bestScore = score;
        bestConn = conn;
      }
    }

    if (bestConn && bestScore >= 30) {
      return bestConn.id ?? bestConn.name;
    }
  }

  return pickSqlToolsConnection();
}

export async function resolveConnection(preferSpring = true): Promise<string | undefined> {
  if (preferSpring) {
    const springConn = await resolveSpringConnection();
    if (springConn) {
      return springConn;
    }
  }
  return pickSqlToolsConnection();
}
