import * as vscode from "vscode";
import { CopilotCliStatus, PackageInfo, ScanResult, UpdateType } from "../types";

export class PackageTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private data: ScanResult[] = [];
  private copilotEnabled = false;
  private hasGithubSession = false;
  private copilotCliStatus: CopilotCliStatus | undefined;

  setData(data: ScanResult[]): void {
    this.data = data;
    this.refresh();
  }

  setCopilotState(enabled: boolean, hasSession: boolean): void {
    this.copilotEnabled = enabled;
    this.hasGithubSession = hasSession;
    this.refresh();
  }

  setCopilotCliStatus(status?: CopilotCliStatus): void {
    this.copilotCliStatus = status;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element.item;
  }

  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    if (!element) {
      return Promise.resolve(this.getRootNodes());
    }
    return Promise.resolve(element.getChildren());
  }

  private getRootNodes(): TreeNode[] {
    if (this.data.length === 0) {
      return [new MessageNode("No workspace folders found")];
    }

    const needsLogin = !this.copilotEnabled || (this.copilotEnabled && !this.hasGithubSession);
    const loginNode = needsLogin
      ? new LoginNode(
          this.copilotEnabled ? "Login with GitHub (+Copilot)" : "Enable Copilot Login"
        )
      : null;

    const cliBanner =
      this.copilotEnabled && this.hasGithubSession && this.copilotCliStatus?.supported === false
        ? new CliBannerNode(this.copilotCliStatus)
        : null;

    if (this.data.length === 1) {
      const nodes = [...this.getCategoryNodes(this.data[0])];
      if (cliBanner) nodes.unshift(cliBanner);
      if (loginNode) nodes.unshift(loginNode);
      return nodes;
    }

    const roots = this.data.map((result) => new RootNode(result, this.getCategoryNodes(result)));
    const nodes: TreeNode[] = [...roots];
    if (cliBanner) nodes.unshift(cliBanner);
    if (loginNode) nodes.unshift(loginNode);
    return nodes;
  }

  private getCategoryNodes(result: ScanResult): TreeNode[] {
    if (!result.hasPackageJson) {
      return [new MessageNode("No package.json found")];
    }

    const grouped = groupByUpdateType(result.packages);
    return [
      new CategoryNode("Major Updates", grouped.major, this.copilotEnabled, this.hasGithubSession),
      new CategoryNode("Minor Updates", grouped.minor, this.copilotEnabled, this.hasGithubSession),
      new CategoryNode("Patch Updates", grouped.patch, this.copilotEnabled, this.hasGithubSession)
    ];
  }
}

export abstract class TreeNode {
  constructor(readonly item: vscode.TreeItem) {}
  abstract getChildren(): TreeNode[];
}

class RootNode extends TreeNode {
  constructor(private readonly result: ScanResult, private readonly children: TreeNode[]) {
    super(new vscode.TreeItem(result.root.name, vscode.TreeItemCollapsibleState.Expanded));
  }

  getChildren(): TreeNode[] {
    return this.children;
  }
}

class CategoryNode extends TreeNode {
  constructor(
    private readonly label: string,
    private readonly packages: PackageInfo[],
    private readonly copilotEnabled: boolean,
    private readonly hasGithubSession: boolean
  ) {
    super(new vscode.TreeItem(`${label} (${packages.length})`, vscode.TreeItemCollapsibleState.Expanded));
  }

  getChildren(): TreeNode[] {
    if (this.packages.length === 0) {
      return [new MessageNode("No updates")];
    }
    return this.packages.map(
      (pkg) => new PackageNode(pkg, this.copilotEnabled, this.hasGithubSession)
    );
  }
}

export class PackageNode extends TreeNode {
  readonly packageInfo: PackageInfo;

  constructor(pkg: PackageInfo, copilotEnabled: boolean, hasSession: boolean) {
    const item = new vscode.TreeItem(
      `${pkg.name} ${pkg.currentVersion} -> ${pkg.latestVersion}`,
      vscode.TreeItemCollapsibleState.None
    );
    const breakingLabel =
      !copilotEnabled
        ? " | BC: Disabled"
        : !hasSession
          ? " | BC: Error"
          : pkg.analysisStatus === "pending"
        ? " | BC: Analyzing"
        : pkg.analysisStatus === "error"
          ? " | BC: Error"
          : pkg.hasBreakingChanges === true
            ? " | BC: Yes"
            : pkg.hasBreakingChanges === false
              ? " | BC: No"
              : "";
    item.description = breakingLabel.startsWith(" | ") ? breakingLabel.slice(3) : breakingLabel;
    item.contextValue = pkg.hasBreakingChanges ? "npmGuardianPackageBreaking" : "npmGuardianPackage";
    item.tooltip = createTooltip(pkg, copilotEnabled, hasSession);
    item.command = {
      command: "npmVersionGuardian.showCopilotDetails",
      title: "Show Copilot Details",
      arguments: [pkg]
    };
    super(item);
    this.packageInfo = pkg;
  }

