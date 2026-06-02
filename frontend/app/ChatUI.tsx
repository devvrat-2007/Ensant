'use client';
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CrmSyncButton from '../components/dashboard/CrmSyncButton';
import FeedbackBar from '../components/dashboard/FeedbackBar';
import { useRouter } from 'next/navigation';
import { apiUrl } from '@/lib/api';

// ── ThinkingIndicator ────────────────────────────────────────────────────────
// Three dots with staggered opacity pulses. Pure Tailwind — no extra deps.
// Rendered as the last bubble while isLoading is true (before the first SSE
// chunk arrives). Disappears automatically once content starts streaming in.
function ThinkingIndicator() {
  return (
    <div
      role="status"
      aria-label="AI is thinking..."
      aria-live="polite"
      className="flex items-center gap-1.5 px-4 py-3"
    >
      <span
        className="w-2 h-2 rounded-full bg-slate-400 animate-pulse"
        style={{ animationDelay: '0ms', animationDuration: '1.2s' }}
      />
      <span
        className="w-2 h-2 rounded-full bg-slate-400 animate-pulse"
        style={{ animationDelay: '200ms', animationDuration: '1.2s' }}
      />
      <span
        className="w-2 h-2 rounded-full bg-slate-400 animate-pulse"
        style={{ animationDelay: '400ms', animationDuration: '1.2s' }}
      />
    </div>
  );
}
// ────────────────────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
  extras?: any;
  sources?: string[];
  matchScore?: number;
  /** AuditLog primary key — populated after the stream closes so the
   *  FeedbackBar can POST to /api/feedback/<logId>/. */
  logId?: number | null;
  isWebSearch?: boolean;
}

class Typewriter {
    queue: string[] = [];
    isTyping = false;
    onUpdate: (text: string) => void;
    currentText = "";

    constructor(onUpdate: (text: string) => void) {
        this.onUpdate = onUpdate;
    }

    add(text: string) {
        this.queue.push(...text.split(''));
        if (!this.isTyping) this.type();
    }

    type() {
        if (this.queue.length === 0) {
            this.isTyping = false;
            return;
        }
        this.isTyping = true;
        this.currentText += this.queue.shift();
        this.onUpdate(this.currentText);
        
        // Ultra-fast static delay of 2ms for rendering
        setTimeout(() => this.type(), 2); 
    }
}

