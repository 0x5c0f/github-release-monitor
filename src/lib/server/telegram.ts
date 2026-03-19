import "server-only";

import type { ReleaseSummary } from "@/lib/types";

import {
  readTelegramNotificationMarker,
  writeTelegramNotificationMarker,
} from "./blob-store";
import { getServerEnv } from "./env";

const TELEGRAM_MAX_CHARS = 3500;
const SUMMARY_PREVIEW_MAX_CHARS = 800;
const TELEGRAM_TIMEOUT_MS = 15000;

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}

function buildSummaryCard(
  repo: string,
  summary: ReleaseSummary,
  source: "webhook" | "live_generated",
): string {
  const sourceLabel = source === "webhook" ? "Webhook" : "轮询/手动更新";
  const confidence = Math.round(summary.confidence * 100);
  const summaryPreview = truncateText(summary.summary_zh, SUMMARY_PREVIEW_MAX_CHARS);

  return [
    "GitHub Release 新版本更新",
    `仓库: ${repo}`,
    `Tag: ${summary.tag}${summary.prerelease ? " (预发布)" : ""}`,
    `标题: ${summary.release_name}`,
    `发布时间: ${summary.published_at}`,
    `风险: ${summary.risk_level} | 置信度: ${confidence}%`,
    `来源: ${sourceLabel}`,
    `链接: ${summary.release_url}`,
    "",
    "中文总结:",
    summaryPreview,
  ].join("\n");
}

function buildTranslationFileName(repo: string, tag: string): string {
  const safeRepo = repo.replace(/\//g, "-");
  const safeTag = tag.replace(/[^\w.-]+/g, "_");
  return `${safeRepo}-${safeTag}-translated.txt`;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = TELEGRAM_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendTelegramTranslationFile(
  botToken: string,
  chatId: string,
  repo: string,
  summary: ReleaseSummary,
  messageThreadId: number | null,
): Promise<boolean> {
  const translation = summary.translated_text_zh.trim();
  if (translation.length === 0) {
    return false;
  }

  const formData = new FormData();
  formData.set("chat_id", chatId);
  formData.set(
    "caption",
    truncateText(`全文翻译: ${repo} @ ${summary.tag}`, 900),
  );
  if (messageThreadId !== null) {
    formData.set("message_thread_id", String(messageThreadId));
  }
  formData.set(
    "document",
    new Blob([translation], { type: "text/plain;charset=utf-8" }),
    buildTranslationFileName(repo, summary.tag),
  );

  const response = await fetchWithTimeout(
    `https://api.telegram.org/bot${botToken}/sendDocument`,
    {
      method: "POST",
      body: formData,
    },
  );

  if (response.ok) {
    return true;
  }

  const errorText = await response.text();
  throw new Error(`Telegram API 响应失败: ${response.status} ${errorText}`);
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  messageThreadId: number | null,
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: truncateText(text, TELEGRAM_MAX_CHARS),
    disable_web_page_preview: true,
  };
  if (messageThreadId !== null) {
    payload.message_thread_id = messageThreadId;
  }

  const response = await fetchWithTimeout(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (response.ok) {
    return;
  }

  const errorText = await response.text();
  throw new Error(`Telegram API 响应失败: ${response.status} ${errorText}`);
}

export async function notifyTelegramForNewRelease(params: {
  repo: string;
  summary: ReleaseSummary;
  source: "webhook" | "live_generated";
  isNewVersion: boolean;
}): Promise<"disabled" | "skipped_existing" | "skipped_sent" | "sent"> {
  if (!params.isNewVersion) {
    return "skipped_existing";
  }

  const env = getServerEnv();
  if (!env.telegramBotToken || !env.telegramChatId) {
    return "disabled";
  }

  const notified = await readTelegramNotificationMarker(params.repo, params.summary.tag);
  if (notified) {
    return "skipped_sent";
  }

  await sendTelegramMessage(
    env.telegramBotToken,
    env.telegramChatId,
    buildSummaryCard(params.repo, params.summary, params.source),
    env.telegramMessageThreadId,
  );
  const hasTranslationFile = await sendTelegramTranslationFile(
    env.telegramBotToken,
    env.telegramChatId,
    params.repo,
    params.summary,
    env.telegramMessageThreadId,
  );

  await writeTelegramNotificationMarker(params.repo, params.summary.tag, {
    release_id: params.summary.release_id,
    source: params.source,
    message_count: hasTranslationFile ? 2 : 1,
  });

  return "sent";
}
