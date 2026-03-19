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
4) summary_zh 必须“详细且可落地”，至少覆盖：总体变化、重点变更、影响范围、建议执行步骤。
5) summary_zh 尽量使用多段文本，建议 4 到 8 条要点，总长度建议不少于 140 个中文字符。
6) 不要空泛描述，必须体现具体改动点（如组件、命令、配置、行为变化）。
7) 仅输出 JSON，不要输出 Markdown、代码块或额外解释。
8) risk_level 只能是 low/medium/high/unknown，confidence 在 0 到 1。`;

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
        summary_zh:
          "多段中文详细总结，至少包含总体变化/重点变更/影响范围/执行建议",
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

function buildFallbackList(items: string[], emptyText: string): string {
  if (items.length === 0) {
    return `- ${emptyText}`;
  }
  return items.slice(0, 5).map((item) => `- ${item}`).join("\n");
}

function enhanceSummaryDetail(parsed: {
  summary_zh: string;
  breaking_changes: string[];
  upgrade_actions: string[];
}): string {
  const summary = parsed.summary_zh.trim();
  if (summary.length >= 140) {
    return summary;
  }

  const sections = [
    summary,
    "",
    "影响与风险关注点：",
    buildFallbackList(
      parsed.breaking_changes,
      "发布说明未明确标注破坏性变更，建议按核心链路做回归验证。",
    ),
    "",
    "建议执行步骤：",
    buildFallbackList(
      parsed.upgrade_actions,
      "先在测试环境完成功能回归与依赖兼容性验证，再安排生产升级窗口。",
    ),
  ];

  return sections.join("\n").trim();
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

      const detailedSummary = enhanceSummaryDetail(parsed.data);

      return {
        ...parsed.data,
        summary_zh: detailedSummary,
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
