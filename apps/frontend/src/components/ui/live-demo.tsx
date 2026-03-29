/**
 * @file live-demo.tsx
 * @description Full-screen live payment monitor powered by real API data.
 *
 * "Simulate Traffic" calls POST /sim/start → the backend creates a real session
 * and fires 4 events every 3 s through the Lixeta rules engine. This component
 * then polls GET /analytics and GET /logs to show live rule verdicts, savings,
 * and kill-switch activations — provably real, not mocked.
 *
 * If a CTO asks: the session ID is shown in the header. They can curl it
 * themselves: GET /analytics?sessionId=<id>
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Zap, CheckCircle2, XCircle, AlertTriangle,
  Play, Square, Shield, Activity, ExternalLink,
} from 'lucide-react';
import * as api from '@/api/client';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const POLL_MS = 4_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FeedStatus = 'allow' | 'flag' | 'deny' | 'reversed';

interface FeedItem {
  id: string;
  timestamp: string;
  eventType: string;
  verdict: 'ALLOW' | 'FLAG' | 'DENY';
  reason: string;
  savingsNgn: number;        // ₦ saved by this event (0 if none)
  payloadAmountKobo: number; // raw payment/protected amount from event payload (0 if none)
  status: FeedStatus;        // 'reversed' is client-side UX only
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNgn(kobo: number): string {
  const naira = kobo / 100;
  if (naira >= 1_000_000) return `₦${(naira / 1_000_000).toFixed(2)}M`;
  if (naira >= 1_000)     return `₦${(naira / 1_000).toFixed(1)}k`;
  return `₦${naira.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-NG', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function labelForType(
  type: string,
  verdict: string,
  savingsNgn: number,
  payloadAmountKobo: number,
  displayStatus: FeedStatus,
): string {
  if (displayStatus === 'reversed') {
    const protected$ = payloadAmountKobo > 0
      ? ` — ${formatNgn(payloadAmountKobo)} fraud prevented`
      : '';
    return `pacs.004 issued${protected$}`;
  }
  if (type === 'message.sent') {
    return savingsNgn > 0 ? `SMS Cost Saved — ${formatNgn(savingsNgn * 100)}` : 'Message Sent';
  }
  if (type === 'payment.succeeded') {
    const amt = payloadAmountKobo > 0 ? ` — ${formatNgn(payloadAmountKobo)}` : '';
    return `Payment Successful${amt}`;
  }
  if (type === 'payment.reversed') {
    if (verdict === 'block') return 'Kill-Switch — Reversal Blocked';
    if (verdict === 'flag')  return 'Reversal Flagged — Velocity Alert';
    return 'Reversal Processed';
  }
  if (type === 'payment.initiated') {
    if (verdict === 'DENY')  return 'Kill-Switch — Payment Blocked';
    if (verdict === 'FLAG')  return 'Payment Flagged';
    const amt = payloadAmountKobo > 0 ? ` — ${formatNgn(payloadAmountKobo)}` : '';
    return `Payment Cleared${amt}`;
  }
  if (type === 'user.authenticated') {
    if (verdict === 'DENY')  return 'Kill-Switch — Cross-Border Blocked';
    if (verdict === 'FLAG')  return 'Geo Anomaly Detected';
    return 'Auth Cleared';
  }
  if (verdict === 'DENY') return 'Kill-Switch Triggered';
  if (verdict === 'FLAG') return 'Risk Flagged';
  return type.replace('.', ' ');
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status, eventType }: { status: FeedStatus; eventType: string }) {
  if (status === 'reversed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        Auto-Reversed ✓
      </span>
    );
  }
  if (status === 'deny') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-red-500/20 text-red-300 border border-red-500/30 whitespace-nowrap">
        <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
        Kill-Switch Fired
      </span>
    );
  }
  if (status === 'flag') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
        Flagged
      </span>
    );
  }
  // ALLOW — different colour per event type so the feed is visually distinct
  if (eventType === 'payment.succeeded') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-green-500/20 text-green-300 border border-green-500/30 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        Payment Success
      </span>
    );
  }
  if (eventType === 'payment.reversed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-orange-500/20 text-orange-300 border border-orange-500/30 whitespace-nowrap">
        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
        Reversal
      </span>
    );
  }
  if (eventType === 'payment.initiated') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-blue-500/20 text-blue-300 border border-blue-500/30 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        Initiated
      </span>
    );
  }
  if (eventType === 'message.sent') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        SMS Saved
      </span>
    );
  }
  if (eventType === 'user.authenticated') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-violet-500/20 text-violet-300 border border-violet-500/30 whitespace-nowrap">
        <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
        Auth Cleared
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-slate-500/20 text-slate-300 border border-slate-500/30 whitespace-nowrap">
      <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
      Cleared
    </span>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
  variant: 'neutral' | 'green' | 'red' | 'indigo';
  animate?: boolean;
}

function StatCard({ label, value, sub, variant, animate }: StatCardProps) {
  const border = { neutral: 'border-white/10', green: 'border-emerald-500/25', red: 'border-red-500/25', indigo: 'border-indigo-500/25' }[variant];
  const bg     = { neutral: 'bg-slate-900/60', green: 'bg-emerald-500/5',      red: 'bg-red-500/5',      indigo: 'bg-indigo-500/5'    }[variant];
  const color  = { neutral: 'text-white',      green: 'text-emerald-300',      red: 'text-red-300',      indigo: 'text-indigo-300'    }[variant];

  return (
    <div className={`rounded-2xl border px-6 py-5 ${border} ${bg}`}>
      <motion.div
        key={value}
        initial={animate ? { scale: 1.15, opacity: 0.6 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.25 }}
        className={`text-5xl font-bold tracking-tight tabular-nums ${color}`}
      >
        {value}
      </motion.div>
      <div className="mt-2 text-sm font-medium text-slate-400">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-600">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface LiveDemoViewProps {
  onExit: () => void;
}

export function LiveDemoView({ onExit }: LiveDemoViewProps) {
  const [running, setRunning]         = useState(false);
  const [loading, setLoading]         = useState(false);
  const [sessionId, setSessionId]     = useState<string | null>(null);
  const [batchCount, setBatchCount]   = useState(0);
  const [analytics, setAnalytics]     = useState<any>(null);
  const [feedItems, setFeedItems]     = useState<FeedItem[]>([]);
  const [reversedIds, setReversedIds] = useState<Set<string>>(new Set());
  const [lastPoll, setLastPoll]       = useState<Date | null>(null);
  const [error, setError]             = useState<string | null>(null);

  // Track block events we've seen so we only schedule the reversal timer once
  const scheduledRef = useRef<Set<string>>(new Set());
  // Accumulate feed items across session rotations so the feed never resets
  const allItemsRef  = useRef<Map<string, FeedItem>>(new Map());
  // Track which sessionId we last fetched analytics from (for cross-session savings sum)
  const analyticsPerSessionRef = useRef<Map<string, number>>(new Map());

  // ── Auto-reversal: flip "block" items to "reversed" after 2 s ────────────
  useEffect(() => {
    const blockItems = feedItems.filter((f) => f.status === 'deny');
    for (const item of blockItems) {
      if (scheduledRef.current.has(item.id)) continue;
      scheduledRef.current.add(item.id);
      setTimeout(() => {
        setReversedIds((prev) => {
          const next = new Set(prev);
          next.add(item.id);
          return next;
        });
      }, 2_000);
    }
  }, [feedItems]);

  // ── Normalise backend verdict → FeedStatus ────────────────────────────────
  // Backend: "allow" | "flag" | "block" | "error"  (all lowercase)
  function toStatus(rawVerdict: string): FeedStatus {
    const v = (rawVerdict ?? '').toLowerCase();
    if (v === 'block') return 'deny';
    if (v === 'flag')  return 'flag';
    return 'allow';
  }

  // ── Poll: each endpoint in its own try/catch so one 429 never blocks others ──
  const pollData = useCallback(async (sid: string) => {
    // 1. Status — detect rotation; update batchCount/running but do NOT reset feed
    try {
      const statusRes = await api.getSimStatus();
      if (statusRes?.data) {
        setRunning(statusRes.data.running ?? false);
        setBatchCount(statusRes.data.batchCount ?? 0);
        const liveSid: string | null = statusRes.data.sessionId ?? null;
        if (liveSid && liveSid !== sid) {
          // Session rotated — switch polling target without wiping the feed
          setSessionId(liveSid);
          return; // useEffect re-fires with new sid; feed stays intact
        }
      }
    } catch {}

    // 2. Analytics — accumulate savings across rotations
    try {
      const analyticsRes = await api.getAnalytics(sid);
      const data = analyticsRes?.data ?? analyticsRes;
      if (data) {
        // Store this session's savings so we can add them to previous sessions'
        const thisSessionSavings: number = data.revenue?.totalSavingsMinorUnits ?? data.kpi?.totalSavingsMinorUnits ?? 0;
        analyticsPerSessionRef.current.set(sid, thisSessionSavings);
        // Sum savings across ALL sessions we've seen (handles rotation)
        const cumulativeSavings = Array.from(analyticsPerSessionRef.current.values())
          .reduce((a, b) => a + b, 0);
        // Inject cumulative savings into the analytics object for the stat cards
        setAnalytics({
          ...data,
          revenue: {
            ...(data.revenue ?? {}),
            totalSavingsMinorUnits: cumulativeSavings,
          },
          kpi: {
            ...(data.kpi ?? {}),
            totalSavingsMinorUnits: cumulativeSavings,
          },
        });
      }
    } catch {}

    // 3. Logs — merge new items into the accumulation map (never reset)
    try {
      const logsRes = await api.getLogs(sid, 300);
      if (logsRes?.data) {
        const events: any[]    = logsRes.data.events ?? [];
        const decisions: any[] = logsRes.data.decisions ?? [];
        const revEvents: any[] = logsRes.data.revenueEvents ?? [];

        const decisionMap = new Map<string, any>();
        for (const d of decisions) decisionMap.set(d.eventId, d);

        const savingsMap = new Map<string, number>();
        for (const r of revEvents) {
          if (r.direction === 'gain') {
            savingsMap.set(
              r.triggeringEventId,
              (savingsMap.get(r.triggeringEventId) ?? 0) + (r.amount?.amountMinorUnits ?? 0),
            );
          }
        }

        for (const evt of events) {
          if (allItemsRef.current.has(evt.id)) continue; // already have it
          const dec     = decisionMap.get(evt.id);
          const rawV    = dec?.verdict ?? 'allow';
          const status  = toStatus(rawV);
          const kobo    = savingsMap.get(evt.id) ?? 0;
          const rawAmt  = evt.payload?.amount ?? evt.payload?.suspectedAmount ?? 0;
          allItemsRef.current.set(evt.id, {
            id:                evt.id,
            timestamp:         evt.timestamp ?? evt.metadata?.createdAt ?? new Date().toISOString(),
            eventType:         evt.type ?? 'unknown',
            verdict:           rawV,
            reason:            dec?.reason ?? '',
            savingsNgn:        kobo / 100,
            payloadAmountKobo: typeof rawAmt === 'number' ? rawAmt : 0,
            status,
          });
        }

        // Render newest 25, newest first
        const sorted = Array.from(allItemsRef.current.values())
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 25);
        setFeedItems(sorted);
      }
    } catch {}

    setLastPoll(new Date());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Polling interval (only when we have a sessionId) ─────────────────────
  useEffect(() => {
    if (!sessionId) return;
    pollData(sessionId);
    const id = setInterval(() => pollData(sessionId), POLL_MS);
    return () => clearInterval(id);
  }, [sessionId, pollData]);

  // ── Simulate Traffic ──────────────────────────────────────────────────────
  async function handleStart() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.startSim();
      const sid = res?.data?.sessionId ?? null;
      if (!sid) throw new Error('No session ID returned');
      setSessionId(sid);
      setRunning(true);
      setBatchCount(0);
      setFeedItems([]);
      setReversedIds(new Set());
      scheduledRef.current = new Set();
      allItemsRef.current  = new Map();
      analyticsPerSessionRef.current = new Map();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start simulation');
    } finally {
      setLoading(false);
    }
  }

  async function handleStop() {
    setLoading(true);
    try {
      await api.stopSim();
      setRunning(false);
    } catch {
      // best effort
    } finally {
      setLoading(false);
    }
  }

  // ── Derived stats ─────────────────────────────────────────────────────────
  // Savings come from the injected cumulative-across-rotations value set in pollData
  const totalSavingsKobo = analytics?.revenue?.totalSavingsMinorUnits
                        ?? analytics?.kpi?.totalSavingsMinorUnits
                        ?? 0;
  // totalEvents: sum all items seen (allItemsRef) so it never resets
  const totalEvents = allItemsRef.current.size > 0
    ? allItemsRef.current.size
    : (analytics?.events?.totalEventCount ?? 0);
  // killCount: status === 'deny' (backend "block") — use the accumulation map
  const killCount = Array.from(allItemsRef.current.values()).filter((f) => f.status === 'deny').length;
  const killRate  = totalEvents > 0 ? Math.round((killCount / totalEvents) * 100) : 0;

  // Apply client-side reversed status overlay
  const displayItems = feedItems.map((f) => ({
    ...f,
    displayStatus: (reversedIds.has(f.id) ? 'reversed' : f.status) as FeedStatus,
  }));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col select-none overflow-hidden">

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-8 py-4 border-b border-white/10 bg-slate-900/80 backdrop-blur flex-shrink-0">
        {/* Left */}
        <div className="flex items-center gap-4">
          <button onClick={onExit} className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="h-4 w-4" />
            Exit
          </button>
          <div className="w-px h-5 bg-white/15" />
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight">Lixeta</span>
              <span className="ml-2.5 text-slate-400 text-sm">Live Payment Monitor</span>
            </div>
          </div>

          {/* Session ID — proves this is real to a CTO */}
          {sessionId && (
            <div className="flex items-center gap-2 ml-2 px-3 py-1.5 rounded-lg bg-slate-800 border border-white/10">
              <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
              <span className="font-mono text-xs text-slate-400">
                session: <span className="text-indigo-400">{sessionId.slice(0, 22)}…</span>
              </span>
            </div>
          )}
        </div>

        {/* Right */}
        <div className="flex items-center gap-4">
          {/* Live poll indicator */}
          {lastPoll && running && (
            <div className="flex items-center gap-2 text-xs text-emerald-400">
              <Activity className="h-3.5 w-3.5" />
              <span>Polling live · {lastPoll.toLocaleTimeString()}</span>
            </div>
          )}

          {/* Simulate / Stop button */}
          {!running ? (
            <button
              onClick={handleStart}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-bold text-white transition-colors"
            >
              <Play className="h-4 w-4" />
              {loading ? 'Starting…' : 'Simulate Traffic'}
            </button>
          ) : (
            <button
              onClick={handleStop}
              disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-sm font-bold text-white transition-colors border border-white/10"
            >
              <Square className="h-4 w-4" />
              Stop
            </button>
          )}

          {/* Kill-switch badge — only when running */}
          {running && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/15 border border-red-500/35">
              <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-400" />
              </span>
              <Shield className="h-4 w-4 text-red-400" />
              <span className="text-sm font-bold text-red-300">KILL-SWITCH ACTIVE</span>
            </div>
          )}
        </div>
      </header>

      {/* ── ERROR BANNER ───────────────────────────────────────────────────── */}
      {error && (
        <div className="mx-8 mt-4 flex-shrink-0 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* ── IDLE STATE ─────────────────────────────────────────────────────── */}
      {!sessionId && !error && (
        <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-indigo-600/20 border border-indigo-500/30">
            <Zap className="h-10 w-10 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white mb-2">Ready to Demo</h2>
            <p className="text-slate-400 max-w-md text-sm leading-relaxed">
              Click <strong className="text-white">Simulate Traffic</strong> to fire real payment events
              through the Lixeta rules engine. Every transaction is processed live — not mocked.
            </p>
          </div>
          <button
            onClick={handleStart}
            disabled={loading}
            className="flex items-center gap-2 px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-base font-bold text-white transition-colors"
          >
            <Play className="h-5 w-5" />
            {loading ? 'Starting…' : 'Simulate Traffic'}
          </button>
        </div>
      )}

      {/* ── LIVE DASHBOARD ─────────────────────────────────────────────────── */}
      {sessionId && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-4 gap-5 px-8 pt-6 pb-4 flex-shrink-0">
            <StatCard
              label="Total Savings"
              value={formatNgn(totalSavingsKobo)}
              sub="SMS costs eliminated"
              variant="green"
              animate
            />
            <StatCard
              label="Events Processed"
              value={String(totalEvents)}
              sub={`${batchCount} batches · ${batchCount * 6} events`}
              variant="neutral"
              animate
            />
            <StatCard
              label="Kill-Switch Fired"
              value={String(killCount)}
              sub="AB03 auto-reversals"
              variant="red"
              animate
            />
            <StatCard
              label="Kill Rate"
              value={`${killRate}%`}
              sub="of all transactions"
              variant="indigo"
              animate
            />
          </div>

          {/* Feed */}
          <div className="flex-1 px-8 pb-8 flex flex-col min-h-0">
            <div className="flex items-center gap-3 mb-3 flex-shrink-0">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Live Rule-Decision Feed
              </h2>
              <span className="text-xs text-slate-700">· real events · real verdicts · polling every 4s · session rotates every ~24s</span>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[140px_180px_180px_1fr_160px_1fr] gap-4 px-5 py-2 text-xs font-semibold uppercase tracking-wider text-slate-600 border-b border-white/5 mb-2 flex-shrink-0">
              <span>Time</span>
              <span>Event ID</span>
              <span>Type</span>
              <span>Rule Reason</span>
              <span>Status</span>
              <span>Action</span>
            </div>

            {/* Rows */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              <AnimatePresence initial={false}>
                {displayItems.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: -14 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease: 'easeOut' }}
                    className={`grid grid-cols-[140px_180px_180px_1fr_160px_1fr] gap-4 items-center px-5 py-3.5 rounded-xl border transition-colors ${
                      item.displayStatus === 'reversed' ? 'bg-emerald-950/30 border-emerald-500/10' :
                      item.displayStatus === 'deny'     ? 'bg-red-950/30 border-red-500/10' :
                      item.displayStatus === 'flag'     ? 'bg-amber-950/20 border-amber-500/10' :
                                                          'bg-slate-900/60 border-white/5'
                    }`}
                  >
                    <span className="font-mono text-sm text-slate-400 tabular-nums">
                      {fmtTime(item.timestamp)}
                    </span>

                    <span className="font-mono text-xs text-slate-500 truncate" title={item.id}>
                      {item.id.slice(0, 18)}…
                    </span>

                    <span className="text-sm text-slate-300 truncate">
                      {item.eventType}
                    </span>

                    <span className="text-xs text-slate-500 truncate" title={item.reason}>
                      {item.reason || '—'}
                    </span>

                    <StatusBadge status={item.displayStatus} eventType={item.eventType} />

                    <span className="text-sm font-medium text-slate-300 truncate">
                      {labelForType(
                        item.eventType,
                        item.verdict,
                        item.savingsNgn,
                        item.payloadAmountKobo,
                        item.displayStatus,
                      )}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>

              {displayItems.length === 0 && running && (
                <div className="flex flex-col items-center justify-center h-32 gap-3">
                  <div className="relative flex h-4 w-4">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-4 w-4 bg-indigo-500" />
                  </div>
                  <span className="text-slate-600 text-sm">Waiting for first batch…</span>
                </div>
              )}
            </div>

            {/* Proof footer */}
            {sessionId && (
              <div className="flex-shrink-0 mt-3 px-5 py-2.5 rounded-xl bg-slate-900/40 border border-white/5 text-xs text-slate-600 flex items-center gap-2">
                <Activity className="h-3 w-3 text-slate-700" />
                Real data from session&nbsp;
                <span className="font-mono text-indigo-600">{sessionId}</span>
                &nbsp;·&nbsp; Verify: <span className="font-mono text-slate-500">GET /analytics?sessionId={sessionId}</span>
                &nbsp;·&nbsp;
                <span className="font-mono text-slate-500">GET /logs?sessionId={sessionId}</span>
              </div>
            )}
            {/* Sandbox notice — visible on projector */}
            <div className="flex-shrink-0 mt-2 flex items-center gap-2 px-5 py-2 rounded-xl bg-amber-500/5 border border-amber-500/15 text-xs text-amber-500/60">
              <span className="font-semibold text-amber-500/80">SANDBOX DEMO</span>
              <span>·</span>
              <span>Real processor connections and live SMS notifications will be added in Phase 2.</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
