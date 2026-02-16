import * as vscode from "vscode";
import { WorkspaceRoot } from "../types";

export function getWorkspaceRoots(): WorkspaceRoot[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return [];
  return folders.map((folder) => ({
    name: folder.name,
    fsPath: folder.uri.fsPath
  }));
}
