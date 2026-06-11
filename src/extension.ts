import * as vscode from 'vscode';
import { pickSqlToolsConnection } from './connection';
import {
  disposeRunner,
  initRunner,
  pickSqlFilesFromDialog,
  resolveSelectedUris,
  runSqlFilesInOrder,
} from './runner';

export function activate(context: vscode.ExtensionContext): void {
  let isActive = true;
  context.subscriptions.push({
    dispose: () => {
      isActive = false;
      disposeRunner();
    },
  });

  const outputChannel = vscode.window.createOutputChannel('Execute SQL');
  context.subscriptions.push(outputChannel);
  initRunner(outputChannel, () => isActive);

  const disposable = vscode.commands.registerCommand(
    'excuteSql.runMultiple',
    async (contextUri?: vscode.Uri, allSelections?: vscode.Uri[]) => {
      try {
        let uris = resolveSelectedUris(contextUri, allSelections);

        if (uris.length === 0) {
          const picked = await pickSqlFilesFromDialog();
          if (!picked || picked.length === 0) {
            return;
          }
          uris = picked;
        }

        const connNameOrId = await pickSqlToolsConnection();
        if (!connNameOrId) {
          return;
        }

        await runSqlFilesInOrder(uris, connNameOrId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Execute SQL Files: ${message}`);
      }
    }
  );

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  disposeRunner();
}
