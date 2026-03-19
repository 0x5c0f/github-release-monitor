import "server-only";

import { releaseSummarySchema } from "@/lib/schemas";
import {
  compareReleaseOrder,
  ensureRepoFormat,
  toIsoOrNow,
} from "@/lib/shared";
import type { GithubRelease, ReleaseSummary, SummaryResult } from "@/lib/types";

import {
  cleanupOldVersions,
  listVersionSummaries,
  readLatestSummary,
  readVersionSummary,
  writeLatestSummary,
  writeVersionSummary,
} from "./blob-store";
import { ApiError } from "./errors";
import { getServerEnv } from "./env";
import { fetchLatestRelease, fetchReleaseByTag } from "./github";
import { summarizeRelease } from "./summarizer";

async function maybeUpdateLatestPointer(
  repo: string,
  includePrerelease: boolean,
  candidate: ReleaseSummary,
): Promise<boolean> {
  const existing = await readLatestSummary(repo, includePrerelease);
  if (existing) {
    const compareResult = compareReleaseOrder(
      {
        published_at: candidate.published_at,
        release_id: candidate.release_id,
      },
      {
        published_at: existing.published_at,
        release_id: existing.release_id,
      },
    );
    if (compareResult <= 0) {
      return false;
    }
  }

  await writeLatestSummary(repo, includePrerelease, candidate);
  return true;
}

function buildReleaseSummary(
  repo: string,
  release: GithubRelease,
  aiResult: Awaited<ReturnType<typeof summarizeRelease>>,
): ReleaseSummary {
  const summary: ReleaseSummary = {
    repo,
    release_id: release.id,
    tag: release.tag_name.trim(),
    release_name: (release.name ?? release.tag_name).trim() || release.tag_name,
    release_url: release.html_url,
    published_at: toIsoOrNow(release.published_at),
    prerelease: release.prerelease,
    language_detected: aiResult.language_detected,
    original_body: release.body ?? "",
    translated_text_zh: aiResult.translated_text_zh,
    summary_zh: aiResult.summary_zh,
    breaking_changes: aiResult.breaking_changes,
    upgrade_actions: aiResult.upgrade_actions,
    risk_level: aiResult.risk_level,
    confidence: aiResult.confidence,
    generated_at: new Date().toISOString(),
    model: aiResult.model,
  };

  return releaseSummarySchema.parse(summary);
}

export async function ensureSummaryForRelease(
  repoInput: string,
  release: GithubRelease,
  source: "webhook" | "live_generated",
): Promise<SummaryResult> {
  const repo = ensureRepoFormat(repoInput);

  const cached = await readVersionSummary(repo, release.tag_name);
  if (cached) {
    await maybeUpdateLatestPointer(repo, true, cached);
    if (!cached.prerelease) {
      await maybeUpdateLatestPointer(repo, false, cached);
    }

    return {
      source: "blob_cache",
      data: cached,
    };
  }

  const aiResult = await summarizeRelease(repo, release);
  const summary = buildReleaseSummary(repo, release, aiResult);

  await writeVersionSummary(repo, release.tag_name, summary);
  await maybeUpdateLatestPointer(repo, true, summary);
  if (!summary.prerelease) {
    await maybeUpdateLatestPointer(repo, false, summary);
  }

  const { retentionCount } = getServerEnv();
  await cleanupOldVersions(repo, retentionCount);

  return {
    source,
    data: summary,
  };
}

export async function getLatestSummary(
  repoInput: string,
  includePrerelease: boolean,
): Promise<SummaryResult> {
  const repo = ensureRepoFormat(repoInput);

  const cached = await readLatestSummary(repo, includePrerelease);
  if (cached) {
    return {
      source: "blob_cache",
      data: cached,
    };
  }

  const release = await fetchLatestRelease(repo, includePrerelease);
  return ensureSummaryForRelease(repo, release, "live_generated");
}

export async function refreshLatestSummary(
  repoInput: string,
  includePrerelease: boolean,
): Promise<SummaryResult> {
  const repo = ensureRepoFormat(repoInput);
  const release = await fetchLatestRelease(repo, includePrerelease);
  return ensureSummaryForRelease(repo, release, "live_generated");
}

export async function getSummaryByTag(
  repoInput: string,
  tagInput: string,
): Promise<SummaryResult> {
  const repo = ensureRepoFormat(repoInput);

  const tag = tagInput.trim();
  if (tag.length === 0) {
    throw new ApiError(400, "INVALID_TAG", "tag 参数不能为空。");
  }

  const cached = await readVersionSummary(repo, tag);
  if (cached) {
    return {
      source: "blob_cache",
      data: cached,
    };
  }

  const release = await fetchReleaseByTag(repo, tag);
  return ensureSummaryForRelease(repo, release, "live_generated");
}

