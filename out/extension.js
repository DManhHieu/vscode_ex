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
const workspaceScanner_1 = require("./spring/index/workspaceScanner");
const runQueryCodeLens_1 = require("./spring/providers/runQueryCodeLens");
const queryCompletionProvider_1 = require("./spring/providers/queryCompletionProvider");
const springDefinitionProvider_1 = require("./spring/providers/springDefinitionProvider");
const repositoryDiagnosticProvider_1 = require("./spring/providers/repositoryDiagnosticProvider");
const JAVA_SELECTOR = { language: 'java', scheme: 'file' };
function activate(context) {
    let isActive = true;
    context.subscriptions.push({
        dispose: () => {
            isActive = false;
            (0, runner_1.disposeRunner)();
            (0, workspaceScanner_1.disposeWorkspaceScanner)();
        },
    });
    const outputChannel = vscode.window.createOutputChannel('Execute SQL');
    context.subscriptions.push(outputChannel);
    (0, runner_1.initRunner)(outputChannel, () => isActive);
    (0, workspaceScanner_1.startWorkspaceScanner)(context);
    const diagnosticProvider = new repositoryDiagnosticProvider_1.RepositoryDiagnosticProvider();
    context.subscriptions.push({ dispose: () => diagnosticProvider.dispose() });
    (0, workspaceScanner_1.setOnIndexUpdated)(() => diagnosticProvider.validateAllOpenDocuments());
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
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Execute SQL Files: ${message}`);
        }
    });
    const runSpringQueryDisposable = vscode.commands.registerCommand('excuteSql.runSpringQuery', async (uri, line) => {
        try {
            const editor = vscode.window.activeTextEditor;
            const targetUri = uri ?? editor?.document.uri;
            const targetLine = line ?? editor?.selection.active.line;
            if (!targetUri || targetLine === undefined) {
                vscode.window.showWarningMessage('Open a Java file with a @Query annotation.');
                return;
            }
            await (0, runQueryCodeLens_1.runSpringQueryAtLine)(targetUri, targetLine);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Run Spring Query: ${message}`);
        }
    });
    const refreshIndexDisposable = vscode.commands.registerCommand('excuteSql.refreshSpringIndex', async () => {
        await (0, workspaceScanner_1.rebuildIndex)(true);
        diagnosticProvider.validateAllOpenDocuments();
        vscode.window.showInformationMessage('Spring JPA index refreshed.');
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
            await (0, runQueryCodeLens_1.copySpringQueryAtLine)(targetUri, targetLine);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Copy Spring Query: ${message}`);
        }
    });
    const codeLensProvider = new runQueryCodeLens_1.RunQueryCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider(JAVA_SELECTOR, codeLensProvider));
    const completionProvider = new queryCompletionProvider_1.QueryCompletionProvider();
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(JAVA_SELECTOR, completionProvider, '.', ':', ' ', '\n'));
    const definitionProvider = new springDefinitionProvider_1.SpringDefinitionProvider();
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(JAVA_SELECTOR, definitionProvider));
    const validateDiagnostics = (doc) => {
        if (doc.languageId === 'java') {
            diagnosticProvider.validateDocument(doc);
        }
    };
    context.subscriptions.push(vscode.workspace.onDidOpenTextDocument(validateDiagnostics), vscode.workspace.onDidChangeTextDocument((e) => validateDiagnostics(e.document)), vscode.workspace.onDidSaveTextDocument(validateDiagnostics));
    for (const doc of vscode.workspace.textDocuments) {
        validateDiagnostics(doc);
    }
    context.subscriptions.push(runMultipleDisposable, runSpringQueryDisposable, refreshIndexDisposable, copySpringQueryDisposable);
}
function deactivate() {
    (0, runner_1.disposeRunner)();
    (0, workspaceScanner_1.disposeWorkspaceScanner)();
}
//# sourceMappingURL=extension.js.map