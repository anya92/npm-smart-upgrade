import { execFile } from "node:child_process";
import { promisify } from "node:util";
import semver from "semver";

const execFileAsync = promisify(execFile);

export interface CopilotCliStatus {
  supported: boolean;
  version?: string;
  error?: string;
}

export async function checkCopilotCli(): Promise<CopilotCliStatus> {
  const status: CopilotCliStatus = { supported: false };
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

function isVersionAtLeast(version: string, min: string): boolean {
  const parsed = semver.coerce(version);
  if (!parsed) return false;
  return semver.gte(parsed, min);
}
