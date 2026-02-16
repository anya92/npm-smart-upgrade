import * as vscode from "vscode";

const terminals = new Map<string, vscode.Terminal>();

export function getTerminalForRoot(rootPath: string): vscode.Terminal {
  const existing = terminals.get(rootPath);
  if (existing) return existing;

  const terminal = vscode.window.createTerminal({
    name: `NPM Smart Upgrade (${rootPath})`,
    cwd: rootPath
  });
  terminals.set(rootPath, terminal);
  return terminal;
}

export function runNpmInstall(rootPath: string, pkg: string): void {
  const terminal = getTerminalForRoot(rootPath);
  terminal.show(true);
  terminal.sendText(`npm install ${pkg}@latest`);
}
