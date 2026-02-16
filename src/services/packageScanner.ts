import * as fs from "fs/promises";
import * as path from "path";
import ncu from "npm-check-updates";
import { PackageInfo, ScanResult, WorkspaceRoot } from "../types";
import { TimedCache } from "../utils/cache";
import { fetchPackageInfo } from "./npmRegistry";
import { getUpdateType, normalizeVersion } from "../utils/version";

const cache = new TimedCache<ScanResult>(15);

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface PackageLock {
  packages?: Record<string, { version?: string }>;
}

export async function scanWorkspace(
  root: WorkspaceRoot,
  includeDevDependencies: boolean
): Promise<ScanResult> {
  const cacheKey = `${root.fsPath}|${includeDevDependencies}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const packageJsonPath = path.join(root.fsPath, "package.json");
  const packageLockPath = path.join(root.fsPath, "package-lock.json");

  try {
    const packageJsonRaw = await fs.readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(packageJsonRaw) as PackageJson;
    const deps = {
      ...(packageJson.dependencies ?? {}),
      ...(includeDevDependencies ? packageJson.devDependencies ?? {} : {})
    };

    const lockVersions = await readLockVersions(packageLockPath);
    const packageData = JSON.stringify({
      dependencies: packageJson.dependencies ?? {},
      devDependencies: includeDevDependencies ? packageJson.devDependencies ?? {} : {}
    });

    let upgrades: Record<string, string> = {};
    let offline = false;

    try {
      upgrades = (await ncu({
        packageData,
        jsonUpgraded: true,
        silent: true
      })) as Record<string, string>;
    } catch (error) {
      offline = true;
    }

    const packages: PackageInfo[] = [];

    for (const [name, currentRange] of Object.entries(deps)) {
      let latest = upgrades[name];

      if (!latest) {
        try {
          const info = await fetchPackageInfo(name);
          latest = info.latest;
        } catch (error) {
          offline = true;
          latest = normalizeVersion(currentRange);
        }
      }

      const currentVersion = lockVersions[name] || normalizeVersion(currentRange);
      if (normalizeVersion(latest) === normalizeVersion(currentVersion)) {
        continue;
      }

      packages.push({
        name,
        currentVersion,
        latestVersion: normalizeVersion(latest),
        updateType: getUpdateType(currentVersion, latest),
        lastChecked: new Date()
      });
    }

    const result: ScanResult = {
      root,
      packages,
      hasPackageJson: true,
      offline
    };
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    const result: ScanResult = {
      root,
      packages: [],
      hasPackageJson: false,
      offline: false
    };
    cache.set(cacheKey, result);
    return result;
  }
}

export function clearScanCache(): void {
  cache.clear();
}

async function readLockVersions(lockPath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const lock = JSON.parse(raw) as PackageLock;
    const versions: Record<string, string> = {};
    if (!lock.packages) return versions;

    for (const [key, value] of Object.entries(lock.packages)) {
      if (!key.startsWith("node_modules/")) continue;
      const name = key.replace("node_modules/", "");
      if (value.version) {
        versions[name] = value.version;
      }
    }

    return versions;
  } catch (error) {
    return {};
  }
}
