export type UpdateType = "patch" | "minor" | "major";

export interface PackageInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  updateType: UpdateType;
  hasBreakingChanges?: boolean;
  breakingChanges?: BreakingChange[];
  migrationSteps?: string[];
  confidenceScore?: number;
  analysisStatus?: "pending" | "success" | "error";
  analysisError?: string;
  lastChecked: Date;
}

export interface BreakingChange {
  description: string;
  severity: "low" | "medium" | "high";
  migrationExample?: string;
}

export interface CopilotAnalysisResult {
  hasBreakingChanges: boolean;
  breakingChanges: BreakingChange[];
  migrationSteps: string[];
  confidenceScore: number;
  suggestedCodeChanges?: FileChange[];
}

export interface FileChange {
  filePath: string;
  originalCode: string;
  suggestedCode: string;
  lineStart: number;
  lineEnd: number;
}

export interface WorkspaceRoot {
  name: string;
  fsPath: string;
}

export interface ScanResult {
  root: WorkspaceRoot;
  packages: PackageInfo[];
  hasPackageJson: boolean;
  offline: boolean;
}

export interface CopilotCliStatus {
  supported: boolean;
  version?: string;
  error?: string;
}
