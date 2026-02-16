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
const packageTreeProvider_1 = require("./providers/packageTreeProvider");
const copilotAnalyzer_1 = require("./services/copilotAnalyzer");
const packageScanner_1 = require("./services/packageScanner");
const workspaceLocator_1 = require("./services/workspaceLocator");
const terminal_1 = require("./utils/terminal");
const diffPreview_1 = require("./utils/diffPreview");
const copilotCliChecker_1 = require("./services/copilotCliChecker");
function activate(context) {
    const provider = new packageTreeProvider_1.PackageTreeProvider();
    const treeView = vscode.window.createTreeView("npmVersionGuardianView", {
        treeDataProvider: provider
    });
    const auth = new GithubAuthManager();
    const analyzer = new copilotAnalyzer_1.CopilotAnalyzer(context, () => auth.getToken());
    const controller = new GuardianController(context, provider, treeView, analyzer, auth);
    context.subscriptions.push(vscode.commands.registerCommand("npmVersionGuardian.refreshVersions", () => controller.refreshAll(true)), vscode.commands.registerCommand("npmVersionGuardian.updatePackage", (node) => controller.updatePackage(node)), vscode.commands.registerCommand("npmVersionGuardian.updateWithResolve", (node) => controller.updateWithResolve(node)), vscode.commands.registerCommand("npmVersionGuardian.loginWithGitHub", () => controller.loginWithGitHub()), vscode.commands.registerCommand("npmVersionGuardian.showCopilotCliHelp", () => controller.showCopilotCliHelp()), vscode.commands.registerCommand("npmVersionGuardian.showCopilotDetails", (pkg) => controller.showCopilotDetails(pkg)), vscode.commands.registerCommand("npmVersionGuardian.analyzePackage", (node) => controller.analyzePackage(node)));
    context.subscriptions.push(vscode.authentication.onDidChangeSessions((event) => {
        if (event.provider.id === "github") {
            controller.refreshAll(true).catch(() => undefined);
        }
    }));
    controller.refreshAll(false).catch(() => undefined);
    const intervalMinutes = getConfigNumber("scanInterval", 30);
    const timer = setInterval(() => {
        controller.refreshAll(false).catch(() => undefined);
    }, intervalMinutes * 60 * 1000);
    context.subscriptions.push({ dispose: () => clearInterval(timer) });
}
function deactivate() {
    (0, packageScanner_1.clearScanCache)();
}
class GuardianController {
    context;
    provider;
    treeView;
    analyzer;
    auth;
    lastResults = [];
    copilotEnabled = false;
    hasGithubSession = false;
    detailsDoc;
    detailsPackageName;
    constructor(context, provider, treeView, analyzer, auth) {
        this.context = context;
        this.provider = provider;
        this.treeView = treeView;
        this.analyzer = analyzer;
        this.auth = auth;
    }
    async refreshAll(force) {
        if (force) {
            (0, packageScanner_1.clearScanCache)();
        }
        const includeDev = getConfigBoolean("includeDevDependencies", true);
        const analyzeMinor = getConfigBoolean("analyzeMinorBreakingChanges", false);
        const autoUpdatePatch = getConfigBoolean("autoUpdatePatch", false);
        this.copilotEnabled = getConfigBoolean("enableCopilot", false);
        this.hasGithubSession = await this.auth.refreshSession(false);
        this.provider.setCopilotState(this.copilotEnabled, this.hasGithubSession);
        this.provider.setCopilotCliStatus(undefined);
        const roots = (0, workspaceLocator_1.getWorkspaceRoots)();
        const results = [];
        for (const root of roots) {
            const result = await (0, packageScanner_1.scanWorkspace)(root, includeDev);
            results.push(result);
        }
        this.lastResults = results;
        this.provider.setData(results);
        this.updateBadge(results);
        if (autoUpdatePatch) {
            await this.autoUpdatePatch(results);
        }
        if (this.copilotEnabled && this.hasGithubSession) {
            const cliStatus = await (0, copilotCliChecker_1.checkCopilotCli)();
            this.provider.setCopilotCliStatus(cliStatus);
            if (!cliStatus.supported) {
                this.markAnalysisError(results, analyzeMinor, cliStatus.error ?? "Copilot CLI not compatible");
            }
        }
        else if (this.copilotEnabled && !this.hasGithubSession) {
            this.markAnalysisError(results, analyzeMinor, "GitHub OAuth session missing");
        }
    }
    async updatePackage(node) {
        if (!node)
            return;
        const pkg = node.packageInfo;
        const root = this.findRootForPackage(pkg);
        if (!root)
            return;
        (0, terminal_1.runNpmInstall)(root.fsPath, pkg.name);
        vscode.window.showInformationMessage(`Running npm install for ${pkg.name}`);
    }
    async updateWithResolve(node) {
        if (!node)
            return;
        const pkg = node.packageInfo;
        const root = this.findRootForPackage(pkg);
        if (!root)
            return;
        if (pkg.analysisStatus !== "success") {
            vscode.window.showWarningMessage("Analysis not ready or failed. Please retry analysis.");
            return;
        }
        (0, terminal_1.runNpmInstall)(root.fsPath, pkg.name);
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
            await (0, diffPreview_1.showDiffPreview)(change);
        }
        const answer = await vscode.window.showInformationMessage("Apply suggested changes?", "Apply", "Cancel");
        if (answer === "Apply") {
            await (0, diffPreview_1.applyFileChanges)(suggestedChanges);
        }
    }
    async loginWithGitHub() {
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
    async showCopilotCliHelp() {
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
    async showCopilotDetails(pkg) {
        if (!pkg)
            return;
        if (this.copilotEnabled && this.hasGithubSession) {
            try {
                await this.ensureCopilotCliReady();
                if (!pkg.analysisStatus || pkg.analysisStatus === "error") {
                    await this.analyzeSinglePackage(pkg);
                }
            }
            catch (error) {
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
    async analyzePackage(node) {
        const pkg = node && "packageInfo" in node ? node.packageInfo : node;
        if (!pkg)
            return;
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
        }
        catch (error) {
            pkg.analysisStatus = "error";
            pkg.analysisError = error instanceof Error ? error.message : "Copilot CLI not compatible";
            this.updateDetailsPanel(pkg);
            this.provider.refresh();
        }
    }
    async analyzeBreakingChanges(results, analyzeMinor) {
        const targets = [];
        for (const result of results) {
            for (const pkg of result.packages) {
                if (pkg.updateType === "major" || (analyzeMinor && pkg.updateType === "minor")) {
                    targets.push(pkg);
                }
            }
        }
        if (targets.length === 0)
            return;
        const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
        status.text = "$(sync~spin) Analyzing breaking changes...";
        status.show();
        for (const pkg of targets) {
            await this.analyzeSinglePackage(pkg, status);
        }
        status.dispose();
    }
    async analyzeSinglePackage(pkg, status) {
        pkg.analysisStatus = "pending";
        pkg.analysisError = undefined;
        this.provider.refresh();
        this.updateDetailsPanel(pkg);
        if (status) {
            status.text = `$(sync~spin) Analyzing ${pkg.name}...`;
        }
        try {
            const analysis = await this.analyzer.analyzeUpdate(pkg.name, pkg.currentVersion, pkg.latestVersion);
            pkg.hasBreakingChanges = analysis.hasBreakingChanges;
            pkg.breakingChanges = analysis.breakingChanges;
            pkg.migrationSteps = analysis.migrationSteps;
            pkg.confidenceScore = analysis.confidenceScore;
            pkg.analysisStatus = "success";
            pkg.analysisError = undefined;
            this.updateDetailsPanel(pkg);
        }
        catch (error) {
            if (error instanceof copilotAnalyzer_1.MissingCopilotTokenError) {
                pkg.analysisStatus = "error";
                pkg.analysisError = "GitHub OAuth session missing";
            }
            else {
                pkg.analysisStatus = "error";
                pkg.analysisError = error instanceof Error ? error.message : "Analysis failed";
            }
            this.updateDetailsPanel(pkg);
        }
        this.provider.refresh();
    }
    async ensureCopilotCliReady() {
        const cliStatus = await (0, copilotCliChecker_1.checkCopilotCli)();
        this.provider.setCopilotCliStatus(cliStatus);
        if (!cliStatus.supported) {
            throw new Error(cliStatus.error ?? "Copilot CLI not compatible");
        }
    }
    markAnalysisError(results, analyzeMinor, message) {
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
    updateDetailsPanel(pkg) {
        if (!this.detailsDoc || this.detailsPackageName !== pkg.name)
            return;
        const content = this.buildCopilotDetailsContent(pkg);
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(this.detailsDoc.positionAt(0), this.detailsDoc.positionAt(this.detailsDoc.getText().length));
        edit.replace(this.detailsDoc.uri, fullRange, content);
        vscode.workspace.applyEdit(edit).then(() => undefined);
    }
    buildCopilotDetailsContent(pkg) {
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
    updateBadge(results) {
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
    async autoUpdatePatch(results) {
        for (const result of results) {
            for (const pkg of result.packages) {
                if (pkg.updateType === "patch") {
                    (0, terminal_1.runNpmInstall)(result.root.fsPath, pkg.name);
                }
            }
        }
    }
    findRootForPackage(pkg) {
        for (const result of this.lastResults) {
            if (result.packages.includes(pkg))
                return result.root;
        }
        return undefined;
    }
}
class GithubAuthManager {
    session;
    scopes = ["read:user"];
    async refreshSession(createIfNone) {
        try {
            this.session = await vscode.authentication.getSession("github", this.scopes, {
                createIfNone
            });
            return !!this.session;
        }
        catch {
            this.session = undefined;
            return false;
        }
    }
    async getToken() {
        if (this.session)
            return this.session.accessToken;
        await this.refreshSession(false);
        return this.session ? this.session.accessToken : undefined;
    }
}
function getConfigNumber(key, fallback) {
    const value = vscode.workspace.getConfiguration("npmVersionGuardian").get(key);
    return typeof value === "number" ? value : fallback;
}
function getConfigBoolean(key, fallback) {
    const value = vscode.workspace.getConfiguration("npmVersionGuardian").get(key);
    return typeof value === "boolean" ? value : fallback;
}
//# sourceMappingURL=extension.js.map