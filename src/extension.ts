import * as vscode from "vscode";
import { PackageTreeProvider, PackageNode } from "./providers/packageTreeProvider";
import { CopilotAnalyzer, MissingCopilotTokenError } from "./services/copilotAnalyzer";
import { scanWorkspace, clearScanCache } from "./services/packageScanner";
import { getWorkspaceRoots } from "./services/workspaceLocator";
import { PackageInfo, ScanResult } from "./types";
import { runNpmInstall } from "./utils/terminal";
import { applyFileChanges, showDiffPreview } from "./utils/diffPreview";
import { checkCopilotCli } from "./services/copilotCliChecker";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PackageTreeProvider();
  const treeView = vscode.window.createTreeView("npmVersionGuardianView", {
    treeDataProvider: provider
  });
  const auth = new GithubAuthManager();
  const analyzer = new CopilotAnalyzer(context, () => auth.getToken());

  const controller = new GuardianController(context, provider, treeView, analyzer, auth);

  context.subscriptions.push(
    vscode.commands.registerCommand("npmVersionGuardian.refreshVersions", () =>
      controller.refreshAll(true)
    ),
    vscode.commands.registerCommand("npmVersionGuardian.updatePackage", (node: PackageNode) =>
      controller.updatePackage(node)
    ),
    vscode.commands.registerCommand("npmVersionGuardian.updateWithResolve", (node: PackageNode) =>
      controller.updateWithResolve(node)
    ),
    vscode.commands.registerCommand("npmVersionGuardian.loginWithGitHub", () =>
      controller.loginWithGitHub()
    ),
    vscode.commands.registerCommand("npmVersionGuardian.showCopilotCliHelp", () =>
      controller.showCopilotCliHelp()
    ),
    vscode.commands.registerCommand("npmVersionGuardian.showCopilotDetails", (pkg: PackageInfo) =>
      controller.showCopilotDetails(pkg)
    ),
    vscode.commands.registerCommand(
      "npmVersionGuardian.analyzePackage",
      (node: PackageNode | PackageInfo) => controller.analyzePackage(node)
    )
  );

  context.subscriptions.push(
    vscode.authentication.onDidChangeSessions((event) => {
      if (event.provider.id === "github") {
        controller.refreshAll(true).catch(() => undefined);
      }
    })
  );

  controller.refreshAll(false).catch(() => undefined);

  const intervalMinutes = getConfigNumber("scanInterval", 30);
  const timer = setInterval(() => {
    controller.refreshAll(false).catch(() => undefined);
  }, intervalMinutes * 60 * 1000);

  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

export function deactivate(): void {
  clearScanCache();
}

