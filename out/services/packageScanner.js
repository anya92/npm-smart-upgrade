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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanWorkspace = scanWorkspace;
exports.clearScanCache = clearScanCache;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const npm_check_updates_1 = __importDefault(require("npm-check-updates"));
const cache_1 = require("../utils/cache");
const npmRegistry_1 = require("./npmRegistry");
const version_1 = require("../utils/version");
const cache = new cache_1.TimedCache(15);
async function scanWorkspace(root, includeDevDependencies) {
    const cacheKey = `${root.fsPath}|${includeDevDependencies}`;
    const cached = cache.get(cacheKey);
    if (cached)
        return cached;
    const packageJsonPath = path.join(root.fsPath, "package.json");
    const packageLockPath = path.join(root.fsPath, "package-lock.json");
    try {
        const packageJsonRaw = await fs.readFile(packageJsonPath, "utf8");
        const packageJson = JSON.parse(packageJsonRaw);
        const deps = {
            ...(packageJson.dependencies ?? {}),
            ...(includeDevDependencies ? packageJson.devDependencies ?? {} : {})
        };
        const lockVersions = await readLockVersions(packageLockPath);
        const packageData = JSON.stringify({
            dependencies: packageJson.dependencies ?? {},
            devDependencies: includeDevDependencies ? packageJson.devDependencies ?? {} : {}
        });
        let upgrades = {};
        let offline = false;
        try {
            upgrades = (await (0, npm_check_updates_1.default)({
                packageData,
                jsonUpgraded: true,
                silent: true
            }));
        }
        catch (error) {
            offline = true;
        }
        const packages = [];
        for (const [name, currentRange] of Object.entries(deps)) {
            let latest = upgrades[name];
            if (!latest) {
                try {
                    const info = await (0, npmRegistry_1.fetchPackageInfo)(name);
                    latest = info.latest;
                }
                catch (error) {
                    offline = true;
                    latest = (0, version_1.normalizeVersion)(currentRange);
                }
            }
            const currentVersion = lockVersions[name] || (0, version_1.normalizeVersion)(currentRange);
            if ((0, version_1.normalizeVersion)(latest) === (0, version_1.normalizeVersion)(currentVersion)) {
                continue;
            }
            packages.push({
                name,
                currentVersion,
                latestVersion: (0, version_1.normalizeVersion)(latest),
                updateType: (0, version_1.getUpdateType)(currentVersion, latest),
                lastChecked: new Date()
            });
        }
        const result = {
            root,
            packages,
            hasPackageJson: true,
            offline
        };
        cache.set(cacheKey, result);
        return result;
    }
    catch (error) {
        const result = {
            root,
            packages: [],
            hasPackageJson: false,
            offline: false
        };
        cache.set(cacheKey, result);
        return result;
    }
}
function clearScanCache() {
    cache.clear();
}
async function readLockVersions(lockPath) {
    try {
        const raw = await fs.readFile(lockPath, "utf8");
        const lock = JSON.parse(raw);
        const versions = {};
        if (!lock.packages)
            return versions;
        for (const [key, value] of Object.entries(lock.packages)) {
            if (!key.startsWith("node_modules/"))
                continue;
            const name = key.replace("node_modules/", "");
            if (value.version) {
                versions[name] = value.version;
            }
        }
        return versions;
    }
    catch (error) {
        return {};
    }
}
//# sourceMappingURL=packageScanner.js.map