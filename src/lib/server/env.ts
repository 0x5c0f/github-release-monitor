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
  blobToken: string;
  defaultRepo: string | null;
  watchRepos: string[];
  pollIncludePrerelease: boolean;
  retentionCount: number;
  defaultIncludePrerelease: boolean;
  revalidateToken: string | null;
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
  };
}
