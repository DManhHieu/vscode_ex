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
exports.isSqlToolsAvailable = isSqlToolsAvailable;
exports.ensureSqlToolsActive = ensureSqlToolsActive;
exports.getSqlToolsConnections = getSqlToolsConnections;
exports.pickSqlToolsConnection = pickSqlToolsConnection;
const vscode = __importStar(require("vscode"));
const SQLTOOLS_EXTENSION_ID = 'mtxr.sqltools';
function isSqlToolsAvailable() {
    return vscode.extensions.getExtension(SQLTOOLS_EXTENSION_ID)?.isActive ?? false;
}
async function ensureSqlToolsActive() {
    const extension = vscode.extensions.getExtension(SQLTOOLS_EXTENSION_ID);
    if (!extension) {
        throw new Error('SQLTools extension (mtxr.sqltools) is not installed. Install SQLTools and a database driver first.');
    }
    if (!extension.isActive) {
        await extension.activate();
    }
}
async function getSqlToolsConnections() {
    await ensureSqlToolsActive();
    const connections = await vscode.commands.executeCommand('sqltools.getConnections', { connectedOnly: false, sort: 'connectedFirst' });
    return connections ?? [];
}
async function pickSqlToolsConnection() {
    const connections = await getSqlToolsConnections();
    if (connections.length === 0) {
        vscode.window.showErrorMessage('No SQLTools connections found. Add a connection in the SQLTools sidebar first.');
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
//# sourceMappingURL=connection.js.map