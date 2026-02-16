"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkCopilotCli = checkCopilotCli;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const semver_1 = __importDefault(require("semver"));
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
async function checkCopilotCli() {
    const status = { supported: false };
    const minHeadlessVersion = "0.0.405";
    const [helpResult, versionResult] = await Promise.allSettled([
        execFileAsync("copilot", ["--help"], { timeout: 5000 }),
        execFileAsync("copilot", ["--version"], { timeout: 5000 })
    ]);
    if (versionResult.status === "fulfilled") {
        status.version = versionResult.value.stdout.trim() || versionResult.value.stderr.trim();
    }
    if (helpResult.status !== "fulfilled") {
        const stderr = helpResult.reason instanceof Error ? helpResult.reason.message : String(helpResult.reason);
        const versionOk = status.version ? isVersionAtLeast(status.version, minHeadlessVersion) : false;
        if (versionOk) {
            return { supported: true, version: status.version };
        }
        status.error = stderr.includes("SecItemCopyMatching")
            ? "Copilot CLI help failed due to keychain access"
            : "Copilot CLI not found or failed to run";
        return status;
    }
    const helpText = `${helpResult.value.stdout}\n${helpResult.value.stderr}`;
    if (helpText.includes("--headless")) {
        return { supported: true, version: status.version };
    }
    if (status.version && isVersionAtLeast(status.version, minHeadlessVersion)) {
        return { supported: true, version: status.version };
    }
    status.error = "Copilot CLI missing --headless";
    return status;
}
function isVersionAtLeast(version, min) {
    const parsed = semver_1.default.coerce(version);
    if (!parsed)
        return false;
    return semver_1.default.gte(parsed, min);
}
//# sourceMappingURL=copilotCliChecker.js.map