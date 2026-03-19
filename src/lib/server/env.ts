import "server-only";

import { parseBoolean } from "@/lib/shared";

import { ApiError } from "./errors";

export interface ServerEnv {
  githubWebhookSecret: string | null;
  cronSecret: string | null;
  githubToken: string | null;
  openaiApiKey: string;
  openaiModel: string;
  openaiBaseUrl: string | null;
  openaiTimeoutMs: number;
  openaiMaxRetries: number;
  blobToken: string;
  defaultRepo: string | null;
  watchRepos: string[];
  pollIncludePrerelease: boolean;
  retentionCount: number;
  defaultIncludePrerelease: boolean;
  revalidateToken: string | null;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  telegramMessageThreadId: number | null;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new ApiError(500, "MISSING_ENV", `缺少环境变量 ${name}`);
  }
  return value.trim();
}

function getOptionalEnv(name: string): string | null {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

function parseRetentionCount(value: string | null): number {
  if (!value) {
    return 5;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 5;
  }
  return parsed;
}

function parseOptionalInteger(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function parseIntegerWithDefault(
  value: string | null,
  fallback: number,
  options?: { min?: number; max?: number },
): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const min = options?.min;
  const max = options?.max;

  if (typeof min === "number" && parsed < min) {
    return min;
  }
  if (typeof max === "number" && parsed > max) {
    return max;
  }

  return parsed;
}

function parseWatchRepos(raw: string | null, fallbackRepo: string | null): string[] {
  const source = raw ?? fallbackRepo ?? "";
  return source
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function getServerEnv(): ServerEnv {
  const openaiApiKey = getOptionalEnv("OPENAI_API_KEY");
  const openaiModel = getOptionalEnv("OPENAI_MODEL") ?? "gpt-4o-mini";
  const openaiBaseUrl = getOptionalEnv("OPENAI_BASE_URL");
  const openaiTimeoutMs = parseIntegerWithDefault(
    getOptionalEnv("OPENAI_TIMEOUT_MS"),
    45000,
    { min: 5000, max: 120000 },
  );
  const openaiMaxRetries = parseIntegerWithDefault(
    getOptionalEnv("OPENAI_MAX_RETRIES"),
    0,
    { min: 0, max: 3 },
  );

  if (!openaiApiKey) {
    throw new ApiError(
      500,
      "MISSING_ENV",
      "缺少环境变量 OPENAI_API_KEY。",
    );
  }

  return {
    githubWebhookSecret: getOptionalEnv("GITHUB_WEBHOOK_SECRET"),
    cronSecret: getOptionalEnv("CRON_SECRET"),
    githubToken: getOptionalEnv("GITHUB_TOKEN"),
    openaiApiKey,
    openaiModel,
    openaiBaseUrl,
    openaiTimeoutMs,
    openaiMaxRetries,
    blobToken: getRequiredEnv("BLOB_READ_WRITE_TOKEN"),
    defaultRepo: getOptionalEnv("DEFAULT_REPO"),
    watchRepos: parseWatchRepos(
      getOptionalEnv("WATCH_REPOS"),
      getOptionalEnv("DEFAULT_REPO"),
    ),
    pollIncludePrerelease: parseBoolean(
      getOptionalEnv("POLL_INCLUDE_PRERELEASE"),
      false,
    ),
    retentionCount: parseRetentionCount(getOptionalEnv("RETENTION_COUNT")),
    defaultIncludePrerelease: parseBoolean(
      getOptionalEnv("DEFAULT_INCLUDE_PRERELEASE"),
      false,
    ),
    revalidateToken: getOptionalEnv("REVALIDATE_TOKEN"),
    telegramBotToken: getOptionalEnv("TELEGRAM_BOT_TOKEN"),
    telegramChatId: getOptionalEnv("TELEGRAM_CHAT_ID"),
    telegramMessageThreadId: parseOptionalInteger(
      getOptionalEnv("TELEGRAM_MESSAGE_THREAD_ID"),
    ),
  };
}
