import "server-only";

import type { ReleaseSummary } from "@/lib/types";

import {
  readTelegramNotificationMarker,
  writeTelegramNotificationMarker,
} from "./blob-store";
import { getServerEnv } from "./env";

const TELEGRAM_MAX_CHARS = 3500;
const SUMMARY_PREVIEW_MAX_CHARS = 800;

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}…`;
}

function splitTextByLimit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  const flushCurrent = () => {
    if (current.length > 0) {
      chunks.push(current);
      current = "";
    }
  };

  for (const line of lines) {
    if (line.length > maxChars) {
      flushCurrent();
      let rest = line;
      while (rest.length > maxChars) {
        chunks.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      }
      if (rest.length > 0) {
        current = rest;
      }
      continue;
    }

    const next = current.length === 0 ? line : `${current}\n${line}`;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    flushCurrent();
    current = line;
  }

  flushCurrent();
  return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
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

function buildTranslationMessages(repo: string, summary: ReleaseSummary): string[] {
  const translation = summary.translated_text_zh.trim();
  if (translation.length === 0) {
    return [];
  }

  const chunks = splitTextByLimit(translation, TELEGRAM_MAX_CHARS - 40);
  if (chunks.length === 1) {
    return [`全文翻译 (${repo} @ ${summary.tag})\n\n${chunks[0]}`];
  }

  return chunks.map(
    (chunk, index) =>
      `全文翻译 (${repo} @ ${summary.tag}) ${index + 1}/${chunks.length}\n\n${chunk}`,
  );
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  messageThreadId: number | null,
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  };
  if (messageThreadId !== null) {
    payload.message_thread_id = messageThreadId;
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

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

  const messages = [
    buildSummaryCard(params.repo, params.summary, params.source),
    ...buildTranslationMessages(params.repo, params.summary),
  ];

  for (const message of messages) {
    await sendTelegramMessage(
      env.telegramBotToken,
      env.telegramChatId,
      message,
      env.telegramMessageThreadId,
    );
  }

  await writeTelegramNotificationMarker(params.repo, params.summary.tag, {
    release_id: params.summary.release_id,
    source: params.source,
    message_count: messages.length,
  });

  return "sent";
}
