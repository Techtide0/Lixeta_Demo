import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Play, Plus, RefreshCw, X, Terminal, BarChart3, Code2,
  Wifi, WifiOff, Loader2, ChevronDown, AlertCircle, FileCode2,
  CheckCircle2, XCircle, Clock, Layers, Zap
} from 'lucide-react';

import { KpiBar, type KpiData } from '@/components/ui/analytics-dashboard';
import { InteractiveLogsTable, type Log } from '@/components/ui/interactive-logs-table';
import { CodeBlock, CodeBlockCopyButton } from '@/components/ui/code-block';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { FlowVisualizer, type RuleTraceDisplay } from '@/components/ui/flow-visualizer';
import { RiskPanel, type RiskEvent } from '@/components/ui/risk-panel';
import { DecisionTimeline, type TimelineEntry } from '@/components/ui/decision-timeline';
import * as api from '@/api/client';

// --- EVENT TYPE OPTIONS ---
const EVENT_TYPES = [
  'message.sent',
  'message.delivered',
  'message.read',
  'user.authenticated',
  'user.deauthenticated',
  'payment.initiated',
  'payment.succeeded',
  'payment.reversed',
  'risk.flag_raised',
];

// --- MAP BACKEND LOGS TO TABLE FORMAT ---
function mapBackendLogs(logsData: any): Log[] {
  if (!logsData?.data) return [];
  const events: any[] = logsData.data.events ?? [];
  const decisions: any[] = logsData.data.decisions ?? [];

  return events.map((event: any, idx: number) => {
    const decision = decisions.find((d: any) => d.eventId === event.id) ?? decisions[idx];
    const verdict: string = decision?.verdict ?? 'UNKNOWN';
    const level: Log['level'] =
      verdict === 'DENY' ? 'error' :
      verdict === 'FLAG' ? 'warning' :
      'info';

    return {
      id: event.id ?? String(idx),
      timestamp: event.timestamp ?? new Date().toISOString(),
      level,
      service: event.type ?? 'unknown',
      message: decision?.reason ?? `Event processed: ${event.type ?? 'unknown'}`,
      duration: decision?.executionMs != null ? `${decision.executionMs}ms` : '—',
      status: verdict,
      tags: [
        event.source?.channel ?? 'api',
        ...(event.type?.split('.') ?? []),
      ].filter(Boolean),
    };
  });
}

// --- MAP BACKEND DATA TO TIMELINE ENTRIES ---
function mapTimelineEntries(logsData: any): TimelineEntry[] {
  if (!logsData?.data) return [];
  const events: any[] = logsData.data.events ?? [];
  const decisions: any = logsData.data.decisions ?? {};
  const revenueEvents: any[] = logsData.data.revenueEvents ?? [];
  const riskEvents: any[] = logsData.data.riskEvents ?? [];
  const ruleTraces: any[] = logsData.data.ruleTraces ?? [];

  return events.map((event: any) => {
    const decision = decisions[event.id] ?? Object.values(decisions).find((d: any) => d.sourceEventId === event.id) as any;
    const revForEvent = revenueEvents.filter((r: any) => r.triggeringEventId === event.id);
    const riskForEvent = riskEvents.filter((r: any) => r.triggeringEventId === event.id);
    const tracesForEvent = ruleTraces.filter((t: any) => t.triggeringEventId === event.id);

    const savingsKobo = revForEvent
      .filter((r: any) => r.direction === 'gain')
      .reduce((s: number, r: any) => s + (r.amount?.amountMinorUnits ?? 0), 0);
    const costKobo = revForEvent
      .filter((r: any) => r.direction === 'loss')
      .reduce((s: number, r: any) => s + (r.amount?.amountMinorUnits ?? 0), 0);

    return {
      eventId: event.id,
      eventType: event.type,
      timestamp: event.timestamp,
      verdict: decision?.verdict ?? 'unknown',
      reason: decision?.reason ?? '',
      executionMs: decision?.totalExecutionTimeMs ?? decision?.executionMs ?? 0,
      savingsKobo,
      costKobo,
      riskCount: riskForEvent.length,
      rulesApplied: tracesForEvent.length,
    };
  });
}

