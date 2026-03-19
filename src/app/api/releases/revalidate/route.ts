import { NextResponse } from "next/server";
import { z } from "zod";

import { ensureRepoFormat, parseBoolean } from "@/lib/shared";
import { ApiError, toApiError } from "@/lib/server/errors";
import { isAuthorizedRequest } from "@/lib/server/auth";
import { getServerEnv, isRepoAllowed } from "@/lib/server/env";
import { getLatestSummary, getSummaryByTag } from "@/lib/server/release-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  repo: z.string().optional(),
  tag: z.string().optional(),
  includePrerelease: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    if (!isAuthorizedRequest(request)) {
      throw new ApiError(401, "UNAUTHORIZED", "请先登录后再访问该接口。");
    }

    const env = getServerEnv();

    if (env.revalidateToken) {
      const token = request.headers.get("x-revalidate-token");
      if (token !== env.revalidateToken) {
        throw new ApiError(401, "INVALID_REVALIDATE_TOKEN", "刷新令牌无效。");
      }
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "INVALID_BODY", "请求体字段格式错误。");
    }

    const repoRaw = parsed.data.repo ?? env.defaultRepo;
    if (!repoRaw) {
      throw new ApiError(
        400,
        "MISSING_REPO",
        "缺少 repo 参数，且未配置 DEFAULT_REPO。",
      );
    }

    const repo = ensureRepoFormat(repoRaw);
    if (!isRepoAllowed(repo)) {
      throw new ApiError(403, "REPO_NOT_ALLOWED", "该仓库不在允许列表中。");
    }

    if (parsed.data.tag && parsed.data.tag.trim().length > 0) {
      const result = await getSummaryByTag(repo, parsed.data.tag.trim());
      return NextResponse.json(
        { ok: true, mode: "by-tag", repo, source: result.source, data: result.data },
        { status: 200 },
      );
    }

    const includePrerelease =
      parsed.data.includePrerelease ??
      parseBoolean(undefined, env.defaultIncludePrerelease);
    const result = await getLatestSummary(repo, includePrerelease);

    return NextResponse.json(
      {
        ok: true,
        mode: "latest",
        repo,
        includePrerelease,
        source: result.source,
        data: result.data,
      },
      { status: 200 },
    );
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json(
      { ok: false, code: apiError.code, error: apiError.message },
      { status: apiError.status },
    );
  }
}
