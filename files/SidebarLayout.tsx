"use client";

// ─────────────────────────────────────────────────────────────────────────────
// FlowZint – SidebarLayout
// components/layout/SidebarLayout.tsx
//
// A persistent, responsive sidebar layout that wraps all pages.
// Mobile: sheet-style drawer via <Dialog>. Desktop: fixed sidebar.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  MessageSquare,
  ShieldCheck,
  LogOut,
  Menu,
  X,
  ChevronRight,
  Settings,
  Bell,
  Zap,
  Users,
  BarChart3,
} from "lucide-react";
import type { NavItem, SidebarConfig } from "@/types/admin";

// ── Icon map ──────────────────────────────────────────────────────────────────
// Maps icon string keys (from NavItem) to Lucide components.

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutDashboard,
  MessageSquare,
  ShieldCheck,
  Settings,
  Bell,
  Zap,
  Users,
  BarChart3,
};

// ── Default nav items ────────────────────────────────────────────────────────

const DEFAULT_NAV_ITEMS: NavItem[] = [
  { label: "Chat", href: "/chat", icon: "MessageSquare" },
  { label: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
  { label: "Analytics", href: "/analytics", icon: "BarChart3" },
  { label: "Team", href: "/team", icon: "Users" },
  { label: "Admin", href: "/admin", icon: "ShieldCheck", adminOnly: true },
  { label: "Settings", href: "/settings", icon: "Settings" },
];

// ── Props ─────────────────────────────────────────────────────────────────────

interface SidebarLayoutProps {
  children: React.ReactNode;
  config?: Partial<SidebarConfig>;
  /** Controls whether the admin section links are visible */
  isAdmin?: boolean;
  /** Callback invoked when the user clicks Logout */
  onLogout?: () => void;
}

// ── NavLink ───────────────────────────────────────────────────────────────────

interface NavLinkProps {
  item: NavItem;
  isActive: boolean;
  isCollapsed: boolean;
  onClick?: () => void;
}

function NavLink({ item, isActive, isCollapsed, onClick }: NavLinkProps) {
  const Icon = ICON_MAP[item.icon] ?? LayoutDashboard;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={isActive ? "page" : undefined}
      className={[
        "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium",
        "transition-all duration-150 ease-out",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        isActive
          ? "bg-blue-50 text-blue-700 shadow-sm"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        isCollapsed ? "justify-center" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Active accent bar */}
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-blue-600"
        />
      )}

      <Icon
        className={[
          "h-4 w-4 flex-shrink-0 transition-colors",
          isActive ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600",
        ].join(" ")}
      />

      {!isCollapsed && (
        <span className="flex-1 truncate">{item.label}</span>
      )}

      {!isCollapsed && item.badge !== undefined && item.badge > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-100 px-1.5 text-[10px] font-semibold tabular-nums text-blue-700">
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      )}

      {!isCollapsed && isActive && (
        <ChevronRight className="ml-auto h-3.5 w-3.5 text-blue-400" />
      )}

      {/* Tooltip for collapsed mode */}
      {isCollapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
        >
          {item.label}
        </span>
      )}
    </Link>
  );
}

// ── UserBadge ─────────────────────────────────────────────────────────────────

interface UserBadgeProps {
  user: SidebarConfig["user"];
  isCollapsed: boolean;
  onLogout?: () => void;
}

