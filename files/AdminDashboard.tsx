"use client";

// ─────────────────────────────────────────────────────────────────────────────
// FlowZint – AdminDashboard
// components/admin/AdminDashboard.tsx
//
// Admin Control Tower — dark/technical aesthetic, glassmorphism containers,
// font-mono data surfaces, traffic-light status system.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Filter,
  MessageSquare,
  Minus,
  RefreshCcw,
  Server,
  TrendingUp,
  Users,
  XCircle,
  Zap,
  BarChart3,
  ShieldCheck,
} from "lucide-react";
import type {
  AdminData,
  LogEntry,
  LogStatus,
  LiveStatus,
  MetricCard,
  MetricTrend,
  ServiceHealth,
} from "@/types/admin";

// ── Icon map for MetricCard.icon ──────────────────────────────────────────────

const METRIC_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Activity,
  MessageSquare,
  Users,
  TrendingUp,
  Server,
  Zap,
  BarChart3,
  ShieldCheck,
};

// ── Color maps ────────────────────────────────────────────────────────────────

const ACCENT_COLORS = {
  blue:    { bg: "bg-blue-500/10",   icon: "text-blue-400",   ring: "ring-blue-500/20"   },
  emerald: { bg: "bg-emerald-500/10",icon: "text-emerald-400",ring: "ring-emerald-500/20" },
  amber:   { bg: "bg-amber-500/10",  icon: "text-amber-400",  ring: "ring-amber-500/20"  },
  rose:    { bg: "bg-rose-500/10",   icon: "text-rose-400",   ring: "ring-rose-500/20"   },
  violet:  { bg: "bg-violet-500/10", icon: "text-violet-400", ring: "ring-violet-500/20" },
  cyan:    { bg: "bg-cyan-500/10",   icon: "text-cyan-400",   ring: "ring-cyan-500/20"   },
} as const;

// ── Traffic-light status configs ──────────────────────────────────────────────

const LOG_STATUS_CONFIG: Record<
  LogStatus,
  { dot: string; badge: string; label: string }
> = {
  success: {
    dot:   "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.6)]",
    badge: "bg-emerald-400/10 text-emerald-300 ring-1 ring-emerald-400/20",
    label: "SUCCESS",
  },
  warning: {
    dot:   "bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.6)]",
    badge: "bg-amber-400/10 text-amber-300 ring-1 ring-amber-400/20",
    label: "WARN",
  },
  error: {
    dot:   "bg-rose-400 shadow-[0_0_6px_rgba(251,113,133,0.6)]",
    badge: "bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/20",
    label: "ERROR",
  },
  info: {
    dot:   "bg-sky-400 shadow-[0_0_6px_rgba(56,189,248,0.5)]",
    badge: "bg-sky-400/10 text-sky-300 ring-1 ring-sky-400/20",
    label: "INFO",
  },
};

const LIVE_STATUS_CONFIG: Record<
  LiveStatus,
  { pulse: string; dot: string; text: string; label: string }
> = {
  online:   { pulse: "animate-pulse bg-emerald-400", dot: "bg-emerald-400", text: "text-emerald-400", label: "All Systems Online" },
  degraded: { pulse: "animate-pulse bg-amber-400",   dot: "bg-amber-400",   text: "text-amber-400",   label: "Partial Degradation"  },
  offline:  { pulse: "",                              dot: "bg-rose-500",    text: "text-rose-400",    label: "System Offline"       },
};

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

// ── GlassCard ─────────────────────────────────────────────────────────────────
// The signature glassmorphism container used throughout the Admin Control Tower.

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  padding?: "sm" | "md" | "lg";
}