export default function ChatUI() {
  const router = useRouter();

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      router.push('/login');
    }
  }, [router]);

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    return token ? { 'Authorization': `Token ${token}` } : {};
  };

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<{id: string, title: string, updated_at: string}[]>([]);

  const fetchSessions = async () => {
    try {
      const res = await fetch(apiUrl('/api/sessions/'), { headers: getAuthHeaders() as HeadersInit });
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
    }
  };

  const loadSession = async (sessionId: string) => {
    try {
      const res = await fetch(apiUrl(`/api/sessions/${sessionId}/`), { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const loadedMessages: Message[] = [];

        // Sentinel strings written by agentic/system actions. Any log whose
        // user_prompt starts with one of these was never a real user turn and
        // must not be replayed into the chat history.
        const AGENTIC_PREFIXES = [
          'System:',
          'Agentic Action:',
          'Summarize this context',
          'Draft an internal briefing',
          'Convert the previous competitor',
          'Generate a structured competitor',
          'Please summarize the current chat',
        ];

        const isAgenticEntry = (prompt: string): boolean =>
          AGENTIC_PREFIXES.some(prefix => prompt.startsWith(prefix));

        for (const msg of data.messages) {
          // Skip system/agentic entries — the backend filters is_agentic=False
          // but this guard catches any edge cases where the flag was not set.
          if (isAgenticEntry(msg.user_prompt)) continue;

          loadedMessages.push({ role: 'user', content: msg.user_prompt });
          loadedMessages.push({
            role: 'assistant',
            content: msg.ai_response,
            sources: msg.metadata?.sources,
            matchScore: msg.metadata?.score,
          });
        }

        setMessages(loadedMessages);
        setCurrentSessionId(sessionId);
      }
    } catch (err) {
      console.error('Failed to load session:', err);
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setCurrentSessionId(null);
    setInput('');
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setSelectedFile(file);
      if (file.type.startsWith('image/')) {
          setPreviewUrl(URL.createObjectURL(file));
      } else {
          setPreviewUrl(null);
      }
      e.target.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && !selectedFile) return;

    // ── IMAGE → VISION PATH ──────────────────────────────────────────────
    // Images are sent inline to the chat endpoint for direct visual analysis
    // (Gemini vision). Documents (PDF/txt/md) take the RAG-embedding path below.
    if (selectedFile && selectedFile.type.startsWith('image/')) {
        const imageFile = selectedFile;
        const visionPrompt = input.trim() || 'Analyze this image in detail.';

        setMessages(prev => [...prev, { role: 'user', content: visionPrompt }]);
        setInput('');
        setIsLoading(true);

        const formData = new FormData();
        formData.append('image', imageFile);
        formData.append('message', visionPrompt);
        if (currentSessionId) formData.append('session_id', currentSessionId);

        try {
            // NOTE: do NOT set Content-Type manually — the browser must add the
            // multipart boundary itself.
            const response = await fetch(apiUrl('/api/chat/'), {
                method: 'POST',
                headers: getAuthHeaders(),
                body: formData,
            });

            // Vision path always returns JSON. Guard against an unexpected
            // stream (e.g. if the image falls through to the SSE pipeline).
            const ct = response.headers.get('content-type') ?? '';
            if (!ct.includes('application/json')) {
                throw new Error(`Vision endpoint returned unexpected content-type: ${ct}`);
            }

            const data = await response.json();
            setIsLoading(false);

            if (!response.ok || data.error) {
                setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error || 'Image analysis failed.'}` }]);
            } else {
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: data.content || 'Analysis complete.',
                    extras: data.extras,
                }]);
                if (data.session_id && !currentSessionId) {
                    setCurrentSessionId(data.session_id);
                    fetchSessions();
                }
            }
        } catch (error) {
            setIsLoading(false);
            console.error('Vision request failed:', error);
            setMessages(prev => [...prev, { role: 'assistant', content: 'Network error during image analysis.' }]);
        } finally {
            setSelectedFile(null);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
        }
        return;
    }

    if (selectedFile) {
        setIsUploading(true);
        setUploadStatus("Starting upload...");
        const formData = new FormData();
        formData.append('file', selectedFile);
        if (currentSessionId) {
            formData.append('session_id', currentSessionId);
        }
        
        try {
            const response = await fetch(apiUrl('/api/upload/'), { method: 'POST', headers: getAuthHeaders(), body: formData });
            const data = await response.json();

            if (!response.ok || data.error) {
                alert(`Upload failed: ${data.error || 'Unknown error'}`);
                return;
            }

            // The backend accepts the file (202) and embeds it in a background
            // Celery task. Poll the task-status endpoint so real failures surface
            // instead of a permanent "processing" state.
            const taskId = data.task_id;
            setUploadStatus("Embedding document...");

            const pollTask = async (): Promise<void> => {
                const maxAttempts = 60; // ~2 minutes at 2s intervals
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    await new Promise(r => setTimeout(r, 2000));
                    let statusData;
                    try {
                        const statusRes = await fetch(apiUrl(`/api/task/${taskId}/`), { headers: getAuthHeaders() });
                        statusData = await statusRes.json();
                    } catch (err) {
                        continue; // transient network blip; keep polling
                    }

                    if (statusData.state === 'SUCCESS') {
                        const result = statusData.result || {};
                        setMessages(prev => [...prev, {
                            role: "assistant",
                            content: `📁 **Document Ingested Successfully!** \n\nI have processed \`${result.file_name || selectedFile.name}\` into ${result.chunks_processed ?? 'several'} chunks and embedded them into the vector knowledge base. You can now ask questions directly about its content.`
                        }]);
                        return;
                    }

                    if (statusData.state === 'FAILURE') {
                        setMessages(prev => [...prev, {
                            role: "assistant",
                            content: `⚠️ **Document Processing Failed.** \n\nI couldn't embed \`${selectedFile.name}\`. ${statusData.error || 'Please try again shortly.'}`
                        }]);
                        return;
                    }
                    // PENDING / STARTED / RETRY → keep polling.
                }
                setMessages(prev => [...prev, {
                    role: "assistant",
                    content: `⏳ \`${selectedFile.name}\` is taking longer than expected to process. It will continue in the background.`
                }]);
            };

            await pollTask();
        } catch (error) {
            console.error("Error uploading:", error);
            alert("Error uploading file.");
        } finally {
            setIsUploading(false);
            setSelectedFile(null);
            setUploadStatus(null);
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
        }
    }

    if (!input.trim()) return;

    const userMessage = input;
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setInput('');
    setIsLoading(true); // Show ThinkingIndicator immediately
    try {
      const response = await fetch(apiUrl('/api/chat/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ message: userMessage, session_id: currentSessionId }),
      });

      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
          const data = await response.json();
          setIsLoading(false); // JSON response received — hide indicator
          if (!response.ok || data.error) {
              setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error || "Unknown error occurred"}` }]);
              return;
          }
          setMessages(prev => [...prev, {
              role: 'assistant',
              content: data.content || data.response || "Task completed successfully.",
              extras: data.extras
          }]);
          if (data.session_id && !currentSessionId) {
              setCurrentSessionId(data.session_id);
              fetchSessions();
          }
          return;
      }

      if (!response.body) { setIsLoading(false); return; }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      // The assistant bubble is NOT pre-appended here — it is added on the
      // first real text chunk so the ThinkingIndicator stays visible until
      // actual content arrives.
      let assistantBubbleAdded = false;
      // The `metadata` SSE event arrives BEFORE the first text chunk (i.e.
      // before the assistant bubble exists). Buffer it here and apply it at
      // the moment the bubble is created so sources/score attach to the
      // assistant message rather than leaking onto the user message.
      let pendingMeta: { sources?: string[]; matchScore?: number } | null = null;

      // Adds the assistant bubble exactly once, merging any buffered metadata.
      const ensureAssistantBubble = () => {
          if (assistantBubbleAdded) return;
          assistantBubbleAdded = true;
          setIsLoading(false);
          const meta = pendingMeta;
          pendingMeta = null;
          setMessages(prev => [...prev, {
              role: 'assistant',
              content: '',
              ...(meta ? { sources: meta.sources, matchScore: meta.matchScore } : {}),
          }]);
      };

      // Set up the typewriter to update the last message in state
      const typewriter = new Typewriter((newText) => {
          setMessages(prev => {
              const updated = [...prev];
              const lastIndex = updated.length - 1;
              // Ensure we create a completely new object reference for React to detect the change
              updated[lastIndex] = { ...updated[lastIndex], content: newText };
              return updated;
          });
      });
      let streamBuffer = "";
      let currentEventType = "message";

      while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split("\n");
          streamBuffer = lines.pop() || "";

          for (const line of lines) {
              const cleanedLine = line.trim();

              // A blank line terminates an SSE event; reset the event type.
              if (!cleanedLine) {
                  currentEventType = "message";
                  continue;
              }

              // Capture the SSE event type (e.g. "event: metadata").
              if (cleanedLine.startsWith("event: ")) {
                  currentEventType = cleanedLine.substring(7).trim();
                  continue;
              }

              if (!cleanedLine.startsWith("data: ")) continue;

              const payloadString = cleanedLine.substring(6).trim();

              if (payloadString === "[DONE]") continue;

              // Metadata arrives as a dedicated SSE event, not an inline prefix.
              if (currentEventType === "metadata") {
                  try {
                      const metaData = JSON.parse(payloadString);
                      if (!assistantBubbleAdded) {
                          // Bubble not created yet — buffer the metadata so it
                          // can be merged in when the bubble is first added.
                          pendingMeta = { sources: metaData.sources, matchScore: metaData.score };
                      } else {
                          setMessages(prev => {
                              const updated = [...prev];
                              const lastIndex = updated.length - 1;
                              updated[lastIndex] = {
                                  ...updated[lastIndex],
                                  sources: metaData.sources,
                                  matchScore: metaData.score
                              };
                              return updated;
                          });
                      }
                  } catch (e) {
                      console.error("Failed to parse metadata event", e);
                  }
                  continue;
              }

              // log_id event: emitted after the stream closes so the
              // FeedbackBar can attach ratings to the correct AuditLog row.
              if (currentEventType === "log_id") {
                  try {
                      const logData = JSON.parse(payloadString);
                      // If no text ever streamed, make sure the assistant
                      // bubble exists before attaching the log id (otherwise
                      // it would leak onto the user message).
                      ensureAssistantBubble();
                      setMessages(prev => {
                          const updated = [...prev];
                          const lastIndex = updated.length - 1;
                          updated[lastIndex] = {
                              ...updated[lastIndex],
                              logId: logData.log_id ?? null
                          };
                          return updated;
                      });
                  } catch (e) {
                      console.error("Failed to parse log_id event", e);
                  }
                  continue;
              }
              // Standard text streaming.
              try {
                  const parsed = JSON.parse(payloadString);
                  if (parsed.text) {
                      // First chunk: add the assistant bubble and hide the
                      // ThinkingIndicator before handing off to the typewriter.
                      ensureAssistantBubble();
                      typewriter.add(parsed.text);
                  }
              } catch (e) {
                  // A JSON parse failure here means we received a partial/
                  // fragmented payload. Never dump raw JSON into the chat —
                  // discard it and log for diagnostics. Complete SSE events are
                  // reassembled via the streamBuffer above.
                  console.warn("Discarding unparseable SSE chunk:", payloadString);
              }
          }
      }
      // For streaming responses, check the X-Session-Id header
      const streamSessionId = response.headers.get('X-Session-Id');
      if (streamSessionId && !currentSessionId) {
          setCurrentSessionId(streamSessionId);
          fetchSessions();
      }
      // Safety net: if the stream closed without ever sending a text chunk
      // (e.g. metadata-only or empty response), clear the indicator now.
      setIsLoading(false);
    } catch (error) { setIsLoading(false); setMessages(prev => [...prev, { role: 'assistant', content: "Network Error." }]); }
  };

  const handleConfirmWebSearch = async (allowed: boolean) => {
      if (!allowed) {
          setMessages(prev => [...prev, { role: 'assistant', content: 'Understood. Keeping research strictly confined to internal documents.' }]);
          return;
      }
      const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || "";
      setMessages(prev => [...prev, { role: 'assistant', content: 'Searching the live web now... Please hold.' }]);
      try {
          const response = await fetch(apiUrl('/api/chat/'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({ message: lastUserMessage, allow_web_search: true, session_id: currentSessionId }),
          });

          // The web-search path returns JSON; the general-knowledge fallback
          // returns SSE. Check Content-Type and handle both correctly.
          const ct = response.headers.get('content-type') ?? '';
          if (ct.includes('application/json')) {
              const data = await response.json();
              if (response.ok) {
                  setMessages(prev => [...prev, { role: 'assistant', content: data.content, extras: data.extras, isWebSearch: true }]);
                  if (data.session_id && !currentSessionId) {
                      setCurrentSessionId(data.session_id);
                      fetchSessions();
                  }
              }
          } else {
              // SSE stream — reuse the same reader logic as handleSubmit.
              if (!response.body) return;
              const reader = response.body.getReader();
              const decoder = new TextDecoder('utf-8');
              let assistantAdded = false;
              let streamBuffer = '';
              let currentEventType = 'message';

              const typewriter = new Typewriter((newText) => {
                  setMessages(prev => {
                      const updated = [...prev];
                      updated[updated.length - 1] = { ...updated[updated.length - 1], content: newText };
                      return updated;
                  });
              });

              while (true) {
                  const { value, done } = await reader.read();
                  if (done) break;
                  streamBuffer += decoder.decode(value, { stream: true });
                  const lines = streamBuffer.split('\n');
                  streamBuffer = lines.pop() ?? '';

                  for (const line of lines) {
                      const cl = line.trim();
                      if (!cl) { currentEventType = 'message'; continue; }
                      if (cl.startsWith('event: ')) { currentEventType = cl.substring(7).trim(); continue; }
                      if (!cl.startsWith('data: ')) continue;
                      const payload = cl.substring(6).trim();
                      if (payload === '[DONE]') continue;
                      if (currentEventType === 'metadata') continue; // no source bar for web-search
                      if (currentEventType === 'log_id') continue;
                      try {
                          const parsed = JSON.parse(payload);
                          if (parsed.text) {
                              if (!assistantAdded) {
                                  assistantAdded = true;
                                  // Replace the "Searching..." placeholder bubble.
                                  setMessages(prev => {
                                      const updated = [...prev];
                                      updated[updated.length - 1] = { role: 'assistant', content: '', isWebSearch: true };
                                      return updated;
                                  });
                              }
                              typewriter.add(parsed.text);
                          }
                      } catch { /* discard unparseable chunk */ }
                  }
              }
              const streamSessionId = response.headers.get('X-Session-Id');
              if (streamSessionId && !currentSessionId) {
                  setCurrentSessionId(streamSessionId);
                  fetchSessions();
              }
          }
      } catch (error) { console.error("Error:", error); }
  };

  const handleDirectTask = async (taskType: string, contentToSummarize: string) => {
      let prompt = taskType === 'executive_summary'
        ? `Please summarize the current chat context into an Executive Summary.\n\nContext:\n${contentToSummarize}`
        : taskType === 'email' 
        ? `Draft an internal briefing email summarizing these tech headlines:\n\n${contentToSummarize}`
        : taskType === 'slide'
        ? `Convert the previous competitor analysis data into a strict, professional slide-by-slide presentation outline. Structure it as Slide 1: Title, Slide 2: Executive Summary, etc., and include bullet points for slide content alongside brief speaker notes.\n\n${contentToSummarize}`
        : `Generate a structured competitor battlecard comparing FlowZint to Salesforce and HubSpot based on our target positioning:\n\n${contentToSummarize}`;
      
      const userMsg = taskType === 'executive_summary' ? 'Summarize this context for the Executive team.' : taskType === 'email' ? 'Draft an internal briefing email summarizing those headlines.' : taskType === 'slide' ? 'Convert the previous competitor analysis data into a strict, professional slide-by-slide presentation outline. Structure it as Slide 1: Title, Slide 2: Executive Summary, etc., and include bullet points for slide content alongside brief speaker notes.' : 'Generate a structured competitor battlecard comparing FlowZint to Salesforce and HubSpot based on our target positioning.';
      const assistMsg = taskType === 'executive_summary' ? 'Distilling executive summary now... Please hold.' : taskType === 'email' ? 'Drafting your briefing email now... Please hold.' : taskType === 'slide' ? 'Generating your slide deck outline now... Please hold.' : 'Generating your battlecard now... Please hold.';
      
      setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
      setMessages(prev => [...prev, { role: 'assistant', content: assistMsg }]);
      try {
          const response = await fetch(apiUrl('/api/chat/'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({ message: prompt, is_direct_task: true, task_type: taskType, session_id: currentSessionId }),
          });
          
          if (response.status === 401) {
              localStorage.removeItem('token');
              router.push('/login');
              return;
          }

          // Direct tasks always return JSON, but guard against a stream just in case.
          const ct = response.headers.get('content-type') ?? '';
          if (!ct.includes('application/json')) {
              console.error('handleDirectTask: unexpected non-JSON response', ct);
              return;
          }
          const data = await response.json();
          if (response.ok) {
              setMessages(prev => [...prev, { role: 'assistant', content: data.reply || data.content, extras: data.extras }]);
              if (data.session_id && !currentSessionId) {
                  setCurrentSessionId(data.session_id);
                  fetchSessions();
              }
          }
      } catch (error) { console.error("Error:", error); }
  };

  const handleClearChat = async () => {
      handleNewChat();
      try {
          await fetch(apiUrl('/api/chat/'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({ clear_history: true })
          });
      } catch (error) {
          console.error("Failed to clear backend chat cache:", error);
      }
  };

  const handlePushToSlack = async (text: string) => {
      try {
          const response = await fetch(apiUrl('/api/slack/'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
              body: JSON.stringify({ text }),
          });
          
          if (response.status === 401) {
              localStorage.removeItem('token');
              router.push('/login');
              return;
          }

          if (response.ok) {
              alert("Successfully pushed to Slack!");
          } else {
              alert("Failed to push to Slack.");
          }
      } catch (error) {
          console.error("Slack error:", error);
          alert("Network error while pushing to Slack.");
      }
  };

  // ── Shared ReactMarkdown component map ──────────────────────────────────
  // Defined once here so both <ReactMarkdown> instances stay in sync and the
  // object reference is stable across renders (no inline object allocation).
  //
  // KEY FIX: the `p` renderer uses <div> instead of <p>.
  // react-markdown wraps every paragraph — including ones that contain a
  // fenced code block — in a <p> tag. A <pre> inside a <p> is invalid HTML
  // and triggers Next.js hydration errors:
  //   "In HTML, <pre> cannot be a descendant of <p>."
  // Rendering as <div> preserves all visual styling while producing valid DOM.
  const mdComponents = {
    // Block-level wrappers
    p:     ({ node, ...props }: any) => <div className="leading-relaxed text-slate-200 my-2" {...props} />,
    ul:    ({ node, ...props }: any) => <ul    className="list-disc ml-4 space-y-1 my-2 text-slate-300" {...props} />,
    ol:    ({ node, ...props }: any) => <ol    className="list-decimal ml-4 space-y-1 my-2 text-slate-300" {...props} />,
    h1:    ({ node, ...props }: any) => <h1    className="font-bold text-white text-xl mt-4 mb-2" {...props} />,
    h2:    ({ node, ...props }: any) => <h2    className="font-bold text-white text-lg mt-3 mb-2" {...props} />,
    h3:    ({ node, ...props }: any) => <h3    className="font-bold text-white text-md mt-2 mb-1" {...props} />,

    // Table elements
    table: ({ node, ...props }: any) => (
      <div className="overflow-x-auto my-4">
        <table className="min-w-full divide-y divide-white/5 border border-white/5 rounded-lg shadow-sm" {...props} />
      </div>
    ),
    thead: ({ node, ...props }: any) => <thead className="bg-white/5" {...props} />,
    th:    ({ node, ...props }: any) => <th    className="px-4 py-3 text-left text-xs font-semibold text-slate-300 uppercase tracking-wider" {...props} />,
    td:    ({ node, ...props }: any) => <td    className="px-4 py-3 whitespace-normal text-slate-400 border-t border-white/5" {...props} />,

    // Code: inline stays <code>, fenced blocks become <pre><code>.
    // The `inline` prop is injected by react-markdown — true for backtick
    // spans, false/undefined for fenced blocks.
    code:  ({ node, inline, className, children, ...props }: any) =>
      inline
        ? <code className="bg-white/10 text-chat-accent px-1.5 rounded text-xs font-mono" {...props}>{children}</code>
        : <pre  className="bg-chat-dark text-slate-300 p-4 rounded-lg overflow-x-auto text-xs font-mono my-4 border border-white/5"><code {...props}>{children}</code></pre>,
  };
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen w-full bg-chat-light text-slate-200 font-sans overflow-hidden">
      {/* === LEFT SIDEBAR === */}
      <aside className="w-64 bg-chat-dark text-slate-300 flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-white/5">
          <h2 className="text-white font-bold text-lg mb-4">FlowZint Workspace</h2>
          <button
            onClick={handleNewChat}
            className="w-full px-4 py-2.5 bg-chat-accent hover:opacity-90 active:scale-95 text-white rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            New Conversation
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <p className="px-2 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Recent Chats</p>
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => loadSession(s.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors truncate mb-1 ${
                currentSessionId === s.id
                  ? 'bg-chat-mid text-slate-200 font-medium shadow-sm'
                  : 'text-slate-400 hover:bg-chat-mid hover:text-slate-200'
              }`}
            >
              {s.title}
            </button>
          ))}
          {sessions.length === 0 && (
            <p className="text-slate-500 text-xs text-center mt-4 italic">No conversations yet</p>
          )}
        </div>
      </aside>

      {/* === MAIN CHAT AREA === */}
      <main className="flex-1 flex flex-col h-screen min-w-0 bg-chat-light relative">
        <header className="h-16 bg-chat-light/90 backdrop-blur-md border-b border-white/5 flex items-center justify-between px-6 flex-shrink-0 z-10 sticky top-0">
          <h1 className="text-lg font-bold text-white">Enterprise Sales Assistant</h1>
          <div className="flex items-center gap-3">
              <CrmSyncButton chatHistory={messages} sessionId={currentSessionId} />
              <button onClick={handleClearChat} className="px-3 py-1.5 bg-chat-mid text-slate-300 hover:bg-white/10 hover:text-white rounded-md text-sm font-medium transition-colors border border-white/5">
                  Clear
              </button>
              <button onClick={() => { localStorage.removeItem('token'); router.push('/login'); }} className="px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-md text-sm font-medium transition-colors border border-red-500/20">
                  Logout
              </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          <div className="max-w-3xl mx-auto w-full">
            {messages.length === 0 && (
                <div className="text-center mt-20">
                    <div className="w-16 h-16 bg-chat-mid border border-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4">
                        <span className="text-3xl">✨</span>
                    </div>
                    <h2 className="text-xl font-bold text-white mb-2">How can I help you today?</h2>
                    <p className="text-slate-400">Ask a question or upload a document to get started.</p>
                </div>
            )}
            
            {messages.map((msg, idx) => {              const rawContent: unknown = msg.content;
              const textContent = typeof rawContent === 'string'
                ? rawContent
                : ((rawContent as { text?: string })?.text || JSON.stringify(rawContent) || "");
              return (
              <div key={idx} className={`mb-6 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`inline-block p-4 max-w-[85%] text-left shadow-sm ${
                    msg.role === 'user' 
                        ? 'bg-chat-accent text-white rounded-2xl rounded-tr-sm' 
                        : 'bg-chat-mid border border-white/5 text-slate-200 rounded-2xl rounded-tl-sm'
                }`}>
                  {msg.role === 'user' ? (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{textContent}</p>
                  ) : textContent.includes('Subject:') && textContent.includes('Dear') ? (
                    <div className="rounded-lg overflow-hidden border border-white/5 shadow-sm bg-chat-dark">
                      <div className="bg-chat-dark px-4 py-2 border-b border-white/5 flex items-center gap-2">
                        <div className="flex gap-1.5">
                          <div className="w-3 h-3 rounded-full bg-red-400"></div>
                          <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                          <div className="w-3 h-3 rounded-full bg-green-400"></div>
                        </div>
                        <span className="text-[10px] font-bold text-slate-500 mx-auto tracking-widest">NEW MESSAGE DRAFT</span>
                      </div>
                      <div className="p-6 text-sm text-slate-200">
                        <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            components={mdComponents}
                        >
                          {textContent}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm">
                        <ReactMarkdown 
                            remarkPlugins={[remarkGfm]}
                            components={mdComponents}
                        >
                          {textContent}
                        </ReactMarkdown>
                    </div>
                  )}
                  {msg.sources && msg.sources.length > 0 && (
                      <div className="mt-4 border border-white/5 rounded-xl p-3 bg-chat-dark shadow-sm flex flex-col gap-2">
                          {msg.isWebSearch && (
                              <div className="text-xs font-semibold text-slate-400 mb-1 flex items-center gap-2">
                                  <span>🌐</span>
                                  <em>Information compiled from the live web:</em>
                              </div>
                          )}
                          <div className="flex justify-between items-center text-xs font-semibold mt-1">
                              <span className="text-slate-400 uppercase tracking-wider">AI Confidence</span>
                              <span className={
                                  msg.isWebSearch ? "text-blue-400" :
                                  msg.matchScore! >= 80 ? "text-emerald-500" :
                                  msg.matchScore! >= 60 ? "text-amber-500" :
                                  "text-rose-500"
                              }>
                                  {msg.isWebSearch ? "Live Web Source" :
                                   msg.matchScore! >= 80 ? "High Certainty" :
                                   msg.matchScore! >= 60 ? "Human Review Advised" :
                                   "Low Certainty (Fallback)"}
                                  {` (${msg.isWebSearch ? 0 : msg.matchScore || 0}%)`}
                              </span>
                          </div>
                          <div className="w-full bg-chat-mid rounded-full h-2 overflow-hidden border border-white/5">
                              <div 
                                  className={`h-full rounded-full transition-all duration-1000 ease-out ${
                                      msg.isWebSearch ? "bg-blue-400" :
                                      msg.matchScore! >= 80 ? "bg-emerald-500" :
                                      msg.matchScore! >= 60 ? "bg-amber-500" :
                                      "bg-rose-500"
                                  }`}
                                  style={{ width: `${msg.isWebSearch ? 0 : msg.matchScore || 0}%` }}
                              />
                          </div>
                          <div className="flex flex-wrap gap-2 mt-2">
                              {msg.sources.map((source, i) => (
                                  <button
                                      key={i}
                                      onClick={() => alert('In a production environment, this would open ' + source + ' in a secure PDF viewer.')}
                                      className="group flex items-center gap-1.5 px-2.5 py-1 bg-chat-mid border border-white/5 rounded-md text-[11px] text-slate-300 font-medium transition-all duration-200 hover:bg-chat-light hover:border-chat-accent hover:text-chat-accent active:scale-95"
                                  >
                                      <svg className="w-3 h-3 text-slate-500 group-hover:text-chat-accent transition-colors flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                                      </svg>
                                      <span className="truncate max-w-[200px]">{source}</span>
                                  </button>
                              ))}
                          </div>
                      </div>
                  )}
                  {msg.role === 'assistant' && (textContent.includes('Subject:') || textContent.includes('Dear')) && (
                      <button onClick={() => window.location.href = `mailto:?subject=Enterprise%20Sales%20Update&body=${encodeURIComponent(textContent)}`} className="mt-4 px-4 py-2 bg-chat-dark border border-white/5 text-slate-200 rounded-lg text-sm font-medium hover:bg-chat-light transition-colors">✉️ Open Draft in Mail Client</button>
                  )}
                  {msg.role === 'assistant' && msg.extras?.requires_consent && (
                      <div className="mt-4 flex gap-2">
                          <button onClick={() => handleConfirmWebSearch(true)} className="px-4 py-2 bg-chat-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-colors shadow-sm">👍 Yes, Search Web</button>
                          <button onClick={() => handleConfirmWebSearch(false)} className="px-4 py-2 bg-chat-dark border border-white/5 text-slate-300 rounded-lg text-sm font-medium hover:bg-chat-light transition-colors shadow-sm">👎 No, Keep It Internal</button>
                      </div>
                  )}
                  {msg.role === 'assistant' && !msg.content.startsWith('⚠️') && !msg.content.includes('[System Error]') && !msg.content.includes('Please hold.') && (
                      <div className="flex flex-col gap-2 mt-4 border-t border-white/5 pt-4">
                          {!(textContent.includes('Executive Summary') || textContent.includes('Distilling executive summary')) && (
                              <button 
                                  onClick={() => handleDirectTask('executive_summary', msg.content)} 
                                  className="w-full px-4 py-2 bg-chat-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-colors flex items-center justify-center gap-2 shadow-sm"
                              >
                                  👔 Summarize for Execs
                              </button>
                          )}
                          
                          <div className="flex gap-2">
                              {!(textContent.includes('Subject:') || textContent.includes('Dear')) && (
                                  <button onClick={() => handleDirectTask('email', msg.content)} className="flex-1 px-4 py-2 bg-chat-dark text-slate-300 border border-white/5 rounded-lg text-sm font-medium hover:bg-chat-light transition-colors shadow-sm">📝 Draft Email</button>
                              )}
                              {!(textContent.includes('Battlecard') || textContent.includes('positioning matrix')) && (
                                  <button onClick={() => handleDirectTask('battlecard', msg.content)} className="flex-1 px-4 py-2 bg-chat-dark text-slate-300 border border-white/5 rounded-lg text-sm font-medium hover:bg-chat-light transition-colors shadow-sm">📊 Battlecard</button>
                              )}
                          </div>
                          <div className="flex gap-2">
                              {!(textContent.includes('Slide 1:') || textContent.includes('Presentation Outline')) && (
                                  <button onClick={() => handleDirectTask('slide', msg.content)} className="flex-1 px-4 py-2 bg-chat-dark text-slate-300 border border-white/5 rounded-lg text-sm font-medium hover:bg-chat-light transition-colors shadow-sm">🖥️ Slides Outline</button>
                              )}
                              <button onClick={() => handlePushToSlack(msg.content)} className="flex-1 px-4 py-2 bg-chat-dark text-slate-300 border border-white/5 rounded-lg text-sm font-medium hover:bg-chat-light transition-colors shadow-sm">💬 Slack</button>
                          </div>
                      </div>
                  )}
                  {/* RLHF Feedback — only shown on non-agentic assistant messages */}
                  {msg.role === 'assistant' && !msg.extras?.requires_consent && (
                      <FeedbackBar logId={msg.logId ?? null} />
                  )}
                </div>
              </div>
            )})}

            {/* ThinkingIndicator — rendered as a sibling AFTER the map so it
                never triggers re-renders of existing message bubbles.
                Visible only while isLoading is true (before the first SSE
                text chunk arrives). */}
            {isLoading && (
              <div className="mb-6 flex justify-start">
                <div className="inline-block bg-chat-mid border border-white/5 rounded-2xl rounded-tl-sm shadow-sm">
                  <ThinkingIndicator />
                </div>
              </div>
            )}          </div>
        </div>
        
        {/* === FLOATING INPUT BAR === */}
        <div className="p-4 bg-chat-dark border-t border-white/5">
          <div className="max-w-3xl mx-auto relative">
            {selectedFile && (
              <div className="absolute bottom-full mb-3 left-0 right-0 shadow-lg z-20 flex items-center gap-3 p-3 bg-chat-mid border border-white/5 rounded-xl">
                {previewUrl ? <img src={previewUrl} alt="Preview" className="h-12 w-12 object-cover rounded-lg border border-white/5" /> : <div className="h-12 w-12 bg-chat-dark border border-white/5 text-chat-accent rounded-lg flex items-center justify-center text-xl">📄</div>}
                <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-sm font-semibold text-slate-200 truncate">{selectedFile.name}</span>
                    <span className="text-xs text-slate-400">{(selectedFile.size / 1024).toFixed(1)} KB</span>
                </div>
                {uploadStatus && (
                    <span className="text-xs font-bold text-chat-accent animate-pulse px-3">
                        {uploadStatus}
                    </span>
                )}
                <button type="button" onClick={() => { setSelectedFile(null); setPreviewUrl(null); }} className="w-8 h-8 flex items-center justify-center text-slate-500 hover:bg-white/5 hover:text-slate-300 rounded-full transition-colors">✕</button>
              </div>
            )}
            <form onSubmit={handleSubmit} className="flex gap-2 relative">
                <label className={`flex items-center justify-center ${isUploading ? 'bg-white/5 text-slate-600 cursor-not-allowed' : 'bg-white/5 hover:bg-white/10 text-slate-400 cursor-pointer'} w-12 h-12 rounded-full transition-colors flex-shrink-0 shadow-sm border border-white/5`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                  <input type="file" accept=".pdf,.txt,.md,image/png,image/jpeg,image/jpg" onChange={handleFileUpload} disabled={isUploading} className="hidden" />
                </label>
                <div className="flex-1 bg-chat-mid border border-white/5 focus-within:border-chat-accent focus-within:ring-1 focus-within:ring-chat-accent rounded-full flex items-center px-4 transition-all shadow-sm">
                    <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message Enterprise Sales Assistant..." className="w-full bg-transparent border-none focus:outline-none text-sm text-slate-200 placeholder-slate-500 h-12" disabled={isUploading} />
                </div>
                <button type="submit" disabled={isUploading || (!input.trim() && !selectedFile)} className={`w-12 h-12 flex items-center justify-center rounded-full transition-all shadow-sm border border-white/5 ${isUploading || (!input.trim() && !selectedFile) ? 'bg-white/5 text-slate-600' : 'bg-chat-accent hover:opacity-90 text-white active:scale-95 border-none'}`}>
                    <svg className="w-5 h-5 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}