function UserBadge({ user, isCollapsed, onLogout }: UserBadgeProps) {
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const roleColors: Record<string, string> = {
    admin: "bg-violet-100 text-violet-700",
    agent: "bg-blue-100 text-blue-700",
    viewer: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="flex flex-col gap-1">
      <div
        className={[
          "flex items-center gap-3 rounded-lg bg-slate-50 p-2.5",
          "border border-slate-200/70",
          isCollapsed ? "justify-center" : "",
        ].join(" ")}
      >
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          {user.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={user.name}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
              {initials}
            </span>
          )}
          {/* Online dot */}
          <span
            aria-label="Online"
            className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-emerald-400"
          />
        </div>

        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800 leading-tight">
              {user.name}
            </p>
            <span
              className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${roleColors[user.role]}`}
            >
              {user.role}
            </span>
          </div>
        )}
      </div>

      {/* Logout */}
      <button
        onClick={onLogout}
        className={[
          "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
          "text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400",
          isCollapsed ? "justify-center" : "",
        ].join(" ")}
        aria-label="Log out"
      >
        <LogOut className="h-4 w-4 flex-shrink-0 transition-colors group-hover:text-red-500" />
        {!isCollapsed && <span>Log out</span>}
      </button>
    </div>
  );
}

// ── Sidebar (inner, reused by both desktop & mobile) ─────────────────────────

interface SidebarInnerProps {
  config: SidebarConfig;
  isAdmin: boolean;
  isCollapsed: boolean;
  pathname: string;
  onNavClick?: () => void;
  onLogout?: () => void;
  onToggleCollapse?: () => void;
}

function SidebarInner({
  config,
  isAdmin,
  isCollapsed,
  pathname,
  onNavClick,
  onLogout,
  onToggleCollapse,
}: SidebarInnerProps) {
  const visibleNav = config.navItems.filter(
    (item) => !item.adminOnly || isAdmin
  );

  const mainNav = visibleNav.filter(
    (item) => item.label !== "Settings" && item.label !== "Admin"
  );
  const bottomNav = visibleNav.filter(
    (item) => item.label === "Settings" || item.label === "Admin"
  );

  return (
    <div className="flex h-full flex-col bg-white border-r border-slate-200">
      {/* ── Logo / Header ── */}
      <div
        className={[
          "flex h-16 flex-shrink-0 items-center border-b border-slate-200",
          isCollapsed ? "justify-center px-4" : "justify-between px-5",
        ].join(" ")}
      >
        {!isCollapsed && (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 shadow-sm">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <span className="block text-[15px] font-bold tracking-tight text-slate-900 leading-none">
                FlowZint
              </span>
              <span className="block text-[10px] font-medium text-slate-400 mt-0.5 tracking-wider uppercase">
                {config.appVersion}
              </span>
            </div>
          </div>
        )}

        {isCollapsed && (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 shadow-sm">
            <Zap className="h-4 w-4 text-white" />
          </div>
        )}

        {/* Collapse toggle — desktop only */}
        {onToggleCollapse && (
          <button
            onClick={onToggleCollapse}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={[
              "hidden lg:flex h-7 w-7 items-center justify-center rounded-md",
              "text-slate-400 hover:bg-slate-100 hover:text-slate-700",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
              isCollapsed ? "mx-auto" : "",
            ].join(" ")}
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform duration-200 ${isCollapsed ? "" : "rotate-180"}`}
            />
          </button>
        )}
      </div>

      {/* ── Main Nav ── */}
      <nav
        aria-label="Main navigation"
        className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5"
      >
        {mainNav.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
            isCollapsed={isCollapsed}
            onClick={onNavClick}
          />
        ))}

        {/* Divider */}
        {bottomNav.length > 0 && (
          <div className="!my-3 border-t border-slate-100" />
        )}

        {bottomNav.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            isActive={pathname === item.href || pathname.startsWith(`${item.href}/`)}
            isCollapsed={isCollapsed}
            onClick={onNavClick}
          />
        ))}
      </nav>

      {/* ── User Badge + Logout ── */}
      <div className="flex-shrink-0 border-t border-slate-200 p-3">
        <UserBadge
          user={config.user}
          isCollapsed={isCollapsed}
          onLogout={onLogout}
        />
      </div>
    </div>
  );
}

// ── Default config (for demo/dev without explicit config prop) ────────────────

const DEFAULT_CONFIG: SidebarConfig = {
  appName: "FlowZint",
  appVersion: "v2.1.0",
  navItems: DEFAULT_NAV_ITEMS,
  user: {
    name: "Alex Rivera",
    email: "alex@flowzint.io",
    role: "admin",
  },
};

// ── SidebarLayout (main export) ───────────────────────────────────────────────

export function SidebarLayout({
  children,
  config: configProp,
  isAdmin = true,
  onLogout,
}: SidebarLayoutProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const config: SidebarConfig = {
    ...DEFAULT_CONFIG,
    ...configProp,
    user: { ...DEFAULT_CONFIG.user, ...(configProp?.user ?? {}) },
    navItems: configProp?.navItems ?? DEFAULT_NAV_ITEMS,
  };

  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const toggleCollapse = useCallback(() => setIsCollapsed((v) => !v), []);

  // Derived sidebar width for layout shift
  const sidebarWidth = isCollapsed ? "72px" : "240px";

  return (
    <div className="min-h-screen bg-slate-50 font-['Inter',sans-serif]">
      {/* ── Mobile: backdrop overlay ── */}
      {mobileOpen && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={closeMobile}
        />
      )}

      {/* ── Mobile: slide-in drawer ── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={[
          "fixed inset-y-0 left-0 z-40 w-60 transform transition-transform duration-300 ease-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        {/* Close button within drawer */}
        <button
          onClick={closeMobile}
          aria-label="Close navigation menu"
          className="absolute right-3 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X className="h-4 w-4" />
        </button>

        <SidebarInner
          config={config}
          isAdmin={isAdmin}
          isCollapsed={false}
          pathname={pathname}
          onNavClick={closeMobile}
          onLogout={onLogout}
        />
      </div>

      {/* ── Desktop: fixed sidebar ── */}
      <aside
        aria-label="Application sidebar"
        style={{ width: sidebarWidth }}
        className="fixed inset-y-0 left-0 z-20 hidden flex-col transition-all duration-300 ease-out lg:flex"
      >
        <SidebarInner
          config={config}
          isAdmin={isAdmin}
          isCollapsed={isCollapsed}
          pathname={pathname}
          onLogout={onLogout}
          onToggleCollapse={toggleCollapse}
        />
      </aside>

      {/* ── Main content area ── */}
      <div
        style={{ paddingLeft: `max(0px, ${sidebarWidth})` }}
        className="flex min-h-screen flex-col transition-all duration-300 ease-out lg:pl-[--sidebar-w]"
      >
        {/* Top bar (mobile only) */}
        <header className="sticky top-0 z-10 flex h-14 items-center gap-4 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md lg:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Mobile logo */}
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-600">
              <Zap className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-slate-900">FlowZint</span>
          </div>

          {/* Notification bell slot (mobile) */}
          <div className="ml-auto">
            <button
              aria-label="Notifications"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            >
              <Bell className="h-4.5 w-4.5" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}

export default SidebarLayout;
