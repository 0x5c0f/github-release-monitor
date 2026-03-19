import { NextResponse } from "next/server";

import { webhookPayloadSchema } from "@/lib/schemas";
import { ensureRepoFormat } from "@/lib/shared";
import { ensureSummaryForRelease } from "@/lib/server/release-service";
import { toApiError } from "@/lib/server/errors";
import { getServerEnv } from "@/lib/server/env";
import { verifyGitHubSignature } from "@/lib/server/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const env = getServerEnv();
    if (!env.githubWebhookSecret) {
      return NextResponse.json(
        {
          ok: false,
          code: "MISSING_WEBHOOK_SECRET",
          error: "缺少 GITHUB_WEBHOOK_SECRET 环境变量。",
        },
        { status: 500 },
      );
    }
    const signature = request.headers.get("x-hub-signature-256");
    const eventName = request.headers.get("x-github-event");
    const rawBody = await request.text();

    const isSignatureValid = verifyGitHubSignature(
      rawBody,
      signature,
      env.githubWebhookSecret,
    );

    if (!isSignatureValid) {
      return NextResponse.json(
        { ok: false, code: "INVALID_SIGNATURE", error: "Webhook 验签失败。" },
        { status: 401 },
      );
    }

    if (eventName !== "release") {
      return NextResponse.json(
        { ok: true, ignored: true, reason: "unsupported_event" },
        { status: 202 },
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return NextResponse.json(
        { ok: false, code: "INVALID_JSON", error: "Webhook body 不是有效 JSON。" },
        { status: 400 },
      );
    }

    const parsedPayload = webhookPayloadSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_PAYLOAD",
          error: "Webhook payload 字段不完整或格式错误。",
        },
        { status: 400 },
      );
    }

    if (parsedPayload.data.action !== "published") {
      return NextResponse.json(
        { ok: true, ignored: true, reason: `unsupported_action:${parsedPayload.data.action}` },
        { status: 202 },
      );
    }

    const repo = ensureRepoFormat(parsedPayload.data.repository.full_name);
    const result = await ensureSummaryForRelease(
      repo,
      parsedPayload.data.release,
      "webhook",
    );

    return NextResponse.json(
      {
        ok: true,
        repo,
        tag: parsedPayload.data.release.tag_name,
        source: result.source,
      },
      { status: 202 },
    );
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json(
      { ok: false, code: apiError.code, error: apiError.message },
      { status: apiError.status },
    );
  }
}
