'use client';
import React, { useState } from 'react';
import { apiUrl } from '@/lib/api';

type FeedbackState = 'idle' | 'rating' | 'submitted' | 'error';

interface FeedbackBarProps {
  /** The AuditLog primary key returned by the backend for this response. */
  logId: number | null;
}

/**
 * FeedbackBar
 * -----------
 * Unobtrusive RLHF feedback widget rendered below each assistant message.
 *
 * Flow:
 *   1. User clicks 👍 or 👎  → component expands to show 1-5 star rating.
 *   2. User picks a star     → optional comment textarea appears.
 *   3. User submits          → POST /api/feedback/<logId>/ and collapses.
 *
 * If logId is null (e.g. the response came from a streaming path that hasn't
 * yet surfaced the DB id) the component renders nothing — it never blocks the
 * chat flow.
 */
export default function FeedbackBar({ logId }: FeedbackBarProps) {
  const [state, setState] = useState<FeedbackState>('idle');
  const [positive, setPositive] = useState<boolean | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [showComment, setShowComment] = useState(false);

  // Nothing to attach feedback to yet.
  if (logId === null) return null;

  const handleThumb = (isPositive: boolean) => {
    setPositive(isPositive);
    setState('rating');
  };

  const handleSubmit = async () => {
    if (positive === null) return;

    try {
      const token = localStorage.getItem('token');
      const authHeader = token ? { 'Authorization': `Token ${token}` } : {};
      const res = await fetch(apiUrl(`/api/feedback/${logId}/`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader },
        body: JSON.stringify({
          positive,
          rating: rating ?? undefined,
          comment: comment.trim() || undefined,
        }),
      });

      if (!res.ok) throw new Error('API error');
      setState('submitted');
    } catch {
      setState('error');
    }
  };

  // ── Submitted state ────────────────────────────────────────────────────────
  if (state === 'submitted') {
    return (
      <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-500 animate-in fade-in duration-300">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
        Feedback recorded — thank you.
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (state === 'error') {
    return (
      <div className="mt-3 text-xs text-rose-400">
        Could not save feedback. Please try again.
      </div>
    );
  }

  // ── Idle state: just the two thumb buttons ─────────────────────────────────
  if (state === 'idle') {
    return (
      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider select-none">
          Was this helpful?
        </span>
        <button
          aria-label="Thumbs up"
          onClick={() => handleThumb(true)}
          className="p-1 rounded-md text-slate-500 hover:text-emerald-400 hover:bg-white/5 transition-colors active:scale-90"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21H5a2 2 0 01-2-2v-7a2 2 0 012-2h2.924l4.924-5.5A1 1 0 0114 5v5z" />
          </svg>
        </button>
        <button
          aria-label="Thumbs down"
          onClick={() => handleThumb(false)}
          className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-white/5 transition-colors active:scale-90"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
              d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.736 3H19a2 2 0 012 2v7a2 2 0 01-2 2h-2.924l-4.924 5.5A1 1 0 0110 19v-5z" />
          </svg>
        </button>
      </div>
    );
  }

  // ── Rating state: star picker + optional comment ───────────────────────────
  return (
    <div className="mt-3 p-3 bg-chat-dark border border-white/5 rounded-xl flex flex-col gap-3 animate-in slide-in-from-bottom-2 duration-200">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">
          {positive ? '👍 Glad it helped! Rate the quality:' : '👎 Sorry about that. Rate the quality:'}
        </span>
        <button
          onClick={() => setState('idle')}
          aria-label="Dismiss feedback"
          className="text-slate-600 hover:text-slate-400 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Star rating */}
      <div className="flex items-center gap-1" role="group" aria-label="Rating 1 to 5">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            aria-label={`${star} star${star > 1 ? 's' : ''}`}
            onClick={() => {
              setRating(star);
              setShowComment(true);
            }}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(null)}
            className="transition-transform active:scale-90"
          >
            <svg
              className={`w-5 h-5 transition-colors ${
                (hovered ?? rating ?? 0) >= star
                  ? 'text-amber-400'
                  : 'text-slate-600'
              }`}
              fill={(hovered ?? rating ?? 0) >= star ? 'currentColor' : 'none'}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
              />
            </svg>
          </button>
        ))}
        {rating && (
          <span className="ml-2 text-xs text-slate-400">
            {['', 'Very poor', 'Poor', 'Acceptable', 'Good', 'Excellent'][rating]}
          </span>
        )}
      </div>

      {/* Optional comment */}
      {showComment && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional: what could be improved? (press Submit to skip)"
          rows={2}
          className="w-full bg-chat-mid border border-white/5 rounded-lg px-3 py-2 text-xs text-slate-300 placeholder-slate-600 resize-none focus:outline-none focus:border-chat-accent transition-colors"
        />
      )}

      {/* Submit */}
      {rating !== null && (
        <button
          onClick={handleSubmit}
          className="self-end px-4 py-1.5 bg-chat-accent hover:opacity-90 active:scale-95 text-white rounded-lg text-xs font-medium transition-all"
        >
          Submit
        </button>
      )}
    </div>
  );
}
