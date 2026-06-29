import * as vscode from 'vscode';

const SQLTOOLS_EXTENSION_ID = 'mtxr.sqltools';

export interface SqlToolsConnection {
  id?: string;
  name: string;
  isConnected?: boolean;
}

export function isSqlToolsAvailable(): boolean {
  return vscode.extensions.getExtension(SQLTOOLS_EXTENSION_ID)?.isActive ?? false;
}

export async function ensureSqlToolsActive(): Promise<void> {
  const extension = vscode.extensions.getExtension(SQLTOOLS_EXTENSION_ID);
  if (!extension) {
    throw new Error(
      'SQLTools extension (mtxr.sqltools) is not installed. Install SQLTools and a database driver first.'
    );
  }

  if (!extension.isActive) {
    await extension.activate();
  }
}

export async function getSqlToolsConnections(): Promise<SqlToolsConnection[]> {
  await ensureSqlToolsActive();

  const connections = await vscode.commands.executeCommand<SqlToolsConnection[]>(
    'sqltools.getConnections',
    { connectedOnly: false, sort: 'connectedFirst' }
  );

  return connections ?? [];
}

export async function resolveConnectionId(preferSpring = true): Promise<string | undefined> {
  if (preferSpring) {
    try {
      const { resolveSpringConnection } = await import('./spring/springConnection');
      const springConn = await resolveSpringConnection();
      if (springConn) {
        return springConn;
      }
    } catch {
      // spring module not available or resolution failed
    }
  }
  return pickSqlToolsConnection();
}

export async function pickSqlToolsConnection(): Promise<string | undefined> {
  const connections = await getSqlToolsConnections();

  if (connections.length === 0) {
    vscode.window.showErrorMessage(
      'No SQLTools connections found. Add a connection in the SQLTools sidebar first.'
    );
    return undefined;
  }

  const items = connections.map((conn) => ({
    label: conn.name,
    description: conn.isConnected ? 'Connected' : 'Not connected',
    detail: conn.id,
    connId: conn.id ?? conn.name,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a SQLTools connection',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  return picked?.connId;
}