class GuardianController {
  private lastResults: ScanResult[] = [];
  private copilotEnabled = false;
  private hasGithubSession = false;
  private detailsDoc: vscode.TextDocument | undefined;
  private detailsPackageName: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: PackageTreeProvider,
    private readonly treeView: vscode.TreeView<unknown>,
    private readonly analyzer: CopilotAnalyzer,
    private readonly auth: GithubAuthManager
  ) {}

  async refreshAll(force: boolean): Promise<void> {
    if (force) {
      clearScanCache();
    }

    const includeDev = getConfigBoolean("includeDevDependencies", true);
    const analyzeMinor = getConfigBoolean("analyzeMinorBreakingChanges", false);
    const autoUpdatePatch = getConfigBoolean("autoUpdatePatch", false);
    this.copilotEnabled = getConfigBoolean("enableCopilot", false);
    this.hasGithubSession = await this.auth.refreshSession(false);
    this.provider.setCopilotState(this.copilotEnabled, this.hasGithubSession);
    this.provider.setCopilotCliStatus(undefined);

    const roots = getWorkspaceRoots();
    const results: ScanResult[] = [];

    for (const root of roots) {
      const result = await scanWorkspace(root, includeDev);
      results.push(result);
    }

    this.lastResults = results;
    this.provider.setData(results);
    this.updateBadge(results);

    if (autoUpdatePatch) {
      await this.autoUpdatePatch(results);
    }

    if (this.copilotEnabled && this.hasGithubSession) {
      const cliStatus = await checkCopilotCli();
      this.provider.setCopilotCliStatus(cliStatus);
      if (!cliStatus.supported) {
        this.markAnalysisError(
          results,
          analyzeMinor,
          cliStatus.error ?? "Copilot CLI not compatible"
        );
      }
    } else if (this.copilotEnabled && !this.hasGithubSession) {
      this.markAnalysisError(results, analyzeMinor, "GitHub OAuth session missing");
    }
  }

  async updatePackage(node?: PackageNode): Promise<void> {
    if (!node) return;
    const pkg = node.packageInfo;
    const root = this.findRootForPackage(pkg);
    if (!root) return;

    runNpmInstall(root.fsPath, pkg.name);
    vscode.window.showInformationMessage(`Running npm install for ${pkg.name}`);
  }

  async updateWithResolve(node?: PackageNode): Promise<void> {
    if (!node) return;
    const pkg = node.packageInfo;
    const root = this.findRootForPackage(pkg);
    if (!root) return;

    if (pkg.analysisStatus !== "success") {
      vscode.window.showWarningMessage("Analysis not ready or failed. Please retry analysis.");
      return;
    }

    runNpmInstall(root.fsPath, pkg.name);

    if (!pkg.breakingChanges || pkg.breakingChanges.length === 0) {
      vscode.window.showWarningMessage("No breaking changes detected for this package.");
      return;
    }

    const suggestedChanges = await this.analyzer.generateMigration({
      packageName: pkg.name,
      currentVersion: pkg.currentVersion,
      targetVersion: pkg.latestVersion,
      breakingChanges: pkg.breakingChanges.map((item) => item.description),
      codebaseFiles: []
    });

    if (suggestedChanges.length === 0) {
      vscode.window.showInformationMessage("No code changes suggested by Copilot.");
      return;
    }

    for (const change of suggestedChanges) {
      await showDiffPreview(change);
    }

    const answer = await vscode.window.showInformationMessage(
      "Apply suggested changes?",
      "Apply",
      "Cancel"
    );
    if (answer === "Apply") {
      await applyFileChanges(suggestedChanges);
    }
  }

  async loginWithGitHub(): Promise<void> {
    const session = await this.auth.refreshSession(true);
    if (!session) {
      vscode.window.showErrorMessage("GitHub login failed.");
      return;
    }
    await vscode.workspace
      .getConfiguration("npmVersionGuardian")
      .update("enableCopilot", true, vscode.ConfigurationTarget.Global);
    this.copilotEnabled = true;
    this.hasGithubSession = true;
    this.provider.setCopilotState(true, true);
    await this.refreshAll(true);
  }

  async showCopilotCliHelp(): Promise<void> {
    const content = [
      "# Copilot CLI requirements",
      "",
      "Breaking changes analysis requires the local Copilot CLI to support `--headless`.",
      "",
      "Update the Copilot CLI:",
      "",
      "- `brew upgrade copilot-cli`",
      "- `npm i -g @github/copilot`",
      "",
      "After updating, restart the Extension Host and retry analysis."
    ].join("\n");

    const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  async showCopilotDetails(pkg?: PackageInfo): Promise<void> {
    if (!pkg) return;
    if (this.copilotEnabled && this.hasGithubSession) {
      try {
        await this.ensureCopilotCliReady();
        if (!pkg.analysisStatus || pkg.analysisStatus === "error") {
          await this.analyzeSinglePackage(pkg);
        }
      } catch (error) {
        pkg.analysisStatus = "error";
        pkg.analysisError = error instanceof Error ? error.message : "Copilot CLI not compatible";
        this.updateDetailsPanel(pkg);
      }
    }

    const content = this.buildCopilotDetailsContent(pkg);
    const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
    this.detailsDoc = doc;
    this.detailsPackageName = pkg.name;
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  async analyzePackage(node?: PackageNode | PackageInfo): Promise<void> {
    const pkg = node && "packageInfo" in node ? node.packageInfo : node;
    if (!pkg) return;
    if (!this.copilotEnabled) {
      vscode.window.showWarningMessage("Enable Copilot login to analyze breaking changes.");
      return;
    }
    if (!this.hasGithubSession) {
      vscode.window.showWarningMessage("GitHub OAuth session missing. Please login.");
      return;
    }
    try {
      await this.ensureCopilotCliReady();
      await this.analyzeSinglePackage(pkg);
    } catch (error) {
      pkg.analysisStatus = "error";
      pkg.analysisError = error instanceof Error ? error.message : "Copilot CLI not compatible";
      this.updateDetailsPanel(pkg);
      this.provider.refresh();
    }
  }

  private async analyzeBreakingChanges(results: ScanResult[], analyzeMinor: boolean): Promise<void> {
    const targets: PackageInfo[] = [];

    for (const result of results) {
      for (const pkg of result.packages) {
        if (pkg.updateType === "major" || (analyzeMinor && pkg.updateType === "minor")) {
          targets.push(pkg);
        }
      }
    }

    if (targets.length === 0) return;

    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
    status.text = "$(sync~spin) Analyzing breaking changes...";
    status.show();

    for (const pkg of targets) {
      await this.analyzeSinglePackage(pkg, status);
    }

    status.dispose();
  }

  private async analyzeSinglePackage(
    pkg: PackageInfo,
    status?: vscode.StatusBarItem
  ): Promise<void> {
    pkg.analysisStatus = "pending";
    pkg.analysisError = undefined;
    this.provider.refresh();
    this.updateDetailsPanel(pkg);

    if (status) {
      status.text = `$(sync~spin) Analyzing ${pkg.name}...`;
    }

    try {
      const analysis = await this.analyzer.analyzeUpdate(
        pkg.name,
        pkg.currentVersion,
        pkg.latestVersion
      );
      pkg.hasBreakingChanges = analysis.hasBreakingChanges;
      pkg.breakingChanges = analysis.breakingChanges;
      pkg.migrationSteps = analysis.migrationSteps;
      pkg.confidenceScore = analysis.confidenceScore;
      pkg.analysisStatus = "success";
      pkg.analysisError = undefined;
      this.updateDetailsPanel(pkg);
    } catch (error) {
      if (error instanceof MissingCopilotTokenError) {
        pkg.analysisStatus = "error";
        pkg.analysisError = "GitHub OAuth session missing";
      } else {
        pkg.analysisStatus = "error";
        pkg.analysisError = error instanceof Error ? error.message : "Analysis failed";
      }
      this.updateDetailsPanel(pkg);
    }
    this.provider.refresh();
  }

  private async ensureCopilotCliReady(): Promise<void> {
    const cliStatus = await checkCopilotCli();
    this.provider.setCopilotCliStatus(cliStatus);
    if (!cliStatus.supported) {
      throw new Error(cliStatus.error ?? "Copilot CLI not compatible");
    }
  }

  private markAnalysisError(results: ScanResult[], analyzeMinor: boolean, message: string): void {
    for (const result of results) {
      for (const pkg of result.packages) {
        if (pkg.updateType === "major" || (analyzeMinor && pkg.updateType === "minor")) {
          pkg.analysisStatus = "error";
          pkg.analysisError = message;
          this.updateDetailsPanel(pkg);
        }
      }
    }
    this.provider.refresh();
  }

  private updateDetailsPanel(pkg: PackageInfo): void {
    if (!this.detailsDoc || this.detailsPackageName !== pkg.name) return;
    const content = this.buildCopilotDetailsContent(pkg);
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      this.detailsDoc.positionAt(0),
      this.detailsDoc.positionAt(this.detailsDoc.getText().length)
    );
    edit.replace(this.detailsDoc.uri, fullRange, content);
    vscode.workspace.applyEdit(edit).then(() => undefined);
  }

  private buildCopilotDetailsContent(pkg: PackageInfo): string {
    const header = [
      `# ${pkg.name}`,
      ``,
      `Current: ${pkg.currentVersion}`,
      `Latest: ${pkg.latestVersion}`,
      `Update type: ${pkg.updateType.toUpperCase()}`,
      ``
    ];

    if (pkg.analysisStatus === "pending") {
      return [
        ...header,
        `## Breaking changes`,
        `Analyzing...`,
        ``,
        `## Migration steps`,
        `Analyzing...`,
        ``
      ].join("\n");
    }

    if (pkg.analysisStatus === "error") {
      return [
        ...header,
        `## Breaking changes`,
        `Analysis failed: ${pkg.analysisError ?? "Unknown error"}`,
        ``,
        `## Migration steps`,
        `Unavailable`,
        ``
      ].join("\n");
    }

    return [
      ...header,
      `## Breaking changes`,
      ...(pkg.breakingChanges?.length
        ? pkg.breakingChanges.map((change) => `- ${change.description}`)
        : ["- None"]),
      ``,
      `## Migration steps`,
      ...(pkg.migrationSteps?.length
        ? pkg.migrationSteps.map((step) => `- ${step}`)
        : ["- None"]),
      ``
    ].join("\n");
  }

  private updateBadge(results: ScanResult[]): void {
    let total = 0;
    let hasBreaking = false;
    let hasMajor = false;

    for (const result of results) {
      total += result.packages.length;
      for (const pkg of result.packages) {
        if (pkg.updateType === "major") {
          hasMajor = true;
          if (pkg.hasBreakingChanges) {
            hasBreaking = true;
          }
        }
      }
    }

    this.treeView.badge = total
      ? {
          value: Math.min(total, 99),
          tooltip: hasBreaking
            ? "Major updates with breaking changes"
            : hasMajor
              ? "Major updates available"
              : "Updates available"
        }
      : undefined;
  }

  private async autoUpdatePatch(results: ScanResult[]): Promise<void> {
    for (const result of results) {
      for (const pkg of result.packages) {
        if (pkg.updateType === "patch") {
          runNpmInstall(result.root.fsPath, pkg.name);
        }
      }
    }
  }

  private findRootForPackage(pkg: PackageInfo) {
    for (const result of this.lastResults) {
      if (result.packages.includes(pkg)) return result.root;
    }
    return undefined;
  }
}

class GithubAuthManager {
  private session: vscode.AuthenticationSession | undefined;
  private readonly scopes = ["read:user"];

  async refreshSession(createIfNone: boolean): Promise<boolean> {
    try {
      this.session = await vscode.authentication.getSession("github", this.scopes, {
        createIfNone
      });
      return !!this.session;
    } catch {
      this.session = undefined;
      return false;
    }
  }

  async getToken(): Promise<string | undefined> {
    if (this.session) return (this.session as vscode.AuthenticationSession).accessToken;
    await this.refreshSession(false);
    return this.session ? (this.session as vscode.AuthenticationSession).accessToken : undefined;
  }
}

function getConfigNumber(key: string, fallback: number): number {
  const value = vscode.workspace.getConfiguration("npmVersionGuardian").get<number>(key);
  return typeof value === "number" ? value : fallback;
}

function getConfigBoolean(key: string, fallback: boolean): boolean {
  const value = vscode.workspace.getConfiguration("npmVersionGuardian").get<boolean>(key);
  return typeof value === "boolean" ? value : fallback;
}
