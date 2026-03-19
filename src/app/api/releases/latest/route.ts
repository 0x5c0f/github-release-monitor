import { NextResponse } from "next/server";

import { ensureRepoFormat, parseBoolean } from "@/lib/shared";
import { toApiError, ApiError } from "@/lib/server/errors";
import { isAuthorizedRequest } from "@/lib/server/auth";
import { getServerEnv, isRepoAllowed } from "@/lib/server/env";
import { getLatestSummary } from "@/lib/server/release-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!isAuthorizedRequest(request)) {
      throw new ApiError(401, "UNAUTHORIZED", "请先登录后再访问该接口。");
    }

    const env = getServerEnv();
    const url = new URL(request.url);

    const repoParam = url.searchParams.get("repo") ?? env.defaultRepo;
    if (!repoParam) {
      throw new ApiError(
        400,
        "MISSING_REPO",
        "缺少 repo 参数，且未配置 DEFAULT_REPO。",
      );
    }

    const repo = ensureRepoFormat(repoParam);
    if (!isRepoAllowed(repo)) {
      throw new ApiError(403, "REPO_NOT_ALLOWED", "该仓库不在允许列表中。");
    }

    const includePrerelease = parseBoolean(
      url.searchParams.get("includePrerelease"),
      env.defaultIncludePrerelease,
    );

    const result = await getLatestSummary(repo, includePrerelease);

    return NextResponse.json(
      {
        ok: true,
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