// --- MAP RISK EVENTS ---
function mapRiskEvents(logsData: any): RiskEvent[] {
  if (!logsData?.data?.riskEvents) return [];
  return logsData.data.riskEvents.map((r: any): RiskEvent => ({
    id: r.id,
    category: r.category,
    severity: r.severity,
    score: r.score,
    description: r.description,
    triggeringEventType: r.triggeringEventType,
    detectedAt: r.detectedAt,
    evidence: r.evidence,
  }));
}

// --- MAP RULE TRACES FOR FLOW VISUALIZER ---
function mapRuleTraces(triggerResult: any): RuleTraceDisplay[] {
  const traces: any[] = triggerResult?.data?.ruleTraces ?? [];
  return traces.map((t: any): RuleTraceDisplay => ({
    ruleId: t.ruleId,
    ruleName: t.ruleName,
    outcome: t.outcome,
    explanation: t.explanation,
    executionTimeMs: t.executionTimeMs ?? 0,
    conditions: t.conditions,
    actions: t.actions,
  }));
}

type Tab = 'logs' | 'json' | 'analytics' | 'iso' | 'decisions';

export default function App() {
  // --- SESSION STATE ---
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionStatus, setSessionStatus] = useState<string | null>(null);
  const [sessionCreatedAt, setSessionCreatedAt] = useState<string | null>(null);

  // --- DATA STATE ---
  const [kpi, setKpi] = useState<KpiData | null>(null);
  const [liveLogs, setLiveLogs] = useState<Log[]>([]);
  const [rawAnalytics, setRawAnalytics] = useState<any>(null);
  const [rawLogs, setRawLogs] = useState<any>(null);
  const [lastTriggerResult, setLastTriggerResult] = useState<any>(null);
  const [isoResult, setIsoResult] = useState<any>(null);
  const [isoMode, setIsoMode] = useState<'success' | 'kill'>('success');
  const [isGeneratingIso, setIsGeneratingIso] = useState(false);

  // --- AGGRESSION STATE ---
  const [aggressionLevel, setAggressionLevel] = useState(50);
  const [isSettingAggression, setIsSettingAggression] = useState(false);
  const aggressionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- UI STATE ---
  const [selectedEventType, setSelectedEventType] = useState(EVENT_TYPES[0]);
  const [activeTab, setActiveTab] = useState<Tab>('logs');
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isTriggeringEvent, setIsTriggeringEvent] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClosingSession, setIsClosingSession] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  // --- REFRESH DATA ---
  const refreshData = useCallback(async (sid: string) => {
    setIsRefreshing(true);
    try {
      const [analyticsRes, logsRes] = await Promise.all([
        api.getAnalytics(sid),
        api.getLogs(sid),
      ]);

      setRawAnalytics(analyticsRes);
      setRawLogs(logsRes);

      if (analyticsRes?.data?.kpi) {
        setKpi(analyticsRes.data.kpi as KpiData);
      }

      setLiveLogs(mapBackendLogs(logsRes));
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // --- REAL-TIME POLLING: every 3s while session is active ---
  useEffect(() => {
    if (!sessionId || sessionStatus === 'completed') return;

    const interval = setInterval(() => {
      refreshData(sessionId).catch(() => { /* silently ignore polling errors */ });
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionId, sessionStatus, refreshData]);

  // --- CREATE SESSION ---
  const handleCreateSession = async () => {
    setError(null);
    setIsCreatingSession(true);
    try {
      const res = await api.createSession('Sandbox Session');
      setBackendOnline(true);
      const sid = res?.data?.sessionId;
      if (!sid) throw new Error('No sessionId in response');
      setSessionId(sid);
      setSessionStatus(res?.data?.status ?? 'active');
      setSessionCreatedAt(res?.data?.createdAt ?? null);
      setKpi(null);
      setLiveLogs([]);
      setRawAnalytics(null);
      setRawLogs(null);
      setLastTriggerResult(null);
      setAggressionLevel(50);
      await refreshData(sid);
    } catch (err: any) {
      setError(err.message ?? 'Failed to create session');
      setBackendOnline(false);
    } finally {
      setIsCreatingSession(false);
    }
  };

  // --- TRIGGER EVENT ---
  const handleTriggerEvent = async () => {
    if (!sessionId) return;
    setError(null);
    setIsTriggeringEvent(true);
    try {
      const triggerRes = await api.triggerEvent(sessionId, selectedEventType);
      setLastTriggerResult(triggerRes);
      await refreshData(sessionId);
    } catch (err: any) {
      setError(err.message ?? 'Failed to trigger event');
    } finally {
      setIsTriggeringEvent(false);
    }
  };

  // --- CLOSE SESSION ---
  const handleCloseSession = async () => {
    if (!sessionId) return;
    setError(null);
    setIsClosingSession(true);
    try {
      await api.closeSession(sessionId);
      setSessionStatus('completed');
    } catch (err: any) {
      setError(err.message ?? 'Failed to close session');
    } finally {
      setIsClosingSession(false);
    }
  };

  // --- GENERATE ISO ---
  const handleGenerateIso = async () => {
    setError(null);
    setIsGeneratingIso(true);
    try {
      const res = await api.getIso(isoMode);
      setIsoResult(res?.data ?? null);
    } catch (err: any) {
      setError(err.message ?? 'Failed to generate ISO message');
    } finally {
      setIsGeneratingIso(false);
    }
  };

  // --- MANUAL REFRESH ---
  const handleRefresh = async () => {
    if (!sessionId) return;
    setError(null);
    try {
      await refreshData(sessionId);
    } catch (err: any) {
      setError(err.message ?? 'Failed to refresh');
    }
  };

  // --- DISPUTE DOWNLOAD ---
  const handleDisputeDownload = async (eventId: string) => {
    if (!sessionId) return;
    try {
      const blob = await api.downloadDispute(sessionId, eventId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dispute_${eventId.slice(0, 32)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message ?? 'Failed to generate dispute package');
    }
  };

  // --- AGGRESSION SLIDER (debounced 400ms) ---
  const handleAggressionChange = (newLevel: number) => {
    setAggressionLevel(newLevel);
    if (!sessionId || sessionStatus === 'completed') return;

    if (aggressionTimer.current) clearTimeout(aggressionTimer.current);
    aggressionTimer.current = setTimeout(async () => {
      setIsSettingAggression(true);
      try {
        await api.setAggression(sessionId, newLevel);
      } catch {
        // non-blocking — slider still works visually
      } finally {
        setIsSettingAggression(false);
      }
    }, 400);
  };

  const jsonContent = JSON.stringify(
    {
      analytics: rawAnalytics?.data ?? null,
      logs: rawLogs?.data ?? null,
      lastEvent: lastTriggerResult?.data ?? null,
    },
    null, 2
  );

  const isSessionActive = !!sessionId && sessionStatus !== 'completed';
  const riskEvents = mapRiskEvents(rawLogs);
  const timelineEntries = mapTimelineEntries(rawLogs);
  const ruleTraces = mapRuleTraces(lastTriggerResult);

  return (
    <div className="min-h-screen bg-gray-900 bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(120,119,198,0.15),rgba(255,255,255,0))] text-white flex flex-col">

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 border-b border-white/10 bg-gray-900/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600">
              <Terminal className="h-4 w-4 text-white" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-white">Lixeta</span>
              <span className="ml-2 text-sm text-gray-400">Sandbox</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {backendOnline === true && (
              <div className="flex items-center gap-1.5 text-xs text-green-400">
                <Wifi className="h-3.5 w-3.5" />
                <span>Connected</span>
              </div>
            )}
            {backendOnline === false && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <WifiOff className="h-3.5 w-3.5" />
                <span>Backend offline</span>
              </div>
            )}
            {/* Real-time indicator */}
            {isSessionActive && (
              <div className="flex items-center gap-1.5 text-xs text-indigo-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
                </span>
                <span>Live</span>
              </div>
            )}
            {sessionId && (
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-gray-400 bg-gray-800 border border-white/10 rounded px-2 py-1">
                  {sessionId.slice(0, 20)}…
                </span>
                <Badge className={`text-xs ${sessionStatus === 'active' ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-gray-500/20 text-gray-400 border-gray-500/30'}`} variant="outline">
                  {sessionStatus ?? 'unknown'}
                </Badge>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── MAIN ───────────────────────────────────────────────────────── */}
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-6 py-6 flex flex-col gap-6">

        {/* ERROR BANNER */}
        {error && (
          <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-400">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* KPI BAR */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500">KPI Overview</h2>
            {sessionId && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            )}
          </div>
          <KpiBar kpi={kpi} />
        </section>

        {/* TWO-COLUMN LAYOUT */}
        <div className="flex flex-1 gap-6 min-h-0">

          {/* ── LEFT: ACTION PANEL ────────────────────────────────────── */}
          <aside className="w-72 flex-shrink-0 flex flex-col gap-4">

            {/* Session Card */}
            <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-4">Session</h3>

              {sessionId ? (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Session ID</p>
                    <p className="font-mono text-xs text-indigo-400 break-all">{sessionId}</p>
                  </div>
                  {sessionCreatedAt && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Created</p>
                      <p className="text-xs text-gray-300">{new Date(sessionCreatedAt).toLocaleTimeString()}</p>
                    </div>
                  )}
                  <div className="pt-1 flex gap-2">
                    <Button
                      onClick={handleCreateSession}
                      disabled={isCreatingSession}
                      size="sm"
                      variant="outline"
                      className="flex-1 border-white/10 bg-transparent text-gray-300 hover:bg-white/5 hover:text-white"
                    >
                      {isCreatingSession ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                      <span className="ml-1.5">New</span>
                    </Button>
                    {isSessionActive && (
                      <Button
                        onClick={handleCloseSession}
                        disabled={isClosingSession}
                        size="sm"
                        variant="outline"
                        className="border-red-500/30 bg-transparent text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      >
                        {isClosingSession ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-gray-500">No active session. Create one to start.</p>
                  <Button
                    onClick={handleCreateSession}
                    disabled={isCreatingSession}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white"
                    size="sm"
                  >
                    {isCreatingSession ? (
                      <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Creating…</>
                    ) : (
                      <><Plus className="h-3.5 w-3.5 mr-2" />Create Session</>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Trigger Event Card */}
            <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
              <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-4">Trigger Event</h3>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1.5 block">Event Type</label>
                  <div className="relative">
                    <select
                      value={selectedEventType}
                      onChange={(e) => setSelectedEventType(e.target.value)}
                      disabled={!isSessionActive}
                      className="w-full appearance-none rounded-md border border-white/10 bg-gray-900 px-3 py-2 text-sm text-white pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {EVENT_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  </div>
                </div>

                <Button
                  onClick={handleTriggerEvent}
                  disabled={!isSessionActive || isTriggeringEvent}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"
                  size="sm"
                >
                  {isTriggeringEvent ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Firing…</>
                  ) : (
                    <><Play className="h-3.5 w-3.5 mr-2" />Trigger Event</>
                  )}
                </Button>

                {!sessionId && (
                  <p className="text-xs text-gray-600 text-center">Create a session first</p>
                )}
              </div>
            </div>

            {/* Engine Aggression Card */}
            <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500">Engine Aggression</h3>
                {isSettingAggression && <Loader2 className="h-3 w-3 animate-spin text-indigo-400" />}
              </div>

              <div className="space-y-3">
                {/* Level display */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Level</span>
                  <span className={`font-mono text-sm font-bold ${
                    aggressionLevel >= 80 ? 'text-red-400' :
                    aggressionLevel >= 60 ? 'text-orange-400' :
                    aggressionLevel >= 40 ? 'text-yellow-400' :
                    'text-blue-400'
                  }`}>
                    {aggressionLevel}%
                  </span>
                </div>

                {/* Slider */}
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={aggressionLevel}
                  onChange={(e) => handleAggressionChange(Number(e.target.value))}
                  disabled={!isSessionActive}
                  className="w-full h-1.5 rounded-full appearance-none bg-gray-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed accent-indigo-500"
                />

                {/* Labels */}
                <div className="flex justify-between text-xs text-gray-600">
                  <span>Conservative</span>
                  <span>Balanced</span>
                  <span>Aggressive</span>
                </div>

                {/* Impact description */}
                <div className="rounded-lg border border-white/5 bg-gray-900/50 px-3 py-2">
                  <p className="text-xs text-gray-500 leading-relaxed">
                    {aggressionLevel >= 80
                      ? 'Max sensitivity — rules fire on minimal signals. Wider active windows, low velocity threshold.'
                      : aggressionLevel >= 60
                      ? 'High sensitivity — rules fire more readily. Broader event windows and thresholds.'
                      : aggressionLevel <= 20
                      ? 'Conservative — rules require strong signals. Narrower windows, higher velocity threshold.'
                      : 'Balanced mode — default engine behavior. Standard thresholds and active windows.'}
                  </p>
                </div>
              </div>
            </div>

            {/* Last Decision Card */}
            {lastTriggerResult?.data?.decision && (
              <div className="rounded-2xl border border-white/10 bg-gray-800/40 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-3">Last Decision</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">Verdict</span>
                    <Badge
                      variant="outline"
                      className={`text-xs font-mono ${
                        lastTriggerResult.data.decision.verdict === 'allow' ? 'border-green-500/40 text-green-400' :
                        lastTriggerResult.data.decision.verdict === 'block' ? 'border-red-500/40 text-red-400' :
                        lastTriggerResult.data.decision.verdict === 'flag'  ? 'border-yellow-500/40 text-yellow-400' :
                        lastTriggerResult.data.decision.verdict === 'defer' ? 'border-blue-500/40 text-blue-400' :
                        'border-yellow-500/40 text-yellow-400'
                      }`}
                    >
                      {lastTriggerResult.data.decision.verdict}
                    </Badge>
                  </div>
                  {lastTriggerResult.data.decision.reason && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Reason</p>
                      <p className="text-xs text-gray-300 leading-relaxed">{lastTriggerResult.data.decision.reason}</p>
                    </div>
                  )}
                  {lastTriggerResult.data.decision.executionMs != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Execution</span>
                      <span className="font-mono text-xs text-indigo-400">{lastTriggerResult.data.decision.executionMs}ms</span>
                    </div>
                  )}
                  {lastTriggerResult.data.meta?.appliedRuleCount != null && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">Rules Applied</span>
                      <span className="font-mono text-xs text-gray-300">{lastTriggerResult.data.meta.appliedRuleCount}</span>
                    </div>
                  )}
                  {/* Jump to decisions tab */}
                  <button
                    onClick={() => setActiveTab('decisions')}
                    className="w-full mt-1 text-xs text-indigo-400 hover:text-indigo-300 flex items-center justify-center gap-1 transition-colors"
                  >
                    <Layers className="h-3 w-3" />
                    View full trace
                  </button>
                </div>
              </div>
            )}
          </aside>

          {/* ── RIGHT: CONTENT PANEL ──────────────────────────────────── */}
          <div className="flex-1 min-w-0 flex flex-col rounded-2xl border border-white/10 bg-gray-800/40 overflow-hidden">

            {/* Tab Bar */}
            <div className="flex items-center border-b border-white/10 px-4 pt-4 gap-1 overflow-x-auto">
              {([
                { id: 'logs',      label: 'Event Logs',   icon: Terminal },
                { id: 'decisions', label: 'Decisions',    icon: Layers },
                { id: 'analytics', label: 'Analytics',    icon: BarChart3 },
                { id: 'json',      label: 'Raw JSON',     icon: Code2 },
                { id: 'iso',       label: 'ISO 20022',    icon: FileCode2 },
              ] as Array<{ id: Tab; label: string; icon: React.ElementType }>).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors -mb-px border-b-2 whitespace-nowrap ${
                    activeTab === id
                      ? 'border-indigo-500 text-white bg-white/5'
                      : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-white/5'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                  {/* Badge: risk count on Decisions tab */}
                  {id === 'decisions' && riskEvents.length > 0 && (
                    <span className="ml-0.5 rounded-full bg-red-500/30 px-1.5 py-0.5 text-xs text-red-400 font-mono leading-none">
                      {riskEvents.length}
                    </span>
                  )}
                </button>
              ))}

              {isRefreshing && (
                <div className="ml-auto pr-2 flex items-center gap-1.5 text-xs text-indigo-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Syncing…</span>
                </div>
              )}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-hidden">

              {/* LOGS TAB */}
              {activeTab === 'logs' && (
                <div className="h-full">
                  <InteractiveLogsTable logs={liveLogs.length > 0 ? liveLogs : undefined} />
                </div>
              )}

              {/* DECISIONS TAB */}
              {activeTab === 'decisions' && (
                <div className="h-full overflow-y-auto p-6 space-y-8">

                  {/* Flow Visualizer */}
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <Zap className="h-4 w-4 text-indigo-400" />
                      <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500">Last Decision Flow</h3>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-gray-900/40 p-4">
                      <FlowVisualizer
                        eventType={lastTriggerResult?.data ? (rawLogs?.data?.events?.slice(-1)[0]?.type ?? lastTriggerResult?.data?.decision?.sourceEventType) : undefined}
                        verdict={lastTriggerResult?.data?.decision?.verdict}
                        reason={lastTriggerResult?.data?.decision?.reason}
                        executionMs={lastTriggerResult?.data?.decision?.executionMs}
                        ruleTraces={ruleTraces}
                        revenueEvents={lastTriggerResult?.data?.revenueEvents ?? []}
                      />
                    </div>
                  </section>

                  {/* Risk Panel */}
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <AlertCircle className="h-4 w-4 text-red-400" />
                      <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500">Risk Intelligence</h3>
                      {riskEvents.length > 0 && (
                        <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400 font-mono">
                          {riskEvents.length} signal{riskEvents.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="rounded-xl border border-white/10 bg-gray-900/40 p-4">
                      <RiskPanel riskEvents={riskEvents} />
                    </div>
                  </section>

                  {/* Decision Timeline */}
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <Clock className="h-4 w-4 text-gray-400" />
                      <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500">Decision Timeline</h3>
                      {timelineEntries.length > 0 && (
                        <span className="text-xs text-gray-600">{timelineEntries.length} event{timelineEntries.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    <DecisionTimeline entries={timelineEntries} onDownloadDispute={handleDisputeDownload} />
                  </section>
                </div>
              )}

              {/* ANALYTICS TAB */}
              {activeTab === 'analytics' && (
                <div className="h-full overflow-y-auto p-6">
                  {rawAnalytics?.data ? (
                    <div className="space-y-6">
                      {rawAnalytics.data.revenue && (
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-3">Revenue</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {[
                              { label: 'Net Revenue', value: `₦${rawAnalytics.data.revenue.netAmount?.toFixed(2) ?? '0'}` },
                              { label: 'Total Gain', value: `₦${((rawAnalytics.data.revenue.totalGainMinorUnits ?? 0) / 100).toFixed(2)}` },
                              { label: 'Total Savings', value: `₦${((rawAnalytics.data.revenue.totalSavingsMinorUnits ?? 0) / 100).toFixed(2)}` },
                              { label: 'Revenue Events', value: String(rawAnalytics.data.revenue.totalRevenueEventCount ?? 0) },
                              { label: 'Currency', value: rawAnalytics.data.revenue.currency ?? 'NGN' },
                            ].map(({ label, value }) => (
                              <div key={label} className="rounded-xl border border-white/10 bg-gray-900/60 p-4">
                                <p className="text-xs text-gray-500 mb-1">{label}</p>
                                <p className="font-mono text-lg font-bold text-white">{value}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {rawAnalytics.data.risk && (
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-3">Risk</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {[
                              { label: 'Total Signals', value: String(rawAnalytics.data.risk.totalSignalCount ?? 0) },
                              { label: 'Open Signals', value: String(rawAnalytics.data.risk.openSignalCount ?? 0) },
                              { label: 'Critical Signals', value: String(rawAnalytics.data.risk.criticalSignalCount ?? 0) },
                              { label: 'Exposure Score', value: `${((rawAnalytics.data.risk.riskExposureScore ?? 0) * 100).toFixed(1)}%` },
                              { label: 'Avg Risk Score', value: `${((rawAnalytics.data.risk.averageRiskScore ?? 0) * 100).toFixed(1)}%` },
                            ].map(({ label, value }) => (
                              <div key={label} className="rounded-xl border border-white/10 bg-gray-900/60 p-4">
                                <p className="text-xs text-gray-500 mb-1">{label}</p>
                                <p className="font-mono text-lg font-bold text-white">{value}</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {rawAnalytics.data.rules && (
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-3">Rules</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {[
                              { label: 'Total Fired', value: String(rawAnalytics.data.rules.totalRulesFired ?? 0) },
                              { label: 'Total Traces', value: String(rawAnalytics.data.rules.totalTracesEvaluated ?? 0) },
                              { label: 'Unique Rules', value: String(rawAnalytics.data.rules.uniqueRulesInvoked ?? 0) },
                              { label: 'Avg Exec/Event', value: `${(rawAnalytics.data.rules.averageExecutionMsPerEvent ?? 0).toFixed(1)}ms` },
                            ].map(({ label, value }) => (
                              <div key={label} className="rounded-xl border border-white/10 bg-gray-900/60 p-4">
                                <p className="text-xs text-gray-500 mb-1">{label}</p>
                                <p className="font-mono text-lg font-bold text-white">{value}</p>
                              </div>
                            ))}
                          </div>

                          {rawAnalytics.data.rules.verdictDistribution && (
                            <div className="mt-3">
                              <p className="text-xs text-gray-500 mb-2">Verdict Distribution</p>
                              <div className="flex flex-wrap gap-2">
                                {Object.entries(rawAnalytics.data.rules.verdictDistribution).map(([verdict, count]) => (
                                  verdict !== 'total' && (
                                    <div key={verdict} className="flex items-center gap-2 rounded-full border border-white/10 bg-gray-900/60 px-3 py-1">
                                      <span className="text-xs text-gray-400 capitalize">{verdict}</span>
                                      <span className="font-mono text-xs font-bold text-white">{String(count)}</span>
                                    </div>
                                  )
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {rawAnalytics.data.events && (
                        <div>
                          <h3 className="text-sm font-semibold uppercase tracking-widest text-gray-500 mb-3">Events</h3>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                            {[
                              { label: 'Total Events', value: String(rawAnalytics.data.events.totalEventCount ?? 0) },
                              { label: 'Unique Types', value: String(rawAnalytics.data.events.uniqueEventTypes ?? 0) },
                              { label: 'Avg/Hour', value: `${(rawAnalytics.data.events.averageEventsPerHour ?? 0).toFixed(1)}` },
                            ].map(({ label, value }) => (
                              <div key={label} className="rounded-xl border border-white/10 bg-gray-900/60 p-4">
                                <p className="text-xs text-gray-500 mb-1">{label}</p>
                                <p className="font-mono text-lg font-bold text-white">{value}</p>
                              </div>
                            ))}
                          </div>

                          {rawAnalytics.data.events.byType?.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                              {rawAnalytics.data.events.byType.map((et: any) => (
                                <div key={et.eventType} className="flex items-center justify-between rounded-md border border-white/5 bg-gray-900/40 px-3 py-2">
                                  <span className="font-mono text-xs text-gray-300">{et.eventType}</span>
                                  <div className="flex items-center gap-3">
                                    <span className="text-xs text-gray-500">{et.percentage?.toFixed(1)}%</span>
                                    <span className="font-mono text-sm font-bold text-white">{et.count}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center">
                      <div className="text-center">
                        <BarChart3 className="h-12 w-12 text-gray-700 mx-auto mb-3" />
                        <p className="text-gray-500 text-sm">No analytics data yet</p>
                        <p className="text-gray-600 text-xs mt-1">Create a session and trigger events to see analytics</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* JSON TAB */}
              {activeTab === 'json' && (
                <div className="h-full overflow-y-auto p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-gray-500">Raw backend response — analytics + logs + last event</p>
                  </div>
                  <CodeBlock code={jsonContent} language="json" showLineNumbers>
                    <CodeBlockCopyButton />
                  </CodeBlock>
                </div>
              )}

              {/* ISO TAB */}
              {activeTab === 'iso' && (
                <div className="h-full overflow-y-auto p-6 flex flex-col gap-6">
                  <div className="flex items-center gap-4">
                    <div className="flex rounded-lg border border-white/10 overflow-hidden">
                      {(['success', 'kill'] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() => { setIsoMode(m); setIsoResult(null); }}
                          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                            isoMode === m
                              ? m === 'success'
                                ? 'bg-green-600/20 text-green-400 border-r border-white/10'
                                : 'bg-red-600/20 text-red-400'
                              : 'text-gray-400 hover:text-white hover:bg-white/5 border-r border-white/10 last:border-0'
                          }`}
                        >
                          {m === 'success'
                            ? <CheckCircle2 className="h-3.5 w-3.5" />
                            : <XCircle className="h-3.5 w-3.5" />}
                          {m === 'success' ? 'Success (pacs.008)' : 'Kill Switch (pacs.004)'}
                        </button>
                      ))}
                    </div>
                    <Button
                      onClick={handleGenerateIso}
                      disabled={isGeneratingIso}
                      size="sm"
                      className={`${isoMode === 'success' ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'} text-white`}
                    >
                      {isGeneratingIso
                        ? <><Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />Generating…</>
                        : <><FileCode2 className="h-3.5 w-3.5 mr-2" />Generate ISO</>}
                    </Button>
                  </div>

                  <div className={`rounded-xl border p-4 text-sm ${
                    isoMode === 'success'
                      ? 'border-green-500/20 bg-green-500/5 text-green-300'
                      : 'border-red-500/20 bg-red-500/5 text-red-300'
                  }`}>
                    {isoMode === 'success' ? (
                      <span><strong>pacs.008.001.08</strong> — FI-to-FI Customer Credit Transfer. Represents a valid, approved payment flow through the CBN clearing system.</span>
                    ) : (
                      <span><strong>pacs.004.001.09</strong> — Payment Return. Simulates a rejected transfer (insufficient funds, AM04) — the full reversal message sent back to the originating bank.</span>
                    )}
                  </div>

                  {isoResult && (
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-wrap gap-3">
                        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-gray-900/60 px-3 py-1.5">
                          <FileCode2 className="h-3 w-3 text-indigo-400" />
                          <span className="font-mono text-xs text-indigo-400">{isoResult.isoType}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-gray-900/60 px-3 py-1.5">
                          <span className="text-xs text-gray-500">MsgId</span>
                          <span className="font-mono text-xs text-white">{isoResult.msgId}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-gray-900/60 px-3 py-1.5">
                          <span className="text-xs text-gray-500">E2E</span>
                          <span className="font-mono text-xs text-white">{isoResult.endToEndId}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-gray-900/60 px-3 py-1.5">
                          <span className="font-mono text-xs text-white">{isoResult.currency} {isoResult.formattedAmount}</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-gray-900/60 px-3 py-1.5">
                          <Clock className="h-3 w-3 text-gray-400" />
                          <span className="font-mono text-xs text-gray-300">{isoResult.latencyMs}ms</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-gray-900/60 px-3 py-1.5">
                          <span className="text-xs text-gray-500">hash</span>
                          <span className="font-mono text-xs text-gray-400">{isoResult.inputHash}</span>
                        </div>
                        {isoResult.returnCode && (
                          <div className="flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1.5">
                            <XCircle className="h-3 w-3 text-red-400" />
                            <span className="font-mono text-xs text-red-400">{isoResult.returnCode}</span>
                            <span className="text-xs text-red-300">{isoResult.returnReason?.slice(0, 40)}</span>
                          </div>
                        )}
                      </div>

                      <CodeBlock code={isoResult.xml} language="xml" showLineNumbers>
                        <CodeBlockCopyButton />
                      </CodeBlock>
                    </div>
                  )}

                  {!isoResult && !isGeneratingIso && (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <FileCode2 className="h-12 w-12 text-gray-700 mb-3" />
                      <p className="text-gray-500 text-sm">Select a mode and click Generate ISO</p>
                      <p className="text-gray-600 text-xs mt-1">Produces deterministic ISO 20022 XML — same input always yields same output</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ── FOOTER ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 px-6 py-4">
        <div className="mx-auto max-w-screen-2xl flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded bg-indigo-600">
              <Terminal className="h-3 w-3 text-white" />
            </div>
            <span className="text-xs font-semibold text-gray-400">Lixeta</span>
            <span className="text-xs text-gray-700">·</span>
            <span className="text-xs text-gray-600">Intelligent Rules Engine &amp; Revenue Analytics Platform</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-gray-700">
            <a href="#" className="hover:text-gray-400 transition-colors">Documentation</a>
            <a href="#" className="hover:text-gray-400 transition-colors">API Reference</a>
            <a href="#" className="hover:text-gray-400 transition-colors">Status</a>
            <a href="#" className="hover:text-gray-400 transition-colors">Privacy Policy</a>
            <span className="text-gray-700">© {new Date().getFullYear()} Lixeta Technologies Ltd. All rights reserved.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
