import { z } from "zod";

const normalizeStringArray = z
  .union([z.array(z.string()), z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (Array.isArray(value)) {
      return value
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    if (typeof value === "string") {
      return value
        .split(/\n|;/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    }

    return [];
  });

const normalizeRiskLevel = z
  .preprocess(
    (value) => (typeof value === "string" ? value.toLowerCase().trim() : value),
    z.enum(["low", "medium", "high", "unknown"]).catch("unknown"),
  )
  .transform((value) => value as "low" | "medium" | "high" | "unknown");

const normalizeConfidence = z
  .preprocess((value) => {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0.5;
    }

    return 0.5;
  }, z.number().min(0).max(1))
  .catch(0.5);

export const aiOutputSchema = z.object({
  language_detected: z
    .string()
    .trim()
    .min(1)
    .default("unknown"),
  translated_text_zh: z
    .string()
    .trim()
    .min(1)
    .default("（原始发布说明为空或未提供可翻译内容）"),
  summary_zh: z
    .string()
    .trim()
    .min(1)
    .default("暂无可提炼的关键更新。"),
  breaking_changes: normalizeStringArray,
  upgrade_actions: normalizeStringArray,
  risk_level: normalizeRiskLevel,
  confidence: normalizeConfidence,
});

export const githubReleaseSchema = z.object({
  id: z.number().int().nonnegative(),
  tag_name: z.string().trim().min(1),
  name: z.string().nullable().optional().default(null),
  body: z.string().nullable().optional().default(null),
  html_url: z.string().url(),
  published_at: z.string().datetime().nullable().optional().default(null),
  prerelease: z.boolean().default(false),
  draft: z.boolean().default(false),
});

export const webhookPayloadSchema = z.object({
  action: z.string().trim().min(1),
  repository: z.object({
    full_name: z.string().trim().min(1),
  }),
  release: githubReleaseSchema,
});

export const releaseSummarySchema = z.object({
  repo: z.string().trim().min(1),
  release_id: z.number().int().nonnegative(),
  tag: z.string().trim().min(1),
  release_name: z.string().trim().min(1),
  release_url: z.string().url(),
  published_at: z.string().datetime(),
  prerelease: z.boolean(),
  language_detected: z.string().trim().min(1),
  original_body: z.string(),
  translated_text_zh: z.string(),
  summary_zh: z.string(),
  breaking_changes: z.array(z.string()),
  upgrade_actions: z.array(z.string()),
  risk_level: normalizeRiskLevel,
  confidence: normalizeConfidence,
  generated_at: z.string().datetime(),
  model: z.string().trim().min(1),
});