  getChildren(): TreeNode[] {
    return [];
  }
}

class MessageNode extends TreeNode {
  constructor(message: string) {
    super(new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None));
  }

  getChildren(): TreeNode[] {
    return [];
  }
}

class LoginNode extends TreeNode {
  constructor(label: string) {
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.command = {
      command: "npmVersionGuardian.loginWithGitHub",
      title: "Login with GitHub (+Copilot)"
    };
    super(item);
  }

  getChildren(): TreeNode[] {
    return [];
  }
}

class CliBannerNode extends TreeNode {
  constructor(status: CopilotCliStatus) {
    const item = new vscode.TreeItem("Copilot CLI update required", vscode.TreeItemCollapsibleState.None);
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown("Copilot CLI is required for breaking changes analysis.\n\n");
    tooltip.appendMarkdown(`Status: ${status.error ?? "Unsupported"}\n\n`);
    tooltip.appendMarkdown(`Version: ${status.version ?? "unknown"}\n\n`);
    tooltip.appendMarkdown("Update:\n");
    tooltip.appendMarkdown("- `brew upgrade copilot-cli`\n");
    tooltip.appendMarkdown("- `npm i -g @github/copilot`\n");
    item.tooltip = tooltip;
    item.command = {
      command: "npmVersionGuardian.showCopilotCliHelp",
      title: "Copilot CLI Requirements"
    };
    super(item);
  }

  getChildren(): TreeNode[] {
    return [];
  }
}

function groupByUpdateType(packages: PackageInfo[]): Record<UpdateType, PackageInfo[]> {
  const grouped: Record<UpdateType, PackageInfo[]> = {
    major: [],
    minor: [],
    patch: []
  };
  for (const pkg of packages) {
    grouped[pkg.updateType].push(pkg);
  }
  return grouped;
}

function createTooltip(
  pkg: PackageInfo,
  copilotEnabled: boolean,
  hasSession: boolean
): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.appendMarkdown(`**${pkg.name}**\n\n`);
  tooltip.appendMarkdown(`Current: ${pkg.currentVersion}\n\n`);
  tooltip.appendMarkdown(`Latest: ${pkg.latestVersion}\n\n`);

  if (!copilotEnabled) {
    tooltip.appendMarkdown("Breaking changes: disabled (login required).\n\n");
    tooltip.appendMarkdown("Click **Analyze Breaking Changes** from the context menu.");
    return tooltip;
  }

  if (!hasSession) {
    tooltip.appendMarkdown("Analysis failed: GitHub OAuth session missing.\n\n");
    tooltip.appendMarkdown("Click **Login with GitHub (+Copilot)**.");
    return tooltip;
  }

  if (pkg.analysisStatus === "error" && pkg.analysisError?.includes("Copilot CLI")) {
    tooltip.appendMarkdown(`Analysis failed: ${pkg.analysisError}`);
    tooltip.appendMarkdown("\n\nUpdate:\n");
    tooltip.appendMarkdown("- `brew upgrade copilot-cli`\n");
    tooltip.appendMarkdown("- `npm i -g @github/copilot`\n");
    return tooltip;
  }

  if (pkg.analysisStatus === "pending") {
    tooltip.appendMarkdown("Breaking changes: analyzing...");
    return tooltip;
  }

  if (pkg.analysisStatus === "error") {
    tooltip.appendMarkdown(`Analysis failed: ${pkg.analysisError ?? "Unknown error"}`);
    return tooltip;
  }

  if (pkg.hasBreakingChanges) {
    tooltip.appendMarkdown("**Breaking changes:**\n");
    const changes = pkg.breakingChanges ?? [];
    const max = Math.min(changes.length, 3);
    for (let i = 0; i < max; i += 1) {
      tooltip.appendMarkdown(`- ${changes[i].description}\n`);
    }
    if (changes.length > 3) {
      tooltip.appendMarkdown("- ...\n");
    }
    if (pkg.migrationSteps?.length) {
      tooltip.appendMarkdown("\n**Migration:**\n");
      tooltip.appendMarkdown(pkg.migrationSteps.slice(0, 3).map((step) => `- ${step}`).join("\n"));
    }
  } else if (pkg.hasBreakingChanges === false) {
    tooltip.appendMarkdown("No breaking changes detected.");
  } else {
    tooltip.appendMarkdown("Breaking changes: pending...");
  }

  return tooltip;
}
