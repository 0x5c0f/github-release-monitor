import "server-only";

import { githubReleaseSchema } from "@/lib/schemas";
import { ensureRepoFormat, splitRepo } from "@/lib/shared";
import type { GithubRelease } from "@/lib/types";

import { ApiError } from "./errors";
import { getServerEnv } from "./env";

const GITHUB_API_BASE = "https://api.github.com";

function getRepoPath(repo: string): string {
  const { owner, name } = splitRepo(repo);
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function isRateLimitedResponse(response: Response): boolean {
  const remaining = response.headers.get("x-ratelimit-remaining");
  return response.status === 429 || (response.status === 403 && remaining === "0");
}

async function throwGithubResponseError(response: Response): Promise<never> {
  const responseText = (await response.text()).slice(0, 800);

  if (response.status === 404) {
    throw new ApiError(404, "GITHUB_NOT_FOUND", "GitHub 发布信息不存在。");
  }

  if (isRateLimitedResponse(response)) {
    throw new ApiError(429, "GITHUB_RATE_LIMIT", "GitHub API 请求已触发限流。", {
      retry_after: response.headers.get("retry-after"),
      body: responseText,
    });
  }

  throw new ApiError(
    502,
    "GITHUB_UPSTREAM_ERROR",
    `GitHub API 请求失败（${response.status}）。`,
    responseText,
  );
}

async function githubGetJson(pathname: string): Promise<unknown> {
  const env = getServerEnv();
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "github-release-monitor",
  });

  if (env.githubToken) {
    headers.set("Authorization", `Bearer ${env.githubToken}`);
  }

  const response = await fetch(`${GITHUB_API_BASE}${pathname}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    await throwGithubResponseError(response);
  }

  return response.json();
}

function parseRelease(value: unknown): GithubRelease {
  const parsed = githubReleaseSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      502,
      "GITHUB_SCHEMA_ERROR",
      "GitHub 返回的数据格式不符合预期。",
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

export async function fetchReleaseByTag(
  repoInput: string,
  tagInput: string,
): Promise<GithubRelease> {
  const repo = ensureRepoFormat(repoInput);
  const tag = tagInput.trim();
  if (tag.length === 0) {
    throw new ApiError(400, "INVALID_TAG", "tag 参数不能为空。");
  }

  const repoPath = getRepoPath(repo);
  const payload = await githubGetJson(
    `/repos/${repoPath}/releases/tags/${encodeURIComponent(tag)}`,
  );
  return parseRelease(payload);
}

export async function fetchLatestRelease(
  repoInput: string,
  includePrerelease: boolean,
): Promise<GithubRelease> {
  const repo = ensureRepoFormat(repoInput);
  const repoPath = getRepoPath(repo);

  if (!includePrerelease) {
    const payload = await githubGetJson(`/repos/${repoPath}/releases/latest`);
    return parseRelease(payload);
  }

  const payload = await githubGetJson(`/repos/${repoPath}/releases?per_page=20`);
  if (!Array.isArray(payload)) {
    throw new ApiError(
      502,
      "GITHUB_SCHEMA_ERROR",
      "GitHub releases 列表格式不符合预期。",
    );
  }

  const releases = payload
    .map((item) => {
      const parsed = githubReleaseSchema.safeParse(item);
      return parsed.success ? parsed.data : null;
    })
    .filter((item): item is GithubRelease => item !== null)
    .filter((item) => !item.draft);

  if (releases.length === 0) {
    throw new ApiError(404, "GITHUB_NOT_FOUND", "未找到可用的 Release。");
  }

  releases.sort((a, b) => {
    const aTime = Date.parse(a.published_at ?? "");
    const bTime = Date.parse(b.published_at ?? "");
    const aValid = Number.isFinite(aTime);
    const bValid = Number.isFinite(bTime);

    if (aValid && bValid && aTime !== bTime) {
      return bTime - aTime;
    }
    if (aValid && !bValid) {
      return -1;
    }
    if (!aValid && bValid) {
      return 1;
    }
    return b.id - a.id;
  });

  return releases[0];
}
