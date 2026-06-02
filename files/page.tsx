"use client";

// ─────────────────────────────────────────────────────────────────────────────
// FlowZint – /admin page
// app/admin/page.tsx
//
// Wires SidebarLayout + AdminDashboard together with real-world patterns:
// manual refresh, optimistic loading state, Router-level data ownership.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useCallback } from "react";
import { SidebarLayout } from "@/components/layout";
import { AdminDashboard } from "@/components/admin";
import { getMockAdminData } from "@/lib/mockAdminData";
import type { AdminData } from "@/types/admin";

// In production, replace this with a server action or API route:
// import { fetchAdminData } from "@/lib/api/admin";

export default function AdminPage() {
  const [data, setData] = useState<AdminData>(getMockAdminData);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Simulate network latency — swap with real fetch in production:
      // const fresh = await fetchAdminData();
      await new Promise((r) => setTimeout(r, 1200));
      setData(getMockAdminData());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const handleLogout = useCallback(() => {
    // Replace with real auth signout (e.g. next-auth signOut())
    console.info("[FlowZint] User logged out");
  }, []);

  return (
    <SidebarLayout isAdmin onLogout={handleLogout}>
      <AdminDashboard
        data={data}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
      />
    </SidebarLayout>
  );
}
