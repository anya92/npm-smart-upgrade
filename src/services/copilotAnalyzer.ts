import * as vscode from "vscode";
import { CopilotAnalysisResult, FileChange } from "../types";

interface CopilotClientLike {
  createSession(config?: { model?: string; systemMessage?: string }): Promise<CopilotSessionLike>;
}

interface CopilotSessionLike {
  sendAndWait(
    options: { prompt: string; mode?: string },
    timeout?: number
  ): Promise<{ data?: { content?: string } } | undefined>;
  destroy(): Promise<void>;
}

const copilotAnalysisSchema = {
  type: "object",
  properties: {
    hasBreakingChanges: { type: "boolean" },
    breakingChanges: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          severity: { type: "string" },
          migrationExample: { type: "string" }
        },
        required: ["description", "severity"]
      }
    },
    migrationSteps: { type: "array", items: { type: "string" } },
    confidenceScore: { type: "number" }
  },
  required: ["hasBreakingChanges", "breakingChanges", "migrationSteps", "confidenceScore"]
};

export class CopilotAnalyzer {
  private client: CopilotClientLike | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly tokenProvider: () => Promise<string | undefined>
  ) {}

  async analyzeUpdate(pkg: string, from: string, to: string): Promise<CopilotAnalysisResult> {
    const client = await this.getClient();
    const session = await withTimeout(
      client.createSession({
        systemMessage:
          "You must respond with ONLY valid JSON and no extra text, markdown, or code fences."
      }),
      15000,
      "creating Copilot session"
    );
    const prompt = [
      `Analyze breaking changes between ${pkg}@${from} and ${pkg}@${to}.`,
      "Respond with ONLY valid JSON that matches this schema:",
      JSON.stringify(copilotAnalysisSchema),
      "Do not include markdown or extra text."
    ].join("\n");

    try {
      const message = await withRetry(() => session.sendAndWait({ prompt }, 60000));
      const content = message?.data?.content ?? "";
      return parseJsonResponse<CopilotAnalysisResult>(content);
    } finally {
      await session.destroy().catch(() => undefined);
    }
  }

  async generateMigration(input: {
    packageName: string;
    currentVersion: string;
    targetVersion: string;
    breakingChanges: string[];
    codebaseFiles: string[];
  }): Promise<FileChange[]> {
    const client = await this.getClient();
    const session = await withTimeout(
      client.createSession({
        systemMessage:
          "You must respond with ONLY valid JSON and no extra text, markdown, or code fences."
      }),
      15000,
      "creating Copilot session"
    );
    const prompt = [
      `Generate migration suggestions for ${input.packageName} from ${input.currentVersion} to ${input.targetVersion}.`,
      "Breaking changes:",
      input.breakingChanges.map((c) => `- ${c}`).join("\n"),
      "Respond with ONLY valid JSON in this shape:",
      JSON.stringify({
        suggestedChanges: [
          {
            filePath: "string",
            originalCode: "string",
            suggestedCode: "string",
            lineStart: 1,
            lineEnd: 1
          }
        ]
      }),
      "Do not include markdown or extra text."
    ].join("\n");

    try {
      const message = await withRetry(() => session.sendAndWait({ prompt }, 60000));
      const content = message?.data?.content ?? "";
      const parsed = parseJsonResponse<{ suggestedChanges?: FileChange[] }>(content);
      return parsed.suggestedChanges ?? [];
    } finally {
      await session.destroy().catch(() => undefined);
    }
  }

  private async getClient(): Promise<CopilotClientLike> {
    if (this.client) return this.client;

    const token = await this.tokenProvider();

    if (!token) {
      throw new MissingCopilotTokenError();
    }

    const mod: any = await dynamicImport("@github/copilot-sdk");
    const CopilotClient = mod.CopilotClient || mod.default;
    if (!CopilotClient) {
      throw new Error("Copilot SDK not available");
    }

    this.client = new CopilotClient({
      githubToken: token,
      useLoggedInUser: false,
      logLevel: "error"
    });

    return this.client!;
  }
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await withTimeout(fn(), 30000);
    } catch (error) {
      lastError = error;
      await delay(500 * attempt);
    }
  }

  throw lastError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const suffix = label ? ` during ${label}` : "";
      reject(new Error(`Copilot request timeout after ${ms}ms${suffix}`));
    }, ms);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export class MissingCopilotTokenError extends Error {
  constructor() {
    super("Copilot token not available");
    this.name = "MissingCopilotTokenError";
  }
}

async function dynamicImport(specifier: string): Promise<unknown> {
  const importer = new Function("s", "return import(s);");
  return importer(specifier) as Promise<unknown>;
}

function parseJsonResponse<T>(content: string): T {
  const trimmed = content.trim();
  const fenced = extractJsonFromFence(trimmed);
  const extracted = fenced ?? extractJsonObject(trimmed) ?? trimmed;
  const payload = extracted;
  try {
    return JSON.parse(payload) as T;
  } catch (error) {
    const snippet = trimmed.slice(0, 200).replace(/\\s+/g, " ");
    throw new Error(`Invalid JSON response from Copilot: ${snippet}`);
  }
}

function extractJsonFromFence(content: string): string | undefined {
  const match = content.match(/```json\\s*([\\s\\S]*?)\\s*```/i);
  if (match && match[1]) return match[1];
  return undefined;
}

function extractJsonObject(content: string): string | undefined {
  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return undefined;
  return content.slice(first, last + 1);
}
