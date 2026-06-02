/**
 * Central API configuration.
 *
 * All fetch calls in the app should build URLs with `apiUrl(path)` rather
 * than hardcoding `http://127.0.0.1:8000`. This ensures:
 *
 *  1. The hostname always matches the one the browser used to load the page,
 *     preventing the "Failed to fetch" / CORS mismatch that occurs when the
 *     frontend is accessed via `localhost` but API calls target `127.0.0.1`
 *     (or vice-versa).
 *
 *  2. A single `.env.local` change (`NEXT_PUBLIC_API_URL`) is enough to
 *     point the whole app at a different backend (staging, production, etc.).
 *
 * Usage:
 *   import { apiUrl } from '@/lib/api';
 *   const res = await fetch(apiUrl('/api/chat/'));
 */

const BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');

/**
 * Build a full backend URL from a path.
 * The leading slash on `path` is optional.
 *
 * @example
 *   apiUrl('/api/chat/')   // → 'http://localhost:8000/api/chat/'
 *   apiUrl('api/admin/')   // → 'http://localhost:8000/api/admin/'
 */
export function apiUrl(path: string): string {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${normalised}`;
}
