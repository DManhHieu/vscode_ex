import * as vscode from 'vscode';
import { resolveConnectionId, pickSqlToolsConnection } from './connection';
import {
  disposeRunner,
  initRunner,
  pickSqlFilesFromDialog,
  resolveSelectedUris,
  runSqlFilesInOrder,
} from './runner';
import { rebuildIndex, startWorkspaceScanner, disposeWorkspaceScanner, setOnIndexUpdated } from './spring/index/workspaceScanner';
import { RunQueryCodeLensProvider, runSpringQueryAtLine, copySpringQueryAtLine } from './spring/providers/runQueryCodeLens';
import { QueryCompletionProvider } from './spring/providers/queryCompletionProvider';
import { SpringDefinitionProvider } from './spring/providers/springDefinitionProvider';
import { RepositoryDiagnosticProvider } from './spring/providers/repositoryDiagnosticProvider';

const JAVA_SELECTOR: vscode.DocumentSelector = { language: 'java', scheme: 'file' };

export function activate(context: vscode.ExtensionContext): void {
  let isActive = true;
  context.subscriptions.push({
    dispose: () => {
      isActive = false;
      disposeRunner();
      disposeWorkspaceScanner();
    },
  });

  const outputChannel = vscode.window.createOutputChannel('Execute SQL');
  context.subscriptions.push(outputChannel);
  initRunner(outputChannel, () => isActive);

  startWorkspaceScanner(context);

  const diagnosticProvider = new RepositoryDiagnosticProvider();
  context.subscriptions.push({ dispose: () => diagnosticProvider.dispose() });

  setOnIndexUpdated(() => diagnosticProvider.validateAllOpenDocuments());

  const runMultipleDisposable = vscode.commands.registerCommand(
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

        const autoPick = vscode.workspace.getConfiguration('excuteSql.spring').get<boolean>('autoPickDatasource') ?? true;
        const connNameOrId = autoPick
          ? await resolveConnectionId(true)
          : await pickSqlToolsConnection();
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

  const runSpringQueryDisposable = vscode.commands.registerCommand(
    'excuteSql.runSpringQuery',
    async (uri?: vscode.Uri, line?: number) => {
      try {
        const editor = vscode.window.activeTextEditor;
        const targetUri = uri ?? editor?.document.uri;
        const targetLine = line ?? editor?.selection.active.line;

        if (!targetUri || targetLine === undefined) {
          vscode.window.showWarningMessage('Open a Java file with a @Query annotation.');
          return;
        }

        await runSpringQueryAtLine(targetUri, targetLine);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Run Spring Query: ${message}`);
      }
    }
  );

  const refreshIndexDisposable = vscode.commands.registerCommand(
    'excuteSql.refreshSpringIndex',
    async () => {
      await rebuildIndex(true);
      diagnosticProvider.validateAllOpenDocuments();
      vscode.window.showInformationMessage('Spring JPA index refreshed.');
    }
  );

  const copySpringQueryDisposable = vscode.commands.registerCommand(
    'excuteSql.copySpringQuery',
    async (uri?: vscode.Uri, line?: number) => {
      try {
        const editor = vscode.window.activeTextEditor;
        const targetUri = uri ?? editor?.document.uri;
        const targetLine = line ?? editor?.selection.active.line;

        if (!targetUri || targetLine === undefined) {
          vscode.window.showWarningMessage('Open a Java file with a @Query annotation.');
          return;
        }

        await copySpringQueryAtLine(targetUri, targetLine);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Copy Spring Query: ${message}`);
      }
    }
  );

  const codeLensProvider = new RunQueryCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(JAVA_SELECTOR, codeLensProvider)
  );

  const completionProvider = new QueryCompletionProvider();
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      JAVA_SELECTOR,
      completionProvider,
      '.',
      ':',
      ' ',
      '\n'
    )
  );

  const definitionProvider = new SpringDefinitionProvider();
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(JAVA_SELECTOR, definitionProvider)
  );

  const validateDiagnostics = (doc: vscode.TextDocument): void => {
    if (doc.languageId === 'java') {
      diagnosticProvider.validateDocument(doc);
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(validateDiagnostics),
    vscode.workspace.onDidChangeTextDocument((e) => validateDiagnostics(e.document)),
    vscode.workspace.onDidSaveTextDocument(validateDiagnostics)
  );

  for (const doc of vscode.workspace.textDocuments) {
    validateDiagnostics(doc);
  }

  context.subscriptions.push(
    runMultipleDisposable,
    runSpringQueryDisposable,
    refreshIndexDisposable,
    copySpringQueryDisposable
  );
}

export function deactivate(): void {
  disposeRunner();
  disposeWorkspaceScanner();
}
