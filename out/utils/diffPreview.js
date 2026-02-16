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
exports.showDiffPreview = showDiffPreview;
exports.applyFileChanges = applyFileChanges;
const vscode = __importStar(require("vscode"));
async function showDiffPreview(change) {
    const originalDoc = await vscode.workspace.openTextDocument({
        content: change.originalCode,
        language: detectLanguage(change.filePath)
    });
    const suggestedDoc = await vscode.workspace.openTextDocument({
        content: change.suggestedCode,
        language: detectLanguage(change.filePath)
    });
    await vscode.commands.executeCommand("vscode.diff", originalDoc.uri, suggestedDoc.uri, `Proposed changes: ${change.filePath}`);
}
async function applyFileChanges(changes) {
    const edit = new vscode.WorkspaceEdit();
    for (const change of changes) {
        const uri = vscode.Uri.file(change.filePath);
        const document = await vscode.workspace.openTextDocument(uri);
        const startLine = Math.max(change.lineStart - 1, 0);
        const endLine = Math.max(change.lineEnd - 1, startLine);
        const start = new vscode.Position(startLine, 0);
        const end = document.lineAt(endLine).range.end;
        edit.replace(uri, new vscode.Range(start, end), change.suggestedCode);
    }
    await vscode.workspace.applyEdit(edit);
}
function detectLanguage(filePath) {
    const ext = filePath.split(".").pop();
    if (!ext)
        return undefined;
    if (ext === "ts" || ext === "tsx")
        return "typescript";
    if (ext === "js" || ext === "jsx")
        return "javascript";
    if (ext === "json")
        return "json";
    return undefined;
}
//# sourceMappingURL=diffPreview.js.map