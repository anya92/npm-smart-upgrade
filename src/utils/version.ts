import semver from "semver";
import { UpdateType } from "../types";

export function normalizeVersion(input: string): string {
  const cleaned = semver.coerce(input);
  return cleaned ? cleaned.version : input;
}

export function getUpdateType(current: string, latest: string): UpdateType {
  const currentNorm = normalizeVersion(current);
  const latestNorm = normalizeVersion(latest);
  const diff = semver.diff(currentNorm, latestNorm);
  if (diff === "major") return "major";
  if (diff === "minor") return "minor";
  return "patch";
}
