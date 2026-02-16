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
exports.PackageNode = exports.TreeNode = exports.PackageTreeProvider = void 0;
const vscode = __importStar(require("vscode"));
class PackageTreeProvider {
    _onDidChangeTreeData = new vscode.EventEmitter();
    onDidChangeTreeData = this._onDidChangeTreeData.event;
    data = [];
    copilotEnabled = false;
    hasGithubSession = false;
    copilotCliStatus;
    setData(data) {
        this.data = data;
        this.refresh();
    }
    setCopilotState(enabled, hasSession) {
        this.copilotEnabled = enabled;
        this.hasGithubSession = hasSession;
        this.refresh();
    }
    setCopilotCliStatus(status) {
        this.copilotCliStatus = status;
        this.refresh();
    }
    refresh() {
        this._onDidChangeTreeData.fire();
    }
    getTreeItem(element) {
        return element.item;
    }
    getChildren(element) {
        if (!element) {
            return Promise.resolve(this.getRootNodes());
        }
        return Promise.resolve(element.getChildren());
    }
    getRootNodes() {
        if (this.data.length === 0) {
            return [new MessageNode("No workspace folders found")];
        }
        const needsLogin = !this.copilotEnabled || (this.copilotEnabled && !this.hasGithubSession);
        const loginNode = needsLogin
            ? new LoginNode(this.copilotEnabled ? "Login with GitHub (+Copilot)" : "Enable Copilot Login")
            : null;
        const cliBanner = this.copilotEnabled && this.hasGithubSession && this.copilotCliStatus?.supported === false
            ? new CliBannerNode(this.copilotCliStatus)
            : null;
        if (this.data.length === 1) {
            const nodes = [...this.getCategoryNodes(this.data[0])];
            if (cliBanner)
                nodes.unshift(cliBanner);
            if (loginNode)
                nodes.unshift(loginNode);
            return nodes;
        }
        const roots = this.data.map((result) => new RootNode(result, this.getCategoryNodes(result)));
        const nodes = [...roots];
        if (cliBanner)
            nodes.unshift(cliBanner);
        if (loginNode)
            nodes.unshift(loginNode);
        return nodes;
    }
    getCategoryNodes(result) {
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
exports.PackageTreeProvider = PackageTreeProvider;
class TreeNode {
    item;
    constructor(item) {
        this.item = item;
    }
}
exports.TreeNode = TreeNode;
class RootNode extends TreeNode {
    result;
    children;
    constructor(result, children) {
        super(new vscode.TreeItem(result.root.name, vscode.TreeItemCollapsibleState.Expanded));
        this.result = result;
        this.children = children;
    }
    getChildren() {
        return this.children;
    }
}
class CategoryNode extends TreeNode {
    label;
    packages;
    copilotEnabled;
    hasGithubSession;
    constructor(label, packages, copilotEnabled, hasGithubSession) {
        super(new vscode.TreeItem(`${label} (${packages.length})`, vscode.TreeItemCollapsibleState.Expanded));
        this.label = label;
        this.packages = packages;
        this.copilotEnabled = copilotEnabled;
        this.hasGithubSession = hasGithubSession;
    }
    getChildren() {
        if (this.packages.length === 0) {
            return [new MessageNode("No updates")];
        }
        return this.packages.map((pkg) => new PackageNode(pkg, this.copilotEnabled, this.hasGithubSession));
    }
}
class PackageNode extends TreeNode {
    packageInfo;
    constructor(pkg, copilotEnabled, hasSession) {
        const item = new vscode.TreeItem(`${pkg.name} ${pkg.currentVersion} -> ${pkg.latestVersion}`, vscode.TreeItemCollapsibleState.None);
        const breakingLabel = !copilotEnabled
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
    getChildren() {
        return [];
    }
}
exports.PackageNode = PackageNode;
class MessageNode extends TreeNode {
    constructor(message) {
        super(new vscode.TreeItem(message, vscode.TreeItemCollapsibleState.None));
    }
    getChildren() {
        return [];
    }
}
class LoginNode extends TreeNode {
    constructor(label) {
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        item.command = {
            command: "npmVersionGuardian.loginWithGitHub",
            title: "Login with GitHub (+Copilot)"
        };
        super(item);
    }
    getChildren() {
        return [];
    }
}
class CliBannerNode extends TreeNode {
    constructor(status) {
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
    getChildren() {
        return [];
    }
}
function groupByUpdateType(packages) {
    const grouped = {
        major: [],
        minor: [],
        patch: []
    };
    for (const pkg of packages) {
        grouped[pkg.updateType].push(pkg);
    }
    return grouped;
}
function createTooltip(pkg, copilotEnabled, hasSession) {
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
    }
    else if (pkg.hasBreakingChanges === false) {
        tooltip.appendMarkdown("No breaking changes detected.");
    }
    else {
        tooltip.appendMarkdown("Breaking changes: pending...");
    }
    return tooltip;
}
//# sourceMappingURL=packageTreeProvider.js.map