import "server-only";

import OpenAI from "openai";

import { aiOutputSchema } from "@/lib/schemas";
import type { GithubRelease } from "@/lib/types";

import { ApiError } from "./errors";
import { getServerEnv } from "./env";

const TRANSLATION_SYSTEM_PROMPT = `你是专业技术翻译引擎。请将输入内容完整翻译为简体中文。
硬性要求：
1) 必须完整翻译，不允许省略、总结、改写或跳过任何条目。
2) 保留原有结构（标题、列表、段落顺序）。
3) 保留版本号、命令、路径、函数名、配置键名、URL。
4) 如果原文已经是简体中文，则原样输出（仅做极小格式修正）。
5) 只输出翻译结果正文，不要输出任何说明。`;

const SUMMARY_SYSTEM_PROMPT = `你是资深发布说明分析助手。请基于“完整中文译文”提炼工程团队可执行摘要。
要求：
1) 仅输出 JSON，不要输出 Markdown、代码块或额外解释。
2) summary_zh 写成较完整的中文总结（不要一句话带过）。
3) breaking_changes / upgrade_actions 尽量给可执行条目；没有就输出空数组。
4) risk_level 只能是 low/medium/high/unknown，confidence 在 0 到 1。`;

const TRANSLATION_CHUNK_MAX_CHARS = 7000;
const TRANSLATION_RETRY_CHUNK_MAX_CHARS = 4200;

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
    timeout: env.openaiTimeoutMs,
    maxRetries: env.openaiMaxRetries,
  });
}

function buildTranslationPrompt(params: {
  repo: string;
  release: GithubRelease;
  chunk: string;
  index: number;
  total: number;
}): string {
  return [
    `repo: ${params.repo}`,
    `release_id: ${params.release.id}`,
    `tag: ${params.release.tag_name}`,
    `name: ${params.release.name ?? ""}`,
    `published_at: ${params.release.published_at ?? ""}`,
    `prerelease: ${String(params.release.prerelease)}`,
    `url: ${params.release.html_url}`,
    `chunk: ${params.index + 1}/${params.total}`,
    "",
    "请完整翻译下面这一段 release notes，不要做总结：",
    params.chunk,
  ].join("\n");
}

function stripWhitespace(text: string): string {
  return text.replace(/\s+/g, "");
}

function countPattern(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function detectSourceLanguage(text: string): string {
  const zhCount = countPattern(text, /[\u3400-\u9fff]/g);
  const latinCount = countPattern(text, /[a-zA-Z]/g);

  if (zhCount >= 30 && zhCount >= latinCount) {
    return "zh";
  }
  if (latinCount >= 30) {
    return "en";
  }
  if (zhCount > 0) {
    return "zh";
  }
  return "unknown";
}

function isTranslationLikelyIncomplete(
  source: string,
  translated: string,
): boolean {
  const normalizedSource = stripWhitespace(source);
  const normalizedTranslated = stripWhitespace(translated);
  if (normalizedSource.length < 1200) {
    return false;
  }

  // Very short translated output against long source likely means summarization happened.
  if (normalizedTranslated.length < normalizedSource.length * 0.42) {
    return true;
  }

  const sourceBullets = countPattern(source, /^\s*[-*+]\s+/gm);
  const translatedBullets = countPattern(translated, /^\s*[-*+]\s+/gm);
  if (sourceBullets >= 8 && translatedBullets < sourceBullets * 0.5) {
    return true;
  }

  const sourceHeadings = countPattern(source, /^#{1,6}\s+/gm);
  const translatedHeadings = countPattern(translated, /^#{1,6}\s+/gm);
  if (sourceHeadings >= 2 && translatedHeadings < sourceHeadings * 0.5) {
    return true;
  }

  if (translated.includes("关键更新包括") && translated.length < source.length * 0.55) {
    return true;
  }

  return false;
}

function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim().length > 0) {
      chunks.push(current.trim());
      current = "";
    }
  };

  for (const paragraph of paragraphs) {
    const candidate = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }

    pushCurrent();
    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    let rest = paragraph;
    while (rest.length > maxChars) {
      chunks.push(rest.slice(0, maxChars));
      rest = rest.slice(maxChars);
    }
    current = rest;
  }

  pushCurrent();
  return chunks.length > 0 ? chunks : [text];
}

async function translateByChunks(params: {
  client: OpenAI;
  model: string;
  repo: string;
  release: GithubRelease;
  releaseBody: string;
  chunkMaxChars: number;
}): Promise<string> {
  const chunks = splitTextIntoChunks(params.releaseBody, params.chunkMaxChars);
  const translatedChunks: string[] = [];

  for (let index = 0; index < chunks.length; index += 1) {
    const completion = await params.client.chat.completions.create({
      model: params.model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: TRANSLATION_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildTranslationPrompt({
            repo: params.repo,
            release: params.release,
            chunk: chunks[index],
            index,
            total: chunks.length,
          }),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new ApiError(502, "AI_EMPTY_OUTPUT", "AI 返回为空。");
    }
    translatedChunks.push(content);
  }

  return translatedChunks.join("\n\n");
}

async function ensureCompleteTranslation(params: {
  client: OpenAI;
  model: string;
  repo: string;
  release: GithubRelease;
  releaseBody: string;
  detectedLanguage: string;
}): Promise<string> {
  if (params.detectedLanguage.startsWith("zh")) {
    return params.releaseBody;
  }

  const firstPass = await translateByChunks({
    client: params.client,
    model: params.model,
    repo: params.repo,
    release: params.release,
    releaseBody: params.releaseBody,
    chunkMaxChars: TRANSLATION_CHUNK_MAX_CHARS,
  });

  if (!isTranslationLikelyIncomplete(params.releaseBody, firstPass)) {
    return firstPass;
  }

  const secondPass = await translateByChunks({
    client: params.client,
    model: params.model,
    repo: params.repo,
    release: params.release,
    releaseBody: params.releaseBody,
    chunkMaxChars: TRANSLATION_RETRY_CHUNK_MAX_CHARS,
  });

  if (isTranslationLikelyIncomplete(params.releaseBody, secondPass)) {
    throw new ApiError(
      502,
      "AI_TRANSLATION_INCOMPLETE",
      "AI 返回的全文翻译不完整，请稍后重试或切换模型。",
    );
  }

  return secondPass;
}

function buildSummaryPrompt(params: {
  repo: string;
  release: GithubRelease;
  translatedTextZh: string;
}): string {
  return [
    `repo: ${params.repo}`,
    `release_id: ${params.release.id}`,
    `tag: ${params.release.tag_name}`,
    `name: ${params.release.name ?? ""}`,
    `published_at: ${params.release.published_at ?? ""}`,
    `prerelease: ${String(params.release.prerelease)}`,
    `url: ${params.release.html_url}`,
    "",
    "下面是该版本 release notes 的完整中文译文：",
    params.translatedTextZh,
    "",
    "请严格输出 JSON，字段如下：",
    JSON.stringify(
      {
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

async function summarizeFromTranslatedText(params: {
  client: OpenAI;
  model: string;
  repo: string;
  release: GithubRelease;
  translatedTextZh: string;
  detectedLanguage: string;
}): Promise<{
  language_detected: string;
  translated_text_zh: string;
  summary_zh: string;
  breaking_changes: string[];
  upgrade_actions: string[];
  risk_level: "low" | "medium" | "high" | "unknown";
  confidence: number;
  model: string;
}> {
  const completion = await params.client.chat.completions.create({
    model: params.model,
    temperature: 0.1,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildSummaryPrompt({
          repo: params.repo,
          release: params.release,
          translatedTextZh: params.translatedTextZh,
        }),
      },
    ],
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new ApiError(502, "AI_EMPTY_OUTPUT", "AI 返回为空。");
  }

  const parsedJson = JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
  const normalized = aiOutputSchema.safeParse({
    language_detected: params.detectedLanguage,
    translated_text_zh: params.translatedTextZh,
    summary_zh: parsedJson.summary_zh,
    breaking_changes: parsedJson.breaking_changes,
    upgrade_actions: parsedJson.upgrade_actions,
    risk_level: parsedJson.risk_level,
    confidence: parsedJson.confidence,
  });

  if (!normalized.success) {
    throw new ApiError(
      502,
      "AI_SCHEMA_INVALID",
      "AI 返回字段不符合预期。",
      normalized.error.flatten(),
    );
  }

  return {
    ...normalized.data,
    model: completion.model ?? params.model,
  };
}

function getOpenAiStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  if (typeof status !== "number" || !Number.isFinite(status)) {
    return null;
  }
  return status;
}

function isLikelyTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = `${error.name} ${error.message}`.toLowerCase();
  return (
    text.includes("timeout") ||
    text.includes("timed out") ||
    text.includes("abort")
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
  const releaseBody = normalizeReleaseBody(release.body);
  const detectedLanguage = detectSourceLanguage(releaseBody);

  try {
    const translatedTextZh = await ensureCompleteTranslation({
      client,
      model: env.openaiModel,
      repo,
      release,
      releaseBody,
      detectedLanguage,
    });

    return summarizeFromTranslatedText({
      client,
      model: env.openaiModel,
      repo,
      release,
      translatedTextZh,
      detectedLanguage,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    const status = getOpenAiStatus(error);
    if (status === 429) {
      throw new ApiError(429, "AI_RATE_LIMIT", "AI 上游限流，请稍后重试。");
    }
    if (status === 401 || status === 403) {
      throw new ApiError(502, "AI_AUTH_FAILED", "AI 鉴权失败，请检查 OPENAI_API_KEY。");
    }
    if (isLikelyTimeoutError(error)) {
      throw new ApiError(
        504,
        "AI_TIMEOUT",
        "AI 请求超时，请更换更稳定的 OPENAI_BASE_URL 或稍后重试。",
      );
    }

    if (error instanceof Error) {
      throw new ApiError(502, "AI_REQUEST_FAILED", `AI 调用失败：${error.message}`);
    }
    throw new ApiError(502, "AI_REQUEST_FAILED", "AI 调用失败。");
  }
}
