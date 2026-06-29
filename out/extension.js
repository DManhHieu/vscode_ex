"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const connection_1 = require("./connection");
const runner_1 = require("./runner");
const JAVA_SELECTOR = { language: 'java', scheme: 'file' };
const SPRING_INIT_DELAY_MS = 5000;
let springFeaturesStarted = false;
function logError(scope, error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Execute SQL [${scope}]: ${message}`);
}
function registerCoreCommands(context, isActive) {
    const runMultipleDisposable = vscode.commands.registerCommand('excuteSql.runMultiple', async (contextUri, allSelections) => {
        try {
            let uris = (0, runner_1.resolveSelectedUris)(contextUri, allSelections);
            if (uris.length === 0) {
                const picked = await (0, runner_1.pickSqlFilesFromDialog)();
                if (!picked || picked.length === 0) {
                    return;
                }
                uris = picked;
            }
            const autoPick = vscode.workspace.getConfiguration('excuteSql.spring').get('autoPickDatasource') ?? true;
            const connNameOrId = autoPick
                ? await (0, connection_1.resolveConnectionId)(true)
                : await (0, connection_1.pickSqlToolsConnection)();
            if (!connNameOrId) {
                return;
            }
            await (0, runner_1.runSqlFilesInOrder)(uris, connNameOrId);
        }
        catch (error) {
            logError('runMultiple', error);
            vscode.window.showErrorMessage(`Execute SQL Files: ${error instanceof Error ? error.message : String(error)}`);
        }
    });
    context.subscriptions.push(runMultipleDisposable);
}
async function startSpringFeatures(context) {
    if (springFeaturesStarted) {
        return;
    }
    springFeaturesStarted = true;
    try {
        const [{ rebuildIndex, startWorkspaceScanner, disposeWorkspaceScanner, setOnIndexUpdated }, { RunQueryCodeLensProvider, runSpringQueryAtLine, copySpringQueryAtLine }, { QueryCompletionProvider }, { SpringDefinitionProvider }, { RepositoryDiagnosticProvider },] = await Promise.all([
            Promise.resolve().then(() => __importStar(require('./spring/index/workspaceScanner'))),
            Promise.resolve().then(() => __importStar(require('./spring/providers/runQueryCodeLens'))),
            Promise.resolve().then(() => __importStar(require('./spring/providers/queryCompletionProvider'))),
            Promise.resolve().then(() => __importStar(require('./spring/providers/springDefinitionProvider'))),
            Promise.resolve().then(() => __importStar(require('./spring/providers/repositoryDiagnosticProvider'))),
        ]);
        context.subscriptions.push({ dispose: () => disposeWorkspaceScanner() });
        const diagnosticProvider = new RepositoryDiagnosticProvider();
        context.subscriptions.push({ dispose: () => diagnosticProvider.dispose() });
        setOnIndexUpdated(() => diagnosticProvider.validateAllOpenDocuments());
        startWorkspaceScanner(context);
        const runSpringQueryDisposable = vscode.commands.registerCommand('excuteSql.runSpringQuery', async (uri, line) => {
            try {
                const editor = vscode.window.activeTextEditor;
                const targetUri = uri ?? editor?.document.uri;
                const targetLine = line ?? editor?.selection.active.line;
                if (!targetUri || targetLine === undefined) {
                    vscode.window.showWarningMessage('Open a Java file with a @Query annotation.');
                    return;
                }
                await runSpringQueryAtLine(targetUri, targetLine);
            }
            catch (error) {
                logError('runSpringQuery', error);
                vscode.window.showErrorMessage(`Run Spring Query: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        const refreshIndexDisposable = vscode.commands.registerCommand('excuteSql.refreshSpringIndex', async () => {
            try {
                await rebuildIndex(true);
                diagnosticProvider.validateAllOpenDocuments();
                vscode.window.showInformationMessage('Spring JPA index refreshed.');
            }
            catch (error) {
                logError('refreshSpringIndex', error);
            }
        });
        const copySpringQueryDisposable = vscode.commands.registerCommand('excuteSql.copySpringQuery', async (uri, line) => {
            try {
                const editor = vscode.window.activeTextEditor;
                const targetUri = uri ?? editor?.document.uri;
                const targetLine = line ?? editor?.selection.active.line;
                if (!targetUri || targetLine === undefined) {
                    vscode.window.showWarningMessage('Open a Java file with a @Query annotation.');
                    return;
                }
                await copySpringQueryAtLine(targetUri, targetLine);
            }
            catch (error) {
                logError('copySpringQuery', error);
                vscode.window.showErrorMessage(`Copy Spring Query: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
        const codeLensProvider = new RunQueryCodeLensProvider();
        context.subscriptions.push(vscode.languages.registerCodeLensProvider(JAVA_SELECTOR, codeLensProvider));
        const completionProvider = new QueryCompletionProvider();
        context.subscriptions.push(vscode.languages.registerCompletionItemProvider(JAVA_SELECTOR, completionProvider, '.', ':', ' ', '\n'));
        const definitionProvider = new SpringDefinitionProvider();
        context.subscriptions.push(vscode.languages.registerDefinitionProvider(JAVA_SELECTOR, definitionProvider));
        const validateDiagnostics = (doc) => {
            if (doc.languageId === 'java') {
                diagnosticProvider.validateDocument(doc);
            }
        };
        context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(validateDiagnostics), vscode.workspace.onDidSaveTextDocument(validateDiagnostics));
        for (const doc of vscode.workspace.textDocuments) {
            validateDiagnostics(doc);
        }
        context.subscriptions.push(runSpringQueryDisposable, refreshIndexDisposable, copySpringQueryDisposable);
    }
    catch (error) {
        springFeaturesStarted = false;
        logError('startSpringFeatures', error);
    }
}
function scheduleSpringFeatures(context) {
    const hasJavaOrSpring = vscode.workspace.textDocuments.some((doc) => doc.languageId === 'java') ||
        vscode.workspace.workspaceFolders !== undefined;
    if (!hasJavaOrSpring) {
        return;
    }
    setTimeout(() => {
        void startSpringFeatures(context);
    }, SPRING_INIT_DELAY_MS);
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === 'java') {
            void startSpringFeatures(context);
        }
    }));
}
function activate(context) {
    let isActive = true;
    const outputChannel = vscode.window.createOutputChannel('Execute SQL');
    context.subscriptions.push(outputChannel);
    (0, runner_1.initRunner)(outputChannel, () => isActive);
    registerCoreCommands(context, () => isActive);
    scheduleSpringFeatures(context);
    context.subscriptions.push({
        dispose: () => {
            isActive = false;
            (0, runner_1.disposeRunner)();
        },
    });
}
function deactivate() {
    (0, runner_1.disposeRunner)();
}
//# sourceMappingURL=extension.js.map