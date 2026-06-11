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
function activate(context) {
    let isActive = true;
    context.subscriptions.push({
        dispose: () => {
            isActive = false;
            (0, runner_1.disposeRunner)();
        },
    });
    const outputChannel = vscode.window.createOutputChannel('Execute SQL');
    context.subscriptions.push(outputChannel);
    (0, runner_1.initRunner)(outputChannel, () => isActive);
    const disposable = vscode.commands.registerCommand('excuteSql.runMultiple', async (contextUri, allSelections) => {
        try {
            let uris = (0, runner_1.resolveSelectedUris)(contextUri, allSelections);
            if (uris.length === 0) {
                const picked = await (0, runner_1.pickSqlFilesFromDialog)();
                if (!picked || picked.length === 0) {
                    return;
                }
                uris = picked;
            }
            const connNameOrId = await (0, connection_1.pickSqlToolsConnection)();
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
    context.subscriptions.push(disposable);
}
function deactivate() {
    (0, runner_1.disposeRunner)();
}
//# sourceMappingURL=extension.js.map