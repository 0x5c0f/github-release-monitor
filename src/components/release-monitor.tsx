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

interface WatchedItem {
  repo: string;
  status: "cached" | "missing";
  source?: "blob_cache";
  data?: ReleaseSummary;
}

interface WatchedLatestResponse {
  ok: true;
  includePrerelease: boolean;
  total: number;
  cached: number;
  missing: number;
  items: WatchedItem[];
}

interface RevalidateSuccessResponse {
  ok: true;
  mode: "latest" | "by-tag";
  repo: string;
  source: "blob_cache" | "live_generated" | "webhook";
  data: ReleaseSummary;
  includePrerelease?: boolean;
}

interface ReleaseMonitorProps {
  defaultRepo: string;
  defaultIncludePrerelease: boolean;
  watchRepos: string[];
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

function toDetailResponse(item: WatchedItem): ApiSuccessResponse | null {
  if (item.status !== "cached" || !item.data) {
    return null;
  }

  return {
    ok: true,
    repo: item.repo,
    source: "blob_cache",
    data: item.data,
  };
}

export default function ReleaseMonitor({
  defaultRepo,
  defaultIncludePrerelease,
  watchRepos,
}: ReleaseMonitorProps) {
  const [repoInput, setRepoInput] = useState(defaultRepo);
  const [tagInput, setTagInput] = useState("");
  const [includePrerelease, setIncludePrerelease] = useState(
    defaultIncludePrerelease,
  );
  const [isWatchLoading, setIsWatchLoading] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [watchErrorMessage, setWatchErrorMessage] = useState<string | null>(null);
  const [response, setResponse] = useState<ApiSuccessResponse | null>(null);
  const [watchedItems, setWatchedItems] = useState<WatchedItem[]>([]);

  const watchRepoOptions = useMemo(() => {
    const options = Array.from(new Set(watchRepos.map((repo) => repo.trim()))).filter(
      (repo) => repo.length > 0,
    );

    if (options.length === 0 && defaultRepo.trim().length > 0) {
      return [defaultRepo.trim()];
    }

    return options;
  }, [defaultRepo, watchRepos]);

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

  async function callCacheApi(url: string): Promise<ApiSuccessResponse | null> {
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
        return null;
      }

      return json;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "请求失败，请稍后重试。";
      setErrorMessage(message);
      return null;
    }
  }

  async function triggerManualRefresh(body: {
    repo: string;
    includePrerelease?: boolean;
    tag?: string;
  }): Promise<boolean> {
    try {
      const res = await fetch("/api/releases/revalidate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const payload = (await res.json()) as
        | RevalidateSuccessResponse
        | ApiErrorResponse;
      if (!res.ok || !payload.ok) {
        const message = "error" in payload ? payload.error : "手动更新失败。";
        setErrorMessage(message);
        return false;
      }

      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "手动更新失败，请稍后重试。";
      setErrorMessage(message);
      return false;
    }
  }

  async function loadWatchedLatest(options?: { syncDetail?: boolean }) {
    const syncDetail = options?.syncDetail ?? true;
    setIsWatchLoading(true);
    setWatchErrorMessage(null);

    try {
      const params = new URLSearchParams({
        includePrerelease: includePrerelease ? "true" : "false",
      });
      const res = await fetch(`/api/releases/watch-latest?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      const payload = (await res.json()) as WatchedLatestResponse | ApiErrorResponse;
      if (!res.ok || !payload.ok) {
        const message = "error" in payload ? payload.error : "读取缓存失败。";
        setWatchErrorMessage(message);
        setWatchedItems([]);
        return;
      }

      setWatchedItems(payload.items);
      if (!repoInput && payload.items.length > 0) {
        setRepoInput(payload.items[0].repo);
      }

      if (syncDetail) {
        const current = payload.items.find((item) => item.repo === repoInput);
        const currentDetail = current ? toDetailResponse(current) : null;
        if (currentDetail) {
          setResponse(currentDetail);
        } else {
          setResponse(null);
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "读取缓存失败，请稍后重试。";
      setWatchErrorMessage(message);
      setWatchedItems([]);
    } finally {
      setIsWatchLoading(false);
    }
  }

  function handleSelectRepo(nextRepo: string) {
    setRepoInput(nextRepo);
    setTagInput("");
    setErrorMessage(null);

    const matched = watchedItems.find((item) => item.repo === nextRepo);
    const detail = matched ? toDetailResponse(matched) : null;
    if (detail) {
      setResponse(detail);
    } else {
      setResponse(null);
    }
  }

  function handleLoadLatest() {
    if (!repoInput) {
      setErrorMessage("请先选择仓库后再查询。");
      return;
    }

    const repo = repoInput.trim();
    void (async () => {
      setIsActionLoading(true);
      setErrorMessage(null);
      try {
        const updated = await triggerManualRefresh({
          repo,
          includePrerelease,
        });
        if (!updated) {
          return;
        }

        const params = new URLSearchParams({
          repo,
          includePrerelease: includePrerelease ? "true" : "false",
        });
        const cached = await callCacheApi(`/api/releases/latest?${params.toString()}`);
        if (cached) {
          setResponse(cached);
        }

        await loadWatchedLatest({ syncDetail: false });
      } finally {
        setIsActionLoading(false);
      }
    })();
  }

  function handleLoadByTag() {
    if (!repoInput) {
      setErrorMessage("请先选择仓库后再查询。");
      return;
    }

    const tag = tagInput.trim();
    if (!tag) {
      setErrorMessage("请输入 tag 后再查询。");
      return;
    }

    const repo = repoInput.trim();
    void (async () => {
      setIsActionLoading(true);
      setErrorMessage(null);
      try {
        const updated = await triggerManualRefresh({
          repo,
          tag,
        });
        if (!updated) {
          return;
        }

        const params = new URLSearchParams({
          repo,
          tag,
        });
        const cached = await callCacheApi(`/api/releases/by-tag?${params.toString()}`);
        if (cached) {
          setResponse(cached);
        }

        await loadWatchedLatest({ syncDetail: false });
      } finally {
        setIsActionLoading(false);
      }
    })();
  }

  useEffect(() => {
    void loadWatchedLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includePrerelease]);

  useEffect(() => {
    if (!repoInput && watchRepoOptions.length > 0) {
      setRepoInput(watchRepoOptions[0]);
    }
  }, [repoInput, watchRepoOptions]);

  return (
    <div className="w-full max-w-6xl space-y-6">
      <section className="rounded-3xl border border-[#d9ccb8] bg-[#fffaf2]/90 p-6 shadow-[0_24px_80px_-42px_rgba(125,95,42,0.65)] backdrop-blur">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold text-[#2f2516]">WATCH_REPOS 最新缓存概览</h2>
          <button
            type="button"
            onClick={() => void loadWatchedLatest()}
            disabled={isWatchLoading}
            className="rounded-full border border-[#c49d62] bg-white px-4 py-1.5 text-xs font-semibold text-[#7a5018] transition hover:bg-[#fff4e1] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isWatchLoading ? "刷新中..." : "刷新缓存视图"}
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-[#dac7a7] bg-[#fff4de] px-3 py-1 font-semibold text-[#7a5018]">
            总仓库：{watchedItems.length}
          </span>
          <span className="rounded-full border border-[#c8dbc4] bg-[#eef8ec] px-3 py-1 font-semibold text-[#2c6a2f]">
            已缓存：{watchedItems.filter((item) => item.status === "cached").length}
          </span>
          <span className="rounded-full border border-[#e7d8bc] bg-[#fff8ea] px-3 py-1 font-semibold text-[#8b6b3a]">
            缺缓存：{watchedItems.filter((item) => item.status === "missing").length}
          </span>
        </div>

        {watchErrorMessage ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {watchErrorMessage}
          </p>
        ) : null}

        {!watchErrorMessage ? (
          <div className="overflow-hidden rounded-2xl border border-[#dcc9aa] bg-white">
            <div className="max-h-64 divide-y divide-[#efe3cf] overflow-y-auto">
              {watchedItems.map((item) => (
                <button
                  key={`${item.repo}-${item.data?.tag ?? "missing"}`}
                  type="button"
                  onClick={() => handleSelectRepo(item.repo)}
                  className={`flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left transition ${
                    item.repo === repoInput
                      ? "bg-[#fff4de]"
                      : "bg-white hover:bg-[#fff8ec]"
                  }`}
                >
                  <p className="truncate font-mono text-xs text-[#5d4a2f]">{item.repo}</p>

                  <div className="shrink-0 text-right">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        item.status === "cached"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {item.status === "cached" ? "已缓存" : "缺缓存"}
                    </span>
                    <p className="mt-1 text-[11px] text-[#7a674a]">
                      {item.status === "cached" && item.data
                        ? `${item.data.tag} · ${prettyDate(item.data.published_at)}`
                        : "等待定时任务拉取"}
                    </p>
                  </div>
                </button>
              ))}

              {!isWatchLoading && watchedItems.length === 0 ? (
                <p className="px-4 py-3 text-sm text-[#674f2b]">
                  当前未读取到 WATCH_REPOS 缓存数据。
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-3xl border border-[#d9ccb8] bg-[#fffaf2]/90 p-6 shadow-[0_24px_80px_-42px_rgba(125,95,42,0.65)] backdrop-blur">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end">
          <label className="flex flex-1 flex-col gap-2">
            <span className="text-sm font-semibold tracking-wide text-[#7b6648]">
              仓库（owner/name）
            </span>
            <select
              value={repoInput}
              onChange={(event) => handleSelectRepo(event.target.value)}
              className="rounded-xl border border-[#d8c7ae] bg-white px-4 py-3 text-[#2c2418] outline-none transition focus:border-[#c79849] focus:ring-2 focus:ring-[#f5ddb6]"
              disabled={watchRepoOptions.length === 0}
            >
              {watchRepoOptions.length === 0 ? (
                <option value="">未配置 WATCH_REPOS</option>
              ) : null}
              {watchRepoOptions.map((repo) => (
                <option key={repo} value={repo}>
                  {repo}
                </option>
              ))}
            </select>
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
            disabled={isActionLoading || watchRepoOptions.length === 0}
            className="rounded-full bg-[#b4772c] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#99611f] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isActionLoading ? "更新中..." : "查询最新发布（手动更新）"}
          </button>
          <button
            type="button"
            onClick={handleLoadByTag}
            disabled={isActionLoading || watchRepoOptions.length === 0}
            className="rounded-full border border-[#c49d62] bg-white px-5 py-2.5 text-sm font-semibold text-[#7a5018] transition hover:bg-[#fff4e1] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isActionLoading ? "更新中..." : "按 Tag 查询（手动更新）"}
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
