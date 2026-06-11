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
exports.initRunner = initRunner;
exports.disposeRunner = disposeRunner;
exports.log = log;
exports.showOutput = showOutput;
exports.isSqlFile = isSqlFile;
exports.sortSqlFilesByName = sortSqlFilesByName;
exports.runSqlFilesInOrder = runSqlFilesInOrder;
exports.pickSqlFilesFromDialog = pickSqlFilesFromDialog;
exports.resolveSelectedUris = resolveSelectedUris;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
let outputChannel;
let isActive = () => false;
function initRunner(channel, activeCheck) {
    outputChannel = channel;
    isActive = activeCheck;
}
function disposeRunner() {
    isActive = () => false;
    outputChannel = undefined;
}
function canUseOutputChannel() {
    return isActive() && outputChannel !== undefined;
}
function log(message) {
    if (!canUseOutputChannel() || !outputChannel) {
        return;
    }
    const timestamp = new Date().toISOString();
    outputChannel.appendLine(`[${timestamp}] ${message}`);
}
function showOutput() {
    if (!canUseOutputChannel() || !outputChannel) {
        return;
    }
    outputChannel.show(true);
}
function isSqlFile(uri) {
    return path.extname(uri.fsPath).toLowerCase() === '.sql';
}
function sortSqlFilesByName(uris) {
    return [...uris].sort((a, b) => path.basename(a.fsPath).localeCompare(path.basename(b.fsPath), undefined, {
        numeric: true,
        sensitivity: 'base',
    }));
}
async function readSqlFile(uri) {
    const data = await vscode.workspace.fs.readFile(uri);
    return Buffer.from(data).toString('utf8');
}
async function executeSqlQuery(query, connNameOrId) {
    return vscode.commands.executeCommand('sqltools.executeQuery', query, {
        connNameOrId,
    });
}
function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
function isExecutionFailure(result) {
    if (!result || typeof result !== 'object') {
        return undefined;
    }
    const payload = result;
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
async function runSqlFilesInOrder(uris, connNameOrId) {
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
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Execute SQL Files',
        cancellable: false,
    }, async (progress) => {
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
                    throw new Error('SQLTools execution failed. Check the SQLTools output channel for details.');
                }
                const failureMessage = isExecutionFailure(result);
                if (failureMessage) {
                    throw new Error(failureMessage);
                }
                log(`Completed: ${uri.fsPath}`);
            }
            catch (error) {
                const message = getErrorMessage(error);
                log(`Failed: ${uri.fsPath} — ${message}`);
                showOutput();
                vscode.window.showErrorMessage(`Failed executing "${fileName}": ${message}`);
                return;
            }
        }
        log(`Batch execution finished successfully (${sqlFiles.length} file(s)).`);
        vscode.window.showInformationMessage(`Successfully executed ${sqlFiles.length} SQL file(s) in order.`);
    });
}
async function pickSqlFilesFromDialog() {
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: 'Execute SQL Files',
        filters: {
            SQL: ['sql'],
        },
    });
    return uris;
}
function resolveSelectedUris(contextUri, allSelections) {
    if (allSelections && allSelections.length > 0) {
        return allSelections;
    }
    if (contextUri) {
        return [contextUri];
    }
    return [];
}
//# sourceMappingURL=runner.js.map