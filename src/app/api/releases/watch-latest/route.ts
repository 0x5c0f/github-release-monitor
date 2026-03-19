import { NextResponse } from "next/server";

import { parseBoolean } from "@/lib/shared";
import { isAuthorizedRequest } from "@/lib/server/auth";
import { ApiError, toApiError } from "@/lib/server/errors";
import { getServerEnv } from "@/lib/server/env";
import { getWatchedLatestSummariesFromCache } from "@/lib/server/release-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    if (!isAuthorizedRequest(request)) {
      throw new ApiError(401, "UNAUTHORIZED", "请先登录后再访问该接口。");
    }

    const env = getServerEnv();
    const url = new URL(request.url);
    const includePrerelease = parseBoolean(
      url.searchParams.get("includePrerelease"),
      env.defaultIncludePrerelease,
    );

    const result = await getWatchedLatestSummariesFromCache(includePrerelease);
    return NextResponse.json(
      {
        ok: true,
        ...result,
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
