"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingCopilotTokenError = exports.CopilotAnalyzer = void 0;
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
class CopilotAnalyzer {
    context;
    tokenProvider;
    client;
    constructor(context, tokenProvider) {
        this.context = context;
        this.tokenProvider = tokenProvider;
    }
    async analyzeUpdate(pkg, from, to) {
        const client = await this.getClient();
        const session = await withTimeout(client.createSession({
            systemMessage: "You must respond with ONLY valid JSON and no extra text, markdown, or code fences."
        }), 15000, "creating Copilot session");
        const prompt = [
            `Analyze breaking changes between ${pkg}@${from} and ${pkg}@${to}.`,
            "Respond with ONLY valid JSON that matches this schema:",
            JSON.stringify(copilotAnalysisSchema),
            "Do not include markdown or extra text."
        ].join("\n");
        try {
            const message = await withRetry(() => session.sendAndWait({ prompt }, 60000));
            const content = message?.data?.content ?? "";
            return parseJsonResponse(content);
        }
        finally {
            await session.destroy().catch(() => undefined);
        }
    }
    async generateMigration(input) {
        const client = await this.getClient();
        const session = await withTimeout(client.createSession({
            systemMessage: "You must respond with ONLY valid JSON and no extra text, markdown, or code fences."
        }), 15000, "creating Copilot session");
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
            const parsed = parseJsonResponse(content);
            return parsed.suggestedChanges ?? [];
        }
        finally {
            await session.destroy().catch(() => undefined);
        }
    }
    async getClient() {
        if (this.client)
            return this.client;
        const token = await this.tokenProvider();
        if (!token) {
            throw new MissingCopilotTokenError();
        }
        const mod = await dynamicImport("@github/copilot-sdk");
        const CopilotClient = mod.CopilotClient || mod.default;
        if (!CopilotClient) {
            throw new Error("Copilot SDK not available");
        }
        this.client = new CopilotClient({
            githubToken: token,
            useLoggedInUser: false,
            logLevel: "error"
        });
        return this.client;
    }
}
exports.CopilotAnalyzer = CopilotAnalyzer;
async function withRetry(fn, maxAttempts = 3) {
    let attempt = 0;
    let lastError;
    while (attempt < maxAttempts) {
        attempt += 1;
        try {
            return await withTimeout(fn(), 30000);
        }
        catch (error) {
            lastError = error;
            await delay(500 * attempt);
        }
    }
    throw lastError;
}
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function withTimeout(promise, ms, label) {
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
class MissingCopilotTokenError extends Error {
    constructor() {
        super("Copilot token not available");
        this.name = "MissingCopilotTokenError";
    }
}
exports.MissingCopilotTokenError = MissingCopilotTokenError;
async function dynamicImport(specifier) {
    const importer = new Function("s", "return import(s);");
    return importer(specifier);
}
function parseJsonResponse(content) {
    const trimmed = content.trim();
    const fenced = extractJsonFromFence(trimmed);
    const extracted = fenced ?? extractJsonObject(trimmed) ?? trimmed;
    const payload = extracted;
    try {
        return JSON.parse(payload);
    }
    catch (error) {
        const snippet = trimmed.slice(0, 200).replace(/\\s+/g, " ");
        throw new Error(`Invalid JSON response from Copilot: ${snippet}`);
    }
}
function extractJsonFromFence(content) {
    const match = content.match(/```json\\s*([\\s\\S]*?)\\s*```/i);
    if (match && match[1])
        return match[1];
    return undefined;
}
function extractJsonObject(content) {
    const first = content.indexOf("{");
    const last = content.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first)
        return undefined;
    return content.slice(first, last + 1);
}
//# sourceMappingURL=copilotAnalyzer.js.map