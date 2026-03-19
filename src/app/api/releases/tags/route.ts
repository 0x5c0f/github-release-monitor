import { NextResponse } from "next/server";

import { ensureRepoFormat } from "@/lib/shared";
import { isAuthorizedRequest } from "@/lib/server/auth";
import { ApiError, toApiError } from "@/lib/server/errors";
import { getServerEnv } from "@/lib/server/env";
import { listCachedTags } from "@/lib/server/release-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!isAuthorizedRequest(request)) {
      throw new ApiError(401, "UNAUTHORIZED", "请先登录后再访问该接口。");
    }

    const env = getServerEnv();
    const url = new URL(request.url);

    const repoParam =
      url.searchParams.get("repo") ?? env.watchRepos[0] ?? env.defaultRepo;
    if (!repoParam) {
      throw new ApiError(
        400,
        "MISSING_REPO",
        "缺少 repo 参数，且未配置 WATCH_REPOS/DEFAULT_REPO。",
      );
    }

    const repo = ensureRepoFormat(repoParam);
    const tags = await listCachedTags(repo);

    return NextResponse.json(
      {
        ok: true,
        repo,
        total: tags.length,
        tags,
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
