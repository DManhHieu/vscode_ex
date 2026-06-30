import * as vscode from 'vscode';
import { resolveConnectionId, pickSqlToolsConnection } from './connection';
import {
  disposeRunner,
  initRunner,
  pickSqlFilesFromDialog,
  resolveSelectedUris,
  runSqlFilesInOrder,
} from './runner';

const JAVA_SELECTOR: vscode.DocumentSelector = { language: 'java', scheme: 'file' };
/** Defer heavy Spring indexing until Java/Gradle extensions have finished starting. */
const SPRING_INIT_DELAY_MS = 10000;

async function registerQuerySyntaxHighlighting(context: vscode.ExtensionContext): Promise<void> {
  const [
    { registerQueryHighlighting },
    { QuerySemanticTokensProvider, QUERY_TOKEN_LEGEND },
  ] = await Promise.all([
    import('./spring/providers/queryHighlightDecorationProvider'),
    import('./spring/providers/querySemanticTokensProvider'),
  ]);

  registerQueryHighlighting(context);

  const semanticTokensProvider = new QuerySemanticTokensProvider();
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      JAVA_SELECTOR,
      semanticTokensProvider,
      QUERY_TOKEN_LEGEND
    )
  );
}

let springFeaturesStarted = false;
let springInitTimer: ReturnType<typeof setTimeout> | undefined;

function logError(scope: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Execute SQL [${scope}]: ${message}`);
}

function registerCoreCommands(
  context: vscode.ExtensionContext,
  isActive: () => boolean
): void {
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
        logError('runMultiple', error);
        vscode.window.showErrorMessage(`Execute SQL Files: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  context.subscriptions.push(runMultipleDisposable);
}

async function startSpringFeatures(context: vscode.ExtensionContext): Promise<void> {
  if (springFeaturesStarted) {
    return;
  }
  springFeaturesStarted = true;

  try {
    const [
      { rebuildIndex, startWorkspaceScanner, disposeWorkspaceScanner, setOnIndexUpdated },
      { RunQueryCodeLensProvider, runSpringQueryAtLine, copySpringQueryAtLine },
      { QueryCompletionProvider },
      { SpringDefinitionProvider },
      { RepositoryDiagnosticProvider },
    ] = await Promise.all([
      import('./spring/index/workspaceScanner'),
      import('./spring/providers/runQueryCodeLens'),
      import('./spring/providers/queryCompletionProvider'),
      import('./spring/providers/springDefinitionProvider'),
      import('./spring/providers/repositoryDiagnosticProvider'),
    ]);

    context.subscriptions.push({ dispose: () => disposeWorkspaceScanner() });

    const diagnosticProvider = new RepositoryDiagnosticProvider();
    context.subscriptions.push({ dispose: () => diagnosticProvider.dispose() });

    setOnIndexUpdated(() => diagnosticProvider.validateAllOpenDocuments());
    startWorkspaceScanner(context);

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
          logError('runSpringQuery', error);
          vscode.window.showErrorMessage(`Run Spring Query: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );

    const refreshIndexDisposable = vscode.commands.registerCommand(
      'excuteSql.refreshSpringIndex',
      async () => {
        try {
          await rebuildIndex(true, { showProgress: true, showCompletion: true });
          diagnosticProvider.validateAllOpenDocuments();
        } catch (error) {
          logError('refreshSpringIndex', error);
          vscode.window.showErrorMessage(
            `Spring JPA index refresh failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
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
          logError('copySpringQuery', error);
          vscode.window.showErrorMessage(`Copy Spring Query: ${error instanceof Error ? error.message : String(error)}`);
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
        ':'
      )
    );

    const definitionProvider = new SpringDefinitionProvider();
    context.subscriptions.push(
      vscode.languages.registerDefinitionProvider(JAVA_SELECTOR, definitionProvider)
    );

    const validateDiagnostics = (doc: vscode.TextDocument): void => {
      if (doc.languageId === 'java') {
        diagnosticProvider.scheduleValidateDocument(doc);
      }
    };

    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument(validateDiagnostics),
      vscode.workspace.onDidSaveTextDocument(validateDiagnostics)
    );

    for (const doc of vscode.workspace.textDocuments) {
      validateDiagnostics(doc);
    }

    context.subscriptions.push(
      runSpringQueryDisposable,
      refreshIndexDisposable,
      copySpringQueryDisposable
    );
  } catch (error) {
    springFeaturesStarted = false;
    logError('startSpringFeatures', error);
  }
}

function hasOpenJavaDocuments(): boolean {
  return vscode.workspace.textDocuments.some((doc) => doc.languageId === 'java');
}

function scheduleSpringFeaturesDeferred(context: vscode.ExtensionContext): void {
  if (springFeaturesStarted || springInitTimer) {
    return;
  }

  springInitTimer = setTimeout(() => {
    springInitTimer = undefined;
    void startSpringFeatures(context);
  }, SPRING_INIT_DELAY_MS);

  context.subscriptions.push({
    dispose: () => {
      if (springInitTimer) {
        clearTimeout(springInitTimer);
        springInitTimer = undefined;
      }
    },
  });
}

function scheduleSpringFeatures(context: vscode.ExtensionContext): void {
  if (hasOpenJavaDocuments()) {
    scheduleSpringFeaturesDeferred(context);
    return;
  }

  const onJavaOpened = vscode.workspace.onDidOpenTextDocument((doc) => {
    if (doc.languageId === 'java') {
      onJavaOpened.dispose();
      scheduleSpringFeaturesDeferred(context);
    }
  });
  context.subscriptions.push(onJavaOpened);
}

export function activate(context: vscode.ExtensionContext): void {
  let isActive = true;

  const outputChannel = vscode.window.createOutputChannel('Execute SQL');
  context.subscriptions.push(outputChannel);
  initRunner(outputChannel, () => isActive);

  registerCoreCommands(context, () => isActive);
  void registerQuerySyntaxHighlighting(context);
  scheduleSpringFeatures(context);

  context.subscriptions.push({
    dispose: () => {
      isActive = false;
      disposeRunner();
    },
  });
}

export function deactivate(): void {
  disposeRunner();
}