function GlassCard({ children, className = "", padding = "md" }: GlassCardProps) {
  const padMap = { sm: "p-4", md: "p-5", lg: "p-6" };
  return (
    <div
      className={[
        "rounded-xl border border-white/[0.07]",
        "bg-white/[0.04] backdrop-blur-md",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
        padMap[padding],
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

// ── LiveStatusBadge ───────────────────────────────────────────────────────────

interface LiveStatusBadgeProps {
  status: LiveStatus;
  lastCheckedAt: string;
}

function LiveStatusBadge({ status, lastCheckedAt }: LiveStatusBadgeProps) {
  const cfg = LIVE_STATUS_CONFIG[status];
  const timeAgo = formatTimeAgo(lastCheckedAt);

  return (
    <div className="flex items-center gap-3">
      {/* Pulse ring + dot */}
      <span className="relative flex h-3 w-3">
        <span
          className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${cfg.pulse}`}
        />
        <span className={`relative inline-flex h-3 w-3 rounded-full ${cfg.dot}`} />
      </span>

      <div className="flex flex-col leading-none">
        <span className={`text-sm font-semibold ${cfg.text}`}>{cfg.label}</span>
        <span className="mt-0.5 font-mono text-[10px] text-slate-500">
          checked {timeAgo}
        </span>
      </div>
    </div>
  );
}

// ── MetricCardItem ─────────────────────────────────────────────────────────────

interface MetricCardItemProps {
  card: MetricCard;
}

function MetricCardItem({ card }: MetricCardItemProps) {
  const accent = ACCENT_COLORS[card.accentColor];
  const Icon = METRIC_ICONS[card.icon] ?? Activity;

  const TrendIcon =
    card.trend === "up"
      ? ArrowUpRight
      : card.trend === "down"
      ? ArrowDownRight
      : Minus;

  const trendColor =
    card.trend === "up"
      ? "text-emerald-400"
      : card.trend === "down"
      ? "text-rose-400"
      : "text-slate-500";

  return (
    <GlassCard className="flex flex-col gap-4">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
          {card.label}
        </p>
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 ${accent.bg} ${accent.ring}`}
        >
          <Icon className={`h-4 w-4 ${accent.icon}`} />
        </span>
      </div>

      {/* Value */}
      <div className="flex items-end justify-between gap-2">
        <span className="font-mono text-2xl font-bold tracking-tight text-white">
          {card.value}
        </span>

        {card.changePercent !== undefined && (
          <div className={`flex items-center gap-0.5 ${trendColor}`}>
            <TrendIcon className="h-3.5 w-3.5" />
            <span className="font-mono text-xs font-semibold">
              {Math.abs(card.changePercent).toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* Sub-label */}
      {card.subLabel && (
        <p className="text-[11px] text-slate-500">{card.subLabel}</p>
      )}
    </GlassCard>
  );
}

// ── ServiceHealthRow ──────────────────────────────────────────────────────────

interface ServiceHealthRowProps {
  service: ServiceHealth;
}

function ServiceHealthRow({ service }: ServiceHealthRowProps) {
  const cfg = LIVE_STATUS_CONFIG[service.status];

  return (
    <div className="flex items-center gap-3 py-2">
      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${cfg.dot}`} />
      <span className="flex-1 font-mono text-xs text-slate-300">{service.name}</span>
      <span className="font-mono text-xs text-slate-500">
        {service.latencyMs}ms
      </span>
      <span className="font-mono text-xs text-slate-500">
        {service.uptimePercent.toFixed(2)}%
      </span>
    </div>
  );
}

// ── LogRow ────────────────────────────────────────────────────────────────────

interface LogRowProps {
  entry: LogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}

function LogRow({ entry, isExpanded, onToggle }: LogRowProps) {
  const cfg = LOG_STATUS_CONFIG[entry.status];
  const hasMeta = entry.meta && Object.keys(entry.meta).length > 0;

  return (
    <>
      <tr
        className={[
          "border-b border-white/[0.04] transition-colors",
          hasMeta ? "cursor-pointer hover:bg-white/[0.03]" : "",
          isExpanded ? "bg-white/[0.03]" : "",
        ].join(" ")}
        onClick={hasMeta ? onToggle : undefined}
        aria-expanded={hasMeta ? isExpanded : undefined}
      >
        {/* Status dot */}
        <td className="px-4 py-3 text-center">
          <span
            aria-label={`Status: ${cfg.label}`}
            className={`inline-block h-2 w-2 rounded-full ${cfg.dot}`}
          />
        </td>

        {/* Timestamp */}
        <td className="whitespace-nowrap px-4 py-3">
          <span className="font-mono text-xs text-slate-500">
            {formatTimestamp(entry.timestamp)}
          </span>
        </td>

        {/* Status badge */}
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center rounded px-2 py-0.5 font-mono text-[10px] font-bold tracking-wider ${cfg.badge}`}
          >
            {cfg.label}
          </span>
        </td>

        {/* Category */}
        <td className="px-4 py-3">
          <span className="font-mono text-xs font-semibold text-slate-400">
            {entry.category}
          </span>
        </td>

        {/* Message */}
        <td className="max-w-xs px-4 py-3">
          <p className="truncate font-mono text-xs text-slate-300">
            {entry.message}
          </p>
        </td>

        {/* Duration */}
        <td className="whitespace-nowrap px-4 py-3 text-right">
          <span className="font-mono text-xs text-slate-600">
            {entry.durationMs !== undefined ? `${entry.durationMs}ms` : "—"}
          </span>
        </td>

        {/* Code */}
        <td className="whitespace-nowrap px-4 py-3 text-right">
          <span
            className={`font-mono text-xs font-semibold ${
              entry.code && entry.code >= 400
                ? "text-rose-400"
                : entry.code && entry.code >= 200
                ? "text-emerald-400"
                : "text-slate-500"
            }`}
          >
            {entry.code ?? "—"}
          </span>
        </td>

        {/* Expand toggle */}
        {hasMeta && (
          <td className="px-4 py-3 text-right">
            {isExpanded ? (
              <ChevronUp className="ml-auto h-3.5 w-3.5 text-slate-500" />
            ) : (
              <ChevronDown className="ml-auto h-3.5 w-3.5 text-slate-600" />
            )}
          </td>
        )}
        {!hasMeta && <td />}
      </tr>

      {/* Expanded metadata row */}
      {isExpanded && hasMeta && (
        <tr className="border-b border-white/[0.04] bg-slate-900/60">
          <td colSpan={8} className="px-8 pb-4 pt-2">
            <pre className="rounded-lg border border-white/[0.06] bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-slate-400 overflow-x-auto">
              {JSON.stringify(entry.meta, null, 2)}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

// ── LogTable ──────────────────────────────────────────────────────────────────

interface LogTableProps {
  logs: LogEntry[];
}

type FilterStatus = LogStatus | "all";

function LogTable({ logs }: LogTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [sortAsc, setSortAsc] = useState(false);

  const toggleRow = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filteredLogs = useMemo(() => {
    const base =
      filterStatus === "all"
        ? logs
        : logs.filter((l) => l.status === filterStatus);
    return [...base].sort((a, b) => {
      const diff =
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return sortAsc ? diff : -diff;
    });
  }, [logs, filterStatus, sortAsc]);

  const FILTERS: { value: FilterStatus; label: string }[] = [
    { value: "all", label: "All" },
    { value: "success", label: "Success" },
    { value: "warning", label: "Warning" },
    { value: "error", label: "Error" },
    { value: "info", label: "Info" },
  ];

  return (
    <GlassCard padding="sm" className="overflow-hidden">
      {/* Table header row */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-mono text-xs font-semibold uppercase tracking-widest text-slate-500">
            Filter
          </span>
        </div>

        <div
          role="group"
          aria-label="Filter log entries by status"
          className="flex flex-wrap gap-1.5"
        >
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilterStatus(value)}
              className={[
                "rounded-md px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors",
                filterStatus === value
                  ? "bg-blue-600 text-white"
                  : "bg-white/[0.05] text-slate-400 hover:bg-white/[0.1] hover:text-slate-200",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setSortAsc((v) => !v)}
          aria-label={`Sort by time ${sortAsc ? "descending" : "ascending"}`}
          className="flex items-center gap-1.5 rounded-md bg-white/[0.05] px-2.5 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:bg-white/[0.1] hover:text-slate-200"
        >
          <Clock className="h-3 w-3" />
          {sortAsc ? "Oldest" : "Newest"}
        </button>
      </div>

      {/* Scrollable table */}
      <div className="overflow-x-auto rounded-lg">
        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b border-white/[0.07]">
              {["", "Timestamp", "Status", "Category", "Message", "Duration", "Code", ""].map(
                (h, i) => (
                  <th
                    key={i}
                    className="px-4 py-2.5 text-left font-mono text-[10px] font-bold uppercase tracking-widest text-slate-600 last:text-right"
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {filteredLogs.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-12 text-center font-mono text-xs text-slate-600">
                  No log entries match the current filter.
                </td>
              </tr>
            ) : (
              filteredLogs.map((entry) => (
                <LogRow
                  key={entry.id}
                  entry={entry}
                  isExpanded={expandedIds.has(entry.id)}
                  onToggle={() => toggleRow(entry.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer count */}
      <p className="mt-3 px-1 font-mono text-[10px] text-slate-600">
        Showing {filteredLogs.length} of {logs.length} entries
      </p>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AdminDashboard (main export)
// ─────────────────────────────────────────────────────────────────────────────

interface AdminDashboardProps {
  data: AdminData;
  /** Called when user clicks the refresh button */
  onRefresh?: () => void;
  isRefreshing?: boolean;
}

export function AdminDashboard({
  data,
  onRefresh,
  isRefreshing = false,
}: AdminDashboardProps) {
  const { title, health, metrics, logs, generatedAt } = data;

  return (
    // Dark Control Tower canvas
    <div className="min-h-screen bg-slate-950 font-['Inter',sans-serif] text-white">
      {/* Subtle grid overlay for technical feel */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[linear-gradient(rgba(148,163,184,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.025)_1px,transparent_1px)] bg-[size:48px_48px]"
      />

      <div className="relative mx-auto max-w-screen-xl px-4 py-8 sm:px-6 lg:px-8">
        {/* ── Dashboard Header ─────────────────────────────────────────────── */}
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600/20 ring-1 ring-blue-500/30">
                <ShieldCheck className="h-5 w-5 text-blue-400" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                {title}
              </h1>
            </div>
            <p className="mt-2 font-mono text-xs text-slate-500">
              Snapshot generated:{" "}
              <time dateTime={generatedAt}>{formatTimestamp(generatedAt)}</time>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {/* Live status badge */}
            <LiveStatusBadge
              status={health.overall}
              lastCheckedAt={health.lastCheckedAt}
            />

            {/* Refresh button */}
            <button
              onClick={onRefresh}
              disabled={isRefreshing}
              aria-label="Refresh dashboard data"
              className={[
                "flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3.5 py-2",
                "font-mono text-xs font-semibold text-slate-300 transition-all",
                "hover:border-white/20 hover:bg-white/[0.08] hover:text-white",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                "disabled:cursor-not-allowed disabled:opacity-50",
              ].join(" ")}
            >
              <RefreshCcw
                className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
              />
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        {/* ── Metric Cards ─────────────────────────────────────────────────── */}
        <section aria-labelledby="metrics-heading" className="mb-8">
          <h2 id="metrics-heading" className="sr-only">
            Key metrics
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {metrics.map((card) => (
              <MetricCardItem key={card.id} card={card} />
            ))}
          </div>
        </section>

        {/* ── Middle row: Services health + quick stats ─────────────────── */}
        <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Service health panel */}
          <section aria-labelledby="services-heading" className="lg:col-span-1">
            <GlassCard>
              <div className="mb-4 flex items-center justify-between">
                <h2
                  id="services-heading"
                  className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400"
                >
                  Service Health
                </h2>
                <Server className="h-3.5 w-3.5 text-slate-600" />
              </div>
              <div className="divide-y divide-white/[0.04]">
                {health.services.map((svc) => (
                  <ServiceHealthRow key={svc.name} service={svc} />
                ))}
              </div>
            </GlassCard>
          </section>

          {/* Activity summary panel */}
          <section aria-labelledby="activity-heading" className="lg:col-span-2">
            <GlassCard className="h-full">
              <div className="mb-4 flex items-center justify-between">
                <h2
                  id="activity-heading"
                  className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400"
                >
                  Log Summary
                </h2>
                <Activity className="h-3.5 w-3.5 text-slate-600" />
              </div>

              {/* Traffic light summary */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {(
                  [
                    { status: "success", Icon: CheckCircle2, color: "text-emerald-400" },
                    { status: "warning", Icon: AlertTriangle, color: "text-amber-400"  },
                    { status: "error",   Icon: XCircle,       color: "text-rose-400"   },
                    { status: "info",    Icon: Circle,        color: "text-sky-400"    },
                  ] as const
                ).map(({ status, Icon, color }) => {
                  const count = logs.filter((l) => l.status === status).length;
                  const cfg = LOG_STATUS_CONFIG[status];
                  return (
                    <div
                      key={status}
                      className="flex flex-col gap-2 rounded-lg border border-white/[0.05] bg-white/[0.03] p-3"
                    >
                      <div className="flex items-center gap-2">
                        <Icon className={`h-3.5 w-3.5 ${color}`} />
                        <span
                          className={`font-mono text-[10px] font-bold uppercase tracking-wider ${
                            cfg.badge.split(" ").find((c) => c.startsWith("text-")) ?? "text-slate-400"
                          }`}
                        >
                          {cfg.label}
                        </span>
                      </div>
                      <span className="font-mono text-2xl font-bold text-white">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Error rate bar */}
              <div className="mt-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    Error Rate
                  </span>
                  <span className="font-mono text-xs font-semibold text-slate-300">
                    {logs.length > 0
                      ? (
                          (logs.filter((l) => l.status === "error").length /
                            logs.length) *
                          100
                        ).toFixed(1)
                      : "0.0"}
                    %
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rose-600 to-rose-400 transition-all duration-700"
                    style={{
                      width:
                        logs.length > 0
                          ? `${(
                              (logs.filter((l) => l.status === "error").length /
                                logs.length) *
                              100
                            ).toFixed(1)}%`
                          : "0%",
                    }}
                  />
                </div>
              </div>
            </GlassCard>
          </section>
        </div>

        {/* ── Data Log Table ────────────────────────────────────────────────── */}
        <section aria-labelledby="logs-heading">
          <div className="mb-3 flex items-center gap-3">
            <h2
              id="logs-heading"
              className="font-mono text-xs font-bold uppercase tracking-widest text-slate-400"
            >
              System Log Stream
            </h2>
            {/* Blinking live indicator */}
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-mono text-[10px] text-slate-600">LIVE</span>
          </div>

          <LogTable logs={logs} />
        </section>
      </div>
    </div>
  );
}

export default AdminDashboard;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}
