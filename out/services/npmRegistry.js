"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPackageInfo = fetchPackageInfo;
async function fetchPackageInfo(name) {
    const response = await fetch(`https://registry.npmjs.org/${name}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch ${name} from npm registry`);
    }
    const data = await response.json();
    return {
        latest: data["dist-tags"].latest,
        versions: Object.keys(data.versions)
    };
}
//# sourceMappingURL=npmRegistry.js.map