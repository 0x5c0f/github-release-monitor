"use client";

import { useEffect, useMemo, useState } from "react";

import type { ReleaseSummary } from "@/lib/types";

interface ApiSuccessResponse {
  ok: true;
  repo: string;
  source: "blob_cache" | "live_generated" | "webhook";
  data: ReleaseSummary;
  includePrerelease?: boolean;
  tag?: string;
}

interface ApiErrorResponse {
  ok: false;
  code: string;
  error: string;
}

interface ReleaseMonitorProps {
  defaultRepo: string;
  defaultIncludePrerelease: boolean;
}

const SOURCE_LABEL: Record<ApiSuccessResponse["source"], string> = {
  blob_cache: "Blob 缓存",
  live_generated: "实时生成",
  webhook: "Webhook 生成",
};

function prettyDate(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export default function ReleaseMonitor({
  defaultRepo,
  defaultIncludePrerelease,
}: ReleaseMonitorProps) {
  const [repoInput, setRepoInput] = useState(defaultRepo);
  const [tagInput, setTagInput] = useState("");
  const [includePrerelease, setIncludePrerelease] = useState(
    defaultIncludePrerelease,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiSuccessResponse | null>(null);

  const riskClass = useMemo(() => {
    const risk = response?.data.risk_level;
    if (risk === "high") {
      return "bg-red-100 text-red-700 border-red-200";
    }
    if (risk === "medium") {
      return "bg-amber-100 text-amber-700 border-amber-200";
    }
    if (risk === "low") {
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    }
    return "bg-slate-100 text-slate-700 border-slate-200";
  }, [response?.data.risk_level]);

  async function callApi(url: string) {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
      });
      const json = (await res.json()) as ApiSuccessResponse | ApiErrorResponse;

      if (!res.ok || !json.ok) {
        const message = "error" in json ? json.error : "请求失败。";
        setErrorMessage(message);
        return;
      }

      setResponse(json);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求失败，请稍后重试。";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleLoadLatest() {
    const params = new URLSearchParams({
      repo: repoInput.trim(),
      includePrerelease: includePrerelease ? "true" : "false",
    });
    void callApi(`/api/releases/latest?${params.toString()}`);
  }

  function handleLoadByTag() {
    const tag = tagInput.trim();
    if (!tag) {
      setErrorMessage("请输入 tag 后再查询。");
      return;
    }

    const params = new URLSearchParams({
      repo: repoInput.trim(),
      tag,
    });
    void callApi(`/api/releases/by-tag?${params.toString()}`);
  }

  useEffect(() => {
    handleLoadLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="w-full max-w-6xl space-y-6">
      <section className="rounded-3xl border border-[#d9ccb8] bg-[#fffaf2]/90 p-6 shadow-[0_24px_80px_-42px_rgba(125,95,42,0.65)] backdrop-blur">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end">
          <label className="flex flex-1 flex-col gap-2">
            <span className="text-sm font-semibold tracking-wide text-[#7b6648]">
              仓库（owner/name）
            </span>
            <input
              value={repoInput}
              onChange={(event) => setRepoInput(event.target.value)}
              placeholder="vercel/next.js"
              className="rounded-xl border border-[#d8c7ae] bg-white px-4 py-3 text-[#2c2418] outline-none transition focus:border-[#c79849] focus:ring-2 focus:ring-[#f5ddb6]"
            />
          </label>

          <label className="flex w-full flex-col gap-2 lg:w-60">
            <span className="text-sm font-semibold tracking-wide text-[#7b6648]">
              指定 Tag 查询
            </span>
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder="v1.2.3"
              className="rounded-xl border border-[#d8c7ae] bg-white px-4 py-3 text-[#2c2418] outline-none transition focus:border-[#c79849] focus:ring-2 focus:ring-[#f5ddb6]"
            />
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-[#dccaaa] bg-[#fff6e6] px-4 py-3 text-sm text-[#674f2b]">
            <input
              type="checkbox"
              checked={includePrerelease}
              onChange={(event) => setIncludePrerelease(event.target.checked)}
              className="h-4 w-4 accent-[#c79849]"
            />
            包含预发布版本
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleLoadLatest}
            disabled={isLoading}
            className="rounded-full bg-[#b4772c] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#99611f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "加载中..." : "查询最新发布"}
          </button>
          <button
            type="button"
            onClick={handleLoadByTag}
            disabled={isLoading}
            className="rounded-full border border-[#c49d62] bg-white px-5 py-2.5 text-sm font-semibold text-[#7a5018] transition hover:bg-[#fff4e1] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isLoading ? "加载中..." : "按 Tag 查询"}
          </button>
        </div>
      </section>

      {errorMessage ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </section>
      ) : null}

      {response ? (
        <section className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <article className="rounded-3xl border border-[#e2d8c8] bg-white/90 p-6 shadow-[0_18px_50px_-36px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#f2eadb] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[#85653a]">
                {SOURCE_LABEL[response.source]}
              </span>
              <span
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${riskClass}`}
              >
                风险：{response.data.risk_level}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                置信度：{Math.round(response.data.confidence * 100)}%
              </span>
            </div>

            <h2 className="text-2xl font-bold text-[#312716]">
              {response.data.release_name}
            </h2>
            <p className="mt-1 text-sm text-[#725e43]">
              <span className="font-medium">仓库：</span>
              <span className="font-mono">{response.repo}</span>
              <span className="mx-2">·</span>
              <span className="font-medium">Tag：</span>
              <span className="font-mono">{response.data.tag}</span>
            </p>
            <p className="mt-1 text-sm text-[#725e43]">
              发布时间：{prettyDate(response.data.published_at)}
            </p>
            <a
              href={response.data.release_url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-sm font-semibold text-[#8b5a1d] underline decoration-[#d7b072] underline-offset-4"
            >
              打开 GitHub Release
            </a>

            <h3 className="mt-6 text-sm font-semibold tracking-wide text-[#7b6648]">
              中文总结
            </h3>
            <p className="mt-2 whitespace-pre-wrap leading-7 text-[#2f2618]">
              {response.data.summary_zh}
            </p>
          </article>

          <article className="space-y-4">
            <div className="rounded-3xl border border-[#d8dfe4] bg-white/90 p-5 shadow-[0_16px_40px_-32px_rgba(0,0,0,0.35)]">
              <h3 className="text-sm font-semibold tracking-wide text-[#4e5d68]">
                破坏性变更
              </h3>
              {response.data.breaking_changes.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-[#28343f]">
                  {response.data.breaking_changes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[#6f7b85]">未识别到明显破坏性变更。</p>
              )}
            </div>

            <div className="rounded-3xl border border-[#d8dfe4] bg-white/90 p-5 shadow-[0_16px_40px_-32px_rgba(0,0,0,0.35)]">
              <h3 className="text-sm font-semibold tracking-wide text-[#4e5d68]">
                升级建议
              </h3>
              {response.data.upgrade_actions.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-[#28343f]">
                  {response.data.upgrade_actions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[#6f7b85]">暂无明确升级动作建议。</p>
              )}
            </div>

            <div className="rounded-3xl border border-[#e3d6c2] bg-[#fff9ee] p-5 shadow-[0_16px_40px_-32px_rgba(94,59,0,0.4)]">
              <h3 className="text-sm font-semibold tracking-wide text-[#7a5a2b]">
                翻译全文
              </h3>
              <p className="mt-2 max-h-[280px] overflow-auto whitespace-pre-wrap text-sm leading-6 text-[#45351f]">
                {response.data.translated_text_zh}
              </p>
            </div>
          </article>
        </section>
      ) : null}
    </div>
  );
}
