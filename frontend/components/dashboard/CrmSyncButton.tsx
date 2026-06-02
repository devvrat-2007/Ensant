'use client';

import React, { useState } from 'react';
import { apiUrl } from '@/lib/api';
import { CloudUpload, CheckCircle, AlertCircle, Download } from 'lucide-react';

interface Message {
  role: string;
  content: string;
}

interface CrmSyncButtonProps {
  chatHistory: Message[];
  sessionId: string | null;
}

/**
 * Triggers a browser file-download of `payload` as a pretty-printed JSON
 * file. Uses the Blob API — no server round-trip required.
 *
 * @param payload  The object to serialise and download.
 * @param filename Suggested filename shown in the browser's save dialog.
 */
function downloadJson(payload: object, filename: string): void {
  const blob = new Blob(
    [JSON.stringify(payload, null, 2)],
    { type: 'application/json' },
  );
  const url = URL.createObjectURL(blob);

  // Create a temporary <a> element, click it programmatically, then clean up.
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();

  // Revoke the object URL on the next tick so the download has time to start.
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(anchor);
  }, 100);
}

export default function CrmSyncButton({ chatHistory, sessionId }: CrmSyncButtonProps) {
  const [isSyncing, setIsSyncing]       = useState<boolean>(false);
  const [isSuccess, setIsSuccess]       = useState<boolean>(false);
  const [crmRecordId, setCrmRecordId]   = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSync = async () => {
    if (!chatHistory || chatHistory.length === 0) return;

    setIsSyncing(true);
    setIsSuccess(false);
    setErrorMessage(null);

    try {
      const token = localStorage.getItem('token');
      const authHeader = token ? { 'Authorization': `Token ${token}` } : {};
      const response = await fetch(apiUrl('/api/crm/sync/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({ chat_history: chatHistory, session_id: sessionId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Sync Failed');
      }

      // ── Dual-action: update UI state AND trigger the JSON download ────────
      setCrmRecordId(data.crm_id);
      setIsSuccess(true);

      // Build a descriptive filename: crm-<id>-<ISO date>.json
      const timestamp = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
      const filename  = `crm-${data.crm_id ?? 'export'}-${timestamp}.json`;

      // The download payload is the structured data object returned by the
      // backend (lead_name, key_pain_points, action_items) plus the CRM ID
      // and the timestamp so the file is self-documenting.
      downloadJson(
        {
          crm_id:    data.crm_id,
          synced_at: new Date().toISOString(),
          ...data.data,
        },
        filename,
      );

      // Auto-dismiss the success badge after 5 s.
      setTimeout(() => {
        setIsSuccess(false);
        setCrmRecordId('');
      }, 5000);

    } catch (error: any) {
      const errorStr = error.toString();
      if (errorStr.includes('429') || errorStr.includes('RESOURCE_EXHAUSTED')) {
        setErrorMessage('Traffic Alert: Wait 60s');
      } else {
        setErrorMessage('Sync Failed: Check Logs');
      }
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setIsSyncing(false);
    }
  };

  const isDisabled = isSyncing || chatHistory.length === 0;

  return (
    <div className="flex items-center gap-4">

      {/* ── Primary action button ─────────────────────────────────────────── */}
      <button
        onClick={handleSync}
        disabled={isDisabled}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
          isDisabled
            ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
            : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg hover:shadow-indigo-500/25 active:scale-95'
        }`}
      >
        {isSyncing ? (
          <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        ) : (
          <CloudUpload className="w-4 h-4" />
        )}
        {isSyncing ? 'Syncing...' : 'Save to CRM'}
      </button>

      {/* ── Success badge — shows record ID + download confirmation ─────── */}
      {isSuccess && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium animate-in slide-in-from-left-2 fade-in duration-300">
          <CheckCircle className="w-4 h-4 flex-shrink-0" />
          <span>Record {crmRecordId} Saved</span>
          <span className="text-emerald-500/60 mx-0.5">·</span>
          <Download className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="text-xs">JSON Downloaded</span>
        </div>
      )}

      {/* ── Error badge ───────────────────────────────────────────────────── */}
      {errorMessage && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium animate-in slide-in-from-left-2 fade-in duration-300">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

    </div>
  );
}
