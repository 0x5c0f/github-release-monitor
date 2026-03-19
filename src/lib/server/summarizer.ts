import "server-only";

import OpenAI from "openai";

import { aiOutputSchema } from "@/lib/schemas";
import type { GithubRelease } from "@/lib/types";

import { ApiError } from "./errors";
import { getServerEnv } from "./env";

const SYSTEM_PROMPT = `你是资深发布说明分析助手。你的任务是将 GitHub Release 内容转为中文技术摘要。
要求：
1) 自动识别原文语言。
2) 非中文内容翻译为简体中文，保留版本号、API 名、命令、路径、函数名。
3) 输出面向工程团队可执行的信息：关键更新、破坏性变更、升级动作。
4) 仅输出 JSON，不要输出 Markdown、代码块或额外解释。
5) risk_level 只能是 low/medium/high/unknown，confidence 在 0 到 1。`;

function normalizeReleaseBody(body: string | null): string {
  if (!body || body.trim().length === 0) {
    return "（该版本未提供详细 release notes）";
  }
  return body.trim();
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new ApiError(502, "AI_EMPTY_OUTPUT", "AI 返回为空。");
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  throw new ApiError(502, "AI_NON_JSON", "AI 未返回有效 JSON。");
}

function createOpenAIClient(): OpenAI {
  const env = getServerEnv();
  return new OpenAI({
    apiKey: env.openaiApiKey,
    baseURL: env.openaiBaseUrl ?? undefined,
    timeout: 90000,
  });
}

function buildUserPrompt(repo: string, release: GithubRelease): string {
  return [
    `repo: ${repo}`,
    `release_id: ${release.id}`,
    `tag: ${release.tag_name}`,
    `name: ${release.name ?? ""}`,
    `published_at: ${release.published_at ?? ""}`,
    `prerelease: ${String(release.prerelease)}`,
    `url: ${release.html_url}`,
    "",
    "release_notes:",
    normalizeReleaseBody(release.body),
    "",
    "请严格输出 JSON，字段如下：",
    JSON.stringify(
      {
        language_detected: "en",
        translated_text_zh: "string",
        summary_zh: "string",
        breaking_changes: ["string"],
        upgrade_actions: ["string"],
        risk_level: "low|medium|high|unknown",
        confidence: 0.5,
      },
      null,
      2,
    ),
  ].join("\n");
}

function isLikelyResponseFormatError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("invalid input") ||
    message.includes("response_format") ||
    message.includes("json_object")
  );
}

export async function summarizeRelease(
  repo: string,
  release: GithubRelease,
): Promise<{
  language_detected: string;
  translated_text_zh: string;
  summary_zh: string;
  breaking_changes: string[];
  upgrade_actions: string[];
  risk_level: "low" | "medium" | "high" | "unknown";
  confidence: number;
  model: string;
}> {
  const env = getServerEnv();
  const client = createOpenAIClient();
  const userPrompt = buildUserPrompt(repo, release);

  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const messages = [
        { role: "system" as const, content: SYSTEM_PROMPT },
        {
          role: "user" as const,
          content:
            attempt === 0
              ? userPrompt
              : `${userPrompt}\n\n注意：上一次输出无法解析，请只输出合法 JSON 对象。`,
        },
      ];

      let completion;
      try {
        completion = await client.chat.completions.create({
          model: env.openaiModel,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages,
        });
      } catch (error) {
        // Some OpenAI-compatible gateways reject response_format=json_object.
        if (!isLikelyResponseFormatError(error)) {
          throw error;
        }

        completion = await client.chat.completions.create({
          model: env.openaiModel,
          temperature: 0.1,
          messages,
        });
      }

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new ApiError(502, "AI_EMPTY_OUTPUT", "AI 返回为空。");
      }

      const parsedJson = JSON.parse(extractJsonObject(content));
      const parsed = aiOutputSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new ApiError(
          502,
          "AI_SCHEMA_INVALID",
          "AI 返回字段不符合预期。",
          parsed.error.flatten(),
        );
      }

      return {
        ...parsed.data,
        model: completion.model ?? env.openaiModel,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof ApiError) {
    throw lastError;
  }
  if (lastError instanceof Error) {
    throw new ApiError(502, "AI_REQUEST_FAILED", `AI 调用失败：${lastError.message}`);
  }
  throw new ApiError(502, "AI_REQUEST_FAILED", "AI 调用失败。");
}
