export type RiskLevel = "low" | "medium" | "high" | "unknown";

export type SummarySource = "blob_cache" | "live_generated" | "webhook";

export interface GithubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
}

export interface ReleaseSummary {
  repo: string;
  release_id: number;
  tag: string;
  release_name: string;
  release_url: string;
  published_at: string;
  prerelease: boolean;
  language_detected: string;
  original_body: string;
  translated_text_zh: string;
  summary_zh: string;
  breaking_changes: string[];
  upgrade_actions: string[];
  risk_level: RiskLevel;
  confidence: number;
  generated_at: string;
  model: string;
}

export interface SummaryResult {
  source: SummarySource;
  data: ReleaseSummary;
}
