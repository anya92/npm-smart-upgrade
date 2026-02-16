import * as vscode from "vscode";
import { FileChange } from "../types";

export async function showDiffPreview(change: FileChange): Promise<void> {
  const originalDoc = await vscode.workspace.openTextDocument({
    content: change.originalCode,
    language: detectLanguage(change.filePath)
  });
  const suggestedDoc = await vscode.workspace.openTextDocument({
    content: change.suggestedCode,
    language: detectLanguage(change.filePath)
  });

  await vscode.commands.executeCommand(
    "vscode.diff",
    originalDoc.uri,
    suggestedDoc.uri,
    `Proposed changes: ${change.filePath}`
  );
}

export async function applyFileChanges(changes: FileChange[]): Promise<void> {
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

function detectLanguage(filePath: string): string | undefined {
  const ext = filePath.split(".").pop();
  if (!ext) return undefined;
  if (ext === "ts" || ext === "tsx") return "typescript";
  if (ext === "js" || ext === "jsx") return "javascript";
  if (ext === "json") return "json";
  return undefined;
}
