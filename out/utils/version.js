"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeVersion = normalizeVersion;
exports.getUpdateType = getUpdateType;
const semver_1 = __importDefault(require("semver"));
function normalizeVersion(input) {
    const cleaned = semver_1.default.coerce(input);
    return cleaned ? cleaned.version : input;
}
function getUpdateType(current, latest) {
    const currentNorm = normalizeVersion(current);
    const latestNorm = normalizeVersion(latest);
    const diff = semver_1.default.diff(currentNorm, latestNorm);
    if (diff === "major")
        return "major";
    if (diff === "minor")
        return "minor";
    return "patch";
}
//# sourceMappingURL=version.js.map