// ─────────────────────────────────────────────────────────────────────────────
// FlowZint – Core TypeScript Interfaces
// types/admin.ts
// ─────────────────────────────────────────────────────────────────────────────

// ── Enums ────────────────────────────────────────────────────────────────────

export type LiveStatus = "online" | "degraded" | "offline";

export type LogStatus = "success" | "warning" | "error" | "info";

export type MetricTrend = "up" | "down" | "neutral";

export type LogCategory =
  | "AUTH"
  | "PIPELINE"
  | "AI_CALL"
  | "WEBHOOK"
  | "SYNC"
  | "BILLING"
  | "SYSTEM";

// ── Metric Card ───────────────────────────────────────────────────────────────

export interface MetricCard {
  /** Unique identifier for React key prop */
  id: string;
  /** Display label shown below the value */
  label: string;
  /** Primary numeric or string value displayed */
  value: string | number;
  /** Optional sub-label (e.g. "vs last 30d") */
  subLabel?: string;
  /** Percentage change, e.g. +12.4 or -3.1 */
  changePercent?: number;
  /** Direction of the metric change */
  trend?: MetricTrend;
  /** Lucide icon name passed as a string key */
  icon: string;
  /** Accent color class applied to the icon badge */
  accentColor: "blue" | "emerald" | "amber" | "rose" | "violet" | "cyan";
}

// ── Log Entry ─────────────────────────────────────────────────────────────────

export interface LogEntry {
  /** Unique log identifier (UUID or incrementing ID) */
  id: string;
  /** ISO 8601 timestamp string */
  timestamp: string;
  /** Traffic-light status for the row indicator */
  status: LogStatus;
  /** Log category tag */
  category: LogCategory;
  /** Short human-readable log message */
  message: string;
  /** Optional structured metadata for expandable rows */
  meta?: Record<string, string | number | boolean>;
  /** HTTP or internal status code, if applicable */
  code?: number;
  /** Duration in ms for timed operations */
  durationMs?: number;
  /** The actor (user ID, service name, etc.) that triggered this log */
  actor?: string;
}

// ── System Health ─────────────────────────────────────────────────────────────

export interface ServiceHealth {
  name: string;
  status: LiveStatus;
  /** Uptime percentage, e.g. 99.98 */
  uptimePercent: number;
  /** Average latency in ms */
  latencyMs: number;
}

export interface SystemHealth {
  overall: LiveStatus;
  services: ServiceHealth[];
  /** ISO 8601 timestamp of last health check */
  lastCheckedAt: string;
}

// ── Admin Dashboard Data ──────────────────────────────────────────────────────

export interface AdminData {
  /** Page title shown in the dashboard header */
  title: string;
  health: SystemHealth;
  metrics: MetricCard[];
  logs: LogEntry[];
  /** ISO 8601 timestamp when this data snapshot was generated */
  generatedAt: string;
}

// ── Sidebar Navigation ────────────────────────────────────────────────────────

export interface NavItem {
  label: string;
  href: string;
  /** Lucide icon name */
  icon: string;
  /** Whether to display an unread/active badge */
  badge?: number;
  /** Requires admin privileges */
  adminOnly?: boolean;
}

export interface SidebarConfig {
  appName: string;
  appVersion: string;
  navItems: NavItem[];
  user: {
    name: string;
    email: string;
    role: "admin" | "agent" | "viewer";
    avatarUrl?: string;
  };
}

// ── Utility types ─────────────────────────────────────────────────────────────

/** Generic async state wrapper for data-fetching hooks */
export interface AsyncState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
}

/** Paginated API response shape */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}
