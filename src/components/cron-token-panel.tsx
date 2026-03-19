"use client";

import { useState } from "react";

interface TokenResponse {
  ok: true;
  tokenType: "cron";
  scope: "poll_releases";
  ttlSeconds: number;
  expiresAt: string;
  token: string;
}

interface ErrorResponse {
  ok: false;
  code: string;
  error: string;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default function CronTokenPanel() {
  const [ttlMinutes, setTtlMinutes] = useState(60);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<"token" | "curl" | null>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenResponse | null>(null);

  async function copyText(value: string, target: "token" | "curl") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied(null), 1200);
    } catch {
      setCopied(null);
    }
  }

  async function handleGenerate() {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/auth/cron-token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ ttlMinutes }),
      });

      const payload = (await response.json()) as TokenResponse | ErrorResponse;
      if (!response.ok || !payload.ok) {
        setErrorMessage("error" in payload ? payload.error : "生成失败。");
        return;
      }

      setTokenInfo(payload);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "生成失败。");
    } finally {
      setIsSubmitting(false);
    }
  }

  const curlExample = tokenInfo
    ? `curl -H "Authorization: Bearer ${tokenInfo.token}" "https://<your-domain>/api/cron/poll-releases"`
    : "";

  return (
    <section className="rounded-3xl border border-[#d9ccb8] bg-[#fffaf2]/90 p-6 shadow-[0_24px_80px_-42px_rgba(125,95,42,0.65)] backdrop-blur">
      <h2 className="text-lg font-bold text-[#2f2516]">Cron 校验 Token 生成</h2>
      <p className="mt-2 text-sm leading-6 text-[#6c5738]">
        该 token 可用于调用 <code>/api/cron/poll-releases</code>。你可以指定过期时间，超时后自动失效。
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold tracking-wide text-[#7b6648]">
            过期时间（分钟）
          </span>
          <input
            type="number"
            min={1}
            max={43200}
            value={ttlMinutes}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value || "1", 10);
              setTtlMinutes(
                Number.isFinite(next) ? Math.min(43200, Math.max(1, next)) : 1,
              );
            }}
            className="w-44 rounded-xl border border-[#d8c7ae] bg-white px-4 py-3 text-[#2c2418] outline-none transition focus:border-[#c79849] focus:ring-2 focus:ring-[#f5ddb6]"
          />
        </label>

        <button
          type="button"
          onClick={handleGenerate}
          disabled={isSubmitting}
          className="rounded-full bg-[#b4772c] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#99611f] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "生成中..." : "生成 Token"}
        </button>
      </div>

      {errorMessage ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      {tokenInfo ? (
        <div className="mt-5 space-y-3 rounded-2xl border border-[#dcc9aa] bg-white p-4">
          <p className="text-sm text-[#654f2f]">
            有效期：{tokenInfo.ttlSeconds} 秒（到期时间：{formatDateTime(tokenInfo.expiresAt)}）
          </p>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#7b6648]">
              Token
            </p>
            <textarea
              readOnly
              value={tokenInfo.token}
              className="h-24 w-full rounded-xl border border-[#d8c7ae] bg-[#fffdfa] p-3 font-mono text-xs text-[#4c3920]"
            />
            <button
              type="button"
              onClick={() => copyText(tokenInfo.token, "token")}
              className="mt-2 rounded-full border border-[#c49d62] bg-white px-4 py-1.5 text-xs font-semibold text-[#7a5018] transition hover:bg-[#fff4e1]"
            >
              {copied === "token" ? "已复制" : "复制 Token"}
            </button>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#7b6648]">
              curl 示例
            </p>
            <textarea
              readOnly
              value={curlExample}
              className="h-20 w-full rounded-xl border border-[#d8c7ae] bg-[#fffdfa] p-3 font-mono text-xs text-[#4c3920]"
            />
            <button
              type="button"
              onClick={() => copyText(curlExample, "curl")}
              className="mt-2 rounded-full border border-[#c49d62] bg-white px-4 py-1.5 text-xs font-semibold text-[#7a5018] transition hover:bg-[#fff4e1]"
            >
              {copied === "curl" ? "已复制" : "复制 curl"}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