export async function refreshSummaryByTag(
  repoInput: string,
  tagInput: string,
): Promise<SummaryResult> {
  const repo = ensureRepoFormat(repoInput);
  const tag = tagInput.trim();
  if (tag.length === 0) {
    throw new ApiError(400, "INVALID_TAG", "tag 参数不能为空。");
  }

  const release = await fetchReleaseByTag(repo, tag);
  return ensureSummaryForRelease(repo, release, "live_generated");
}

function createSummaryNotFoundError(repo: string, suffix: string): ApiError {
  return new ApiError(404, "SUMMARY_NOT_FOUND", `${repo} 的${suffix}未命中缓存。`);
}

export async function getLatestSummaryFromCache(
  repoInput: string,
  includePrerelease: boolean,
): Promise<SummaryResult> {
  const repo = ensureRepoFormat(repoInput);
  const cached = await readLatestSummary(repo, includePrerelease);
  if (!cached) {
    const latestType = includePrerelease ? "最新发布" : "最新稳定版";
    throw createSummaryNotFoundError(repo, latestType);
  }

  return {
    source: "blob_cache",
    data: cached,
  };
}

export async function getSummaryByTagFromCache(
  repoInput: string,
  tagInput: string,
): Promise<SummaryResult> {
  const repo = ensureRepoFormat(repoInput);
  const tag = tagInput.trim();
  if (tag.length === 0) {
    throw new ApiError(400, "INVALID_TAG", "tag 参数不能为空。");
  }

  const cached = await readVersionSummary(repo, tag);
  if (!cached) {
    throw createSummaryNotFoundError(repo, `tag=${tag} 的版本`);
  }

  return {
    source: "blob_cache",
    data: cached,
  };
}

export interface WatchedLatestSummaryItem {
  repo: string;
  status: "cached" | "missing";
  source?: "blob_cache";
  data?: ReleaseSummary;
}

export interface CachedTagItem {
  tag: string;
  published_at: string;
  prerelease: boolean;
  release_name: string;
}

export async function getWatchedLatestSummariesFromCache(
  includePrerelease: boolean,
): Promise<{
  includePrerelease: boolean;
  total: number;
  cached: number;
  missing: number;
  items: WatchedLatestSummaryItem[];
}> {
  const env = getServerEnv();
  if (env.watchRepos.length === 0) {
    throw new ApiError(
      400,
      "NO_WATCH_REPOS",
      "未配置 WATCH_REPOS，无法读取监控仓库列表。",
    );
  }

  const items = await Promise.all(
    env.watchRepos.map(async (repo) => {
      const normalizedRepo = ensureRepoFormat(repo);
      const cached = await readLatestSummary(normalizedRepo, includePrerelease);
      if (!cached) {
        return {
          repo: normalizedRepo,
          status: "missing" as const,
        };
      }

      return {
        repo: normalizedRepo,
        status: "cached" as const,
        source: "blob_cache" as const,
        data: cached,
      };
    }),
  );

  const cached = items.filter((item) => item.status === "cached").length;
  const missing = items.length - cached;

  return {
    includePrerelease,
    total: items.length,
    cached,
    missing,
    items,
  };
}

export async function listCachedTags(
  repoInput: string,
): Promise<CachedTagItem[]> {
  const repo = ensureRepoFormat(repoInput);
  const versions = await listVersionSummaries(repo);

  return versions.map((item) => ({
    tag: item.tag,
    published_at: item.published_at,
    prerelease: item.prerelease,
    release_name: item.release_name,
  }));
}

export interface PollReleaseItemResult {
  repo: string;
  status: "updated" | "cached" | "error";
  tag?: string;
  source?: SummaryResult["source"];
  message?: string;
}

export async function pollWatchedRepos(): Promise<{
  includePrerelease: boolean;
  total: number;
  success: number;
  failed: number;
  results: PollReleaseItemResult[];
}> {
  const env = getServerEnv();
  const repos = env.watchRepos;

  if (repos.length === 0) {
    throw new ApiError(
      400,
      "NO_WATCH_REPOS",
      "未配置 WATCH_REPOS，无法执行轮询。",
    );
  }

  const results: PollReleaseItemResult[] = [];

  for (const repo of repos) {
    try {
      const release = await fetchLatestRelease(repo, env.pollIncludePrerelease);
      const result = await ensureSummaryForRelease(repo, release, "live_generated");

      results.push({
        repo,
        status: result.source === "blob_cache" ? "cached" : "updated",
        source: result.source,
        tag: result.data.tag,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      results.push({
        repo,
        status: "error",
        message,
      });
    }
  }

  const success = results.filter((item) => item.status !== "error").length;
  const failed = results.length - success;

  return {
    includePrerelease: env.pollIncludePrerelease,
    total: repos.length,
    success,
    failed,
    results,
  };
}
