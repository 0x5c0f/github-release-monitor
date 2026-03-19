import "server-only";

import { del, get, list, put } from "@vercel/blob";

import { releaseSummarySchema } from "@/lib/schemas";
import {
  compareReleaseOrder,
  ensureRepoFormat,
  splitRepo,
  toSafeTag,
} from "@/lib/shared";
import type { ReleaseSummary } from "@/lib/types";

import { getServerEnv } from "./env";

function getRepoBase(repoInput: string): string {
  const repo = ensureRepoFormat(repoInput);
  const { owner, name } = splitRepo(repo);
  return `releases/${owner}/${name}`;
}

function getVersionsPrefix(repo: string): string {
  return `${getRepoBase(repo)}/versions/`;
}

export function getVersionPath(repo: string, tag: string): string {
  return `${getVersionsPrefix(repo)}${toSafeTag(tag)}.json`;
}

export function getLatestPath(repo: string, includePrerelease: boolean): string {
  const suffix = includePrerelease ? "latest.json" : "latest-stable.json";
  return `${getRepoBase(repo)}/${suffix}`;
}

async function getSummaryByPath(pathname: string): Promise<ReleaseSummary | null> {
  const env = getServerEnv();
  const result = await get(pathname, {
    access: "private",
    token: env.blobToken,
    useCache: false,
  });

  if (!result || result.statusCode !== 200 || !result.stream) {
    return null;
  }

  const rawText = await new Response(result.stream).text();
  let raw: unknown;

  try {
    raw = JSON.parse(rawText);
  } catch {
    return null;
  }

  const parsed = releaseSummarySchema.safeParse(raw);
  if (!parsed.success) {
    return null;
  }

  return parsed.data;
}

export async function readVersionSummary(
  repo: string,
  tag: string,
): Promise<ReleaseSummary | null> {
  return getSummaryByPath(getVersionPath(repo, tag));
}

export async function readLatestSummary(
  repo: string,
  includePrerelease: boolean,
): Promise<ReleaseSummary | null> {
  return getSummaryByPath(getLatestPath(repo, includePrerelease));
}

export async function listVersionSummaries(repo: string): Promise<ReleaseSummary[]> {
  const env = getServerEnv();
  const prefix = getVersionsPrefix(repo);
  const listed = await list({
    token: env.blobToken,
    prefix,
    limit: 1000,
  });

  const entries = await Promise.all(
    listed.blobs.map(async (blob) => {
      const summary = await getSummaryByPath(blob.pathname);
      if (!summary) {
        return null;
      }
      return {
        summary,
        uploadedAt: blob.uploadedAt.getTime(),
      };
    }),
  );

  const validEntries = entries.filter((item): item is NonNullable<typeof item> =>
    Boolean(item),
  );

  validEntries.sort((a, b) => {
    const order = compareReleaseOrder(
      {
        published_at: a.summary.published_at,
        release_id: a.summary.release_id,
      },
      {
        published_at: b.summary.published_at,
        release_id: b.summary.release_id,
      },
    );

    if (order === 1) {
      return -1;
    }
    if (order === -1) {
      return 1;
    }
    return b.uploadedAt - a.uploadedAt;
  });

  return validEntries.map((item) => item.summary);
}

async function putSummary(pathname: string, summary: ReleaseSummary): Promise<void> {
  const env = getServerEnv();

  await put(pathname, JSON.stringify(summary), {
    access: "private",
    token: env.blobToken,
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
  });
}

export async function writeVersionSummary(
  repo: string,
  tag: string,
  summary: ReleaseSummary,
): Promise<void> {
  await putSummary(getVersionPath(repo, tag), summary);
}

export async function writeLatestSummary(
  repo: string,
  includePrerelease: boolean,
  summary: ReleaseSummary,
): Promise<void> {
  await putSummary(getLatestPath(repo, includePrerelease), summary);
}

export async function cleanupOldVersions(
  repo: string,
  retentionCount: number,
): Promise<number> {
  const env = getServerEnv();
  const prefix = getVersionsPrefix(repo);
  const listed = await list({
    token: env.blobToken,
    prefix,
    limit: 1000,
  });

  if (listed.blobs.length <= retentionCount) {
    return 0;
  }

  const entries = await Promise.all(
    listed.blobs.map(async (blob) => {
      const summary = await getSummaryByPath(blob.pathname);
      const publishedAt = summary ? Date.parse(summary.published_at) : Number.NaN;
      const releaseId = summary ? summary.release_id : -1;
      return {
        pathname: blob.pathname,
        publishedAt,
        releaseId,
        uploadedAt: blob.uploadedAt.getTime(),
      };
    }),
  );

  entries.sort((a, b) => {
    const aHasTime = Number.isFinite(a.publishedAt);
    const bHasTime = Number.isFinite(b.publishedAt);

    if (aHasTime && bHasTime && a.publishedAt !== b.publishedAt) {
      return b.publishedAt - a.publishedAt;
    }
    if (aHasTime && !bHasTime) {
      return -1;
    }
    if (!aHasTime && bHasTime) {
      return 1;
    }
    if (a.releaseId !== b.releaseId) {
      return b.releaseId - a.releaseId;
    }
    return b.uploadedAt - a.uploadedAt;
  });

  const toDelete = entries.slice(retentionCount).map((item) => item.pathname);
  if (toDelete.length === 0) {
    return 0;
  }

  await del(toDelete, { token: env.blobToken });
  return toDelete.length;
}
