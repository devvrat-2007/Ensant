# FlowZint – Frontend Architecture

Enterprise Sales Assistant UI, built with **Next.js 14 App Router**, **TypeScript (strict)**, and **Tailwind CSS**.

---

## Folder Structure

```
flowzint/
├── app/
│   └── admin/
│       └── page.tsx            ← Wired demo page (SidebarLayout + AdminDashboard)
├── components/
│   ├── layout/
│   │   ├── SidebarLayout.tsx   ← Persistent app shell, mobile + desktop
│   │   └── index.ts
│   ├── admin/
│   │   ├── AdminDashboard.tsx  ← Control Tower (dark/technical)
│   │   └── index.ts
│   └── chat/                   ← (placeholder — add ChatInterface here)
├── lib/
│   └── mockAdminData.ts        ← Mock data factory for dev/Storybook
└── types/
    └── admin.ts                ← All TypeScript interfaces
```

---

## Setup

### 1. Install dependencies

```bash
npm install lucide-react
# Tailwind, TypeScript, and Next.js are assumed to already be installed.
```

### 2. Configure Tailwind

In `tailwind.config.ts`, ensure `content` covers your app:

```ts
content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
```

### 3. Add the Inter font (Next.js Font Optimization)

In `app/layout.tsx`:

```tsx
import { Inter } from "next/font/google";
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
```

### 4. Configure path aliases

In `tsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  }
}
```

---

## Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| User Portal bg | `bg-slate-50` | Chat pages |
| Admin bg | `bg-slate-950` | Admin Control Tower |
| Primary action | `bg-blue-600` | Buttons, active nav |
| Mono font | `font-mono` | Log data, codes, metrics |
| Glassmorphism | `bg-white/[0.04] backdrop-blur-md border border-white/[0.07]` | Admin cards |
| Spacing grid | `8px` base | Tailwind p-2 = 8px |

---

## Traffic-Light Status System

| Status | Dot colour | Glow | Use case |
|--------|-----------|------|---------|
| `success` | Emerald `#34D399` | Emerald glow | Completed operations |
| `warning` | Amber `#FBBF24` | Amber glow | SLA warnings, quota alerts |
| `error` | Rose `#FB7185` | Rose glow | Failed requests, auth errors |
| `info` | Sky `#38BDF8` | Sky glow | Informational system events |

---

## Production Checklist

- [ ] Replace `getMockAdminData()` with a real `fetch` in a Server Component or API route
- [ ] Add `next-auth` (or equivalent) and wire `onLogout` to `signOut()`
- [ ] Add `React.Suspense` boundaries around data-fetching Server Components
- [ ] Enable ISR / streaming for the admin page: `export const revalidate = 30`
- [ ] Add error boundaries (`error.tsx`) per route segment
- [ ] Wire `NavItem.badge` to a real unread-count API
- [ ] Replace `console.info` logout stub with real auth provider call
