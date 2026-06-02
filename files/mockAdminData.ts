// ─────────────────────────────────────────────────────────────────────────────
// FlowZint – Mock Data Factory
// lib/mockAdminData.ts
//
// Generates realistic mock data for development and Storybook usage.
// Replace these with real API calls in production.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AdminData,
  LogEntry,
  LogStatus,
  LogCategory,
  MetricCard,
  ServiceHealth,
} from "@/types/admin";

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoNow(offsetMs = 0): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

function randomMs(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min) + min);
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

// ── Mock log entries ──────────────────────────────────────────────────────────

const LOG_SAMPLES: Array<{
  status: LogStatus;
  category: LogCategory;
  message: string;
  code?: number;
  meta?: Record<string, string | number | boolean>;
}> = [
  {
    status: "success",
    category: "AUTH",
    message: "User token refreshed successfully",
    code: 200,
    meta: { userId: "usr_8xKQp", provider: "google", ttl: 3600 },
  },
  {
    status: "success",
    category: "AI_CALL",
    message: "GPT-4 completion returned 842 tokens",
    code: 200,
    meta: { model: "gpt-4-turbo", promptTokens: 312, completionTokens: 842, cost: 0.0124 },
  },
  {
    status: "warning",
    category: "PIPELINE",
    message: "CRM sync took longer than SLA threshold",
    code: 200,
    meta: { recordsSync: 1204, expectedMs: 2000, actualMs: 4812 },
  },
  {
    status: "error",
    category: "WEBHOOK",
    message: "Outbound webhook to Salesforce failed — connection timeout",
    code: 503,
    meta: { endpoint: "https://hooks.salesforce.com/...", retries: 3, lastError: "ETIMEDOUT" },
  },
  {
    status: "info",
    category: "BILLING",
    message: "Monthly usage report generated for workspace ws_PRD01",
    code: 200,
  },
  {
    status: "success",
    category: "SYNC",
    message: "HubSpot contacts synced — 58 new, 12 updated",
    code: 200,
    meta: { created: 58, updated: 12, skipped: 3 },
  },
  {
    status: "warning",
    category: "AI_CALL",
    message: "Rate limit approaching — 87% of monthly quota consumed",
    meta: { quotaUsed: 87000, quotaTotal: 100000 },
  },
  {
    status: "error",
    category: "AUTH",
    message: "Invalid API key presented for workspace ws_STG02",
    code: 401,
    meta: { ip: "203.0.113.42", keyPrefix: "fz_sk_..." },
  },
  {
    status: "info",
    category: "SYSTEM",
    message: "Scheduled maintenance window started — degraded mode active",
  },
  {
    status: "success",
    category: "PIPELINE",
    message: "Lead scoring pipeline completed for 344 prospects",
    code: 200,
    meta: { processed: 344, qualified: 81, disqualified: 263 },
  },
];

export function generateMockLogs(count = 10): LogEntry[] {
  return LOG_SAMPLES.slice(0, count).map((sample, i) => ({
    id: randomId(),
    timestamp: isoNow(i * randomMs(15_000, 90_000)),
    durationMs: randomMs(40, 5000),
    actor: `svc_${["pipeline", "auth", "ai", "billing", "sync"][i % 5]}`,
    ...sample,
  }));
}

// ── Mock metric cards ─────────────────────────────────────────────────────────

export const MOCK_METRICS: MetricCard[] = [
  {
    id: "m1",
    label: "Active Conversations",
    value: "1,248",
    subLabel: "vs last 30d",
    changePercent: 12.4,
    trend: "up",
    icon: "MessageSquare",
    accentColor: "blue",
  },
  {
    id: "m2",
    label: "Qualified Leads",
    value: "342",
    subLabel: "pipeline this month",
    changePercent: 8.1,
    trend: "up",
    icon: "TrendingUp",
    accentColor: "emerald",
  },
  {
    id: "m3",
    label: "AI Token Usage",
    value: "87K",
    subLabel: "of 100K monthly quota",
    changePercent: 3.6,
    trend: "up",
    icon: "Zap",
    accentColor: "amber",
  },
  {
    id: "m4",
    label: "Avg Response Time",
    value: "1.3s",
    subLabel: "p95 over 24h",
    changePercent: 11.2,
    trend: "down",
    icon: "Activity",
    accentColor: "rose",
  },
  {
    id: "m5",
    label: "Active Agents",
    value: "18",
    subLabel: "of 24 seats in use",
    icon: "Users",
    accentColor: "violet",
  },
  {
    id: "m6",
    label: "Integrations",
    value: "7",
    subLabel: "connected services",
    icon: "Server",
    accentColor: "cyan",
  },
];

// ── Mock service health ───────────────────────────────────────────────────────

export const MOCK_SERVICES: ServiceHealth[] = [
  { name: "API Gateway",        status: "online",   uptimePercent: 99.98, latencyMs: 42  },
  { name: "AI Inference",       status: "online",   uptimePercent: 99.91, latencyMs: 310 },
  { name: "CRM Sync Worker",    status: "degraded", uptimePercent: 97.40, latencyMs: 810 },
  { name: "Webhook Dispatcher", status: "online",   uptimePercent: 99.87, latencyMs: 65  },
  { name: "Analytics DB",       status: "online",   uptimePercent: 99.99, latencyMs: 28  },
];

// ── Full mock AdminData ────────────────────────────────────────────────────────

export function getMockAdminData(): AdminData {
  return {
    title: "Admin Control Tower",
    generatedAt: isoNow(),
    health: {
      overall: "degraded",
      lastCheckedAt: isoNow(45_000),
      services: MOCK_SERVICES,
    },
    metrics: MOCK_METRICS,
    logs: generateMockLogs(10),
  };
}
