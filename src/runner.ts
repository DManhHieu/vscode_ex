import * as path from 'path';
import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;
let isActive = (): boolean => false;

export function initRunner(
  channel: vscode.OutputChannel,
  activeCheck: () => boolean
): void {
  outputChannel = channel;
  isActive = activeCheck;
}

export function disposeRunner(): void {
  isActive = () => false;
  outputChannel = undefined;
}

function canUseOutputChannel(): boolean {
  return isActive() && outputChannel !== undefined;
}

export function log(message: string): void {
  if (!canUseOutputChannel() || !outputChannel) {
    return;
  }

  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}

export function showOutput(): void {
  if (!canUseOutputChannel() || !outputChannel) {
    return;
  }

  outputChannel.show(true);
}

export function isSqlFile(uri: vscode.Uri): boolean {
  return path.extname(uri.fsPath).toLowerCase() === '.sql';
}

export function sortSqlFilesByName(uris: vscode.Uri[]): vscode.Uri[] {
  return [...uris].sort((a, b) =>
    path.basename(a.fsPath).localeCompare(path.basename(b.fsPath), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
}

async function readSqlFile(uri: vscode.Uri): Promise<string> {
  const data = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(data).toString('utf8');
}

async function executeSqlQuery(
  query: string,
  connNameOrId: string
): Promise<unknown> {
  return vscode.commands.executeCommand('sqltools.executeQuery', query, {
    connNameOrId,
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isExecutionFailure(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') {
    return undefined;
  }

  const payload = result as Record<string, unknown>;

  if (payload.error === true || payload.error === 'true') {
    const message = payload.message;
    return typeof message === 'string' && message.trim()
      ? message
      : 'SQLTools reported an execution error.';
  }

  if (typeof payload.message === 'string' && payload.message.toLowerCase().includes('error')) {
    return payload.message;
  }

  return undefined;
}

export async function runSqlFilesInOrder(
  uris: vscode.Uri[],
  connNameOrId: string
): Promise<void> {
  if (!isActive()) {
    return;
  }

  const sqlFiles = sortSqlFilesByName(uris.filter(isSqlFile));

  if (sqlFiles.length === 0) {
    vscode.window.showWarningMessage('No .sql files selected.');
    return;
  }

  log(`Starting batch execution of ${sqlFiles.length} file(s) on connection "${connNameOrId}".`);
  showOutput();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Execute SQL Files',
      cancellable: false,
    },
    async (progress) => {
      for (let index = 0; index < sqlFiles.length; index++) {
        if (!isActive()) {
          return;
        }

        const uri = sqlFiles[index];
        const fileName = path.basename(uri.fsPath);

        progress.report({
          message: `Running ${index + 1}/${sqlFiles.length}: ${fileName}`,
          increment: 100 / sqlFiles.length,
        });

        log(`Running ${index + 1}/${sqlFiles.length}: ${uri.fsPath}`);

        const content = (await readSqlFile(uri)).trim();
        if (!content) {
          log(`Skipped empty file: ${uri.fsPath}`);
          continue;
        }

        try {
          const result = await executeSqlQuery(content, connNameOrId);

          if (result === undefined) {
            throw new Error(
              'SQLTools execution failed. Check the SQLTools output channel for details.'
            );
          }

          const failureMessage = isExecutionFailure(result);

          if (failureMessage) {
            throw new Error(failureMessage);
          }

          log(`Completed: ${uri.fsPath}`);
        } catch (error) {
          const message = getErrorMessage(error);
          log(`Failed: ${uri.fsPath} — ${message}`);
          showOutput();
          vscode.window.showErrorMessage(
            `Failed executing "${fileName}": ${message}`
          );
          return;
        }
      }

      log(`Batch execution finished successfully (${sqlFiles.length} file(s)).`);
      vscode.window.showInformationMessage(
        `Successfully executed ${sqlFiles.length} SQL file(s) in order.`
      );
    }
  );
}

export async function pickSqlFilesFromDialog(): Promise<vscode.Uri[] | undefined> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: true,
    openLabel: 'Execute SQL Files',
    filters: {
      SQL: ['sql'],
    },
  });

  return uris;
}

export function resolveSelectedUris(
  contextUri: vscode.Uri | undefined,
  allSelections: vscode.Uri[] | undefined
): vscode.Uri[] {
  if (allSelections && allSelections.length > 0) {
    return allSelections;
  }

  if (contextUri) {
    return [contextUri];
  }

  return [];
}
