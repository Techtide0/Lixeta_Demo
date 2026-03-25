/**
 * FlowVisualizer — shows the decision path for the most recent engine evaluation.
 * Driven 100% by backend ruleTraces data. No hardcoded values.
 */

import React from 'react';
import { CheckCircle2, XCircle, Clock, ChevronRight, Zap, DollarSign, AlertTriangle } from 'lucide-react';

export interface RuleTraceDisplay {
  ruleId: string;
  ruleName: string;
  outcome: 'fired' | 'skipped' | 'error' | 'no_match';
  explanation: string;
  executionTimeMs: number;
  conditions?: Array<{ description: string; passed: boolean; actualValue: unknown }>;
  actions?: Array<{ actionType: string; description: string; executed: boolean; result?: Record<string, unknown> }>;
}

interface FlowVisualizerProps {
  eventType?: string;
  verdict?: string;
  reason?: string;
  executionMs?: number;
  ruleTraces?: RuleTraceDisplay[];
  revenueEvents?: Array<{
    category: string;
    direction: 'gain' | 'loss';
    amount: { amountMinorUnits: number; currency: string };
    description: string;
  }>;
}

function verdictColor(verdict?: string) {
  switch (verdict) {
    case 'allow': return 'text-green-400 border-green-500/40 bg-green-500/10';
    case 'block': return 'text-red-400 border-red-500/40 bg-red-500/10';
    case 'flag':  return 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10';
    case 'defer': return 'text-blue-400 border-blue-500/40 bg-blue-500/10';
    default:      return 'text-gray-400 border-gray-500/40 bg-gray-500/10';
  }
}

function outcomeIcon(outcome: string) {
  switch (outcome) {
    case 'fired':    return <Zap className="h-3.5 w-3.5 text-indigo-400" />;
    case 'skipped':  return <Clock className="h-3.5 w-3.5 text-gray-500" />;
    case 'error':    return <XCircle className="h-3.5 w-3.5 text-red-400" />;
    case 'no_match': return <CheckCircle2 className="h-3.5 w-3.5 text-gray-500" />;
    default:         return <Clock className="h-3.5 w-3.5 text-gray-500" />;
  }
}

function outcomeLabel(outcome: string) {
  switch (outcome) {
    case 'fired':    return <span className="text-indigo-400">Fired</span>;
    case 'skipped':  return <span className="text-gray-500">Skipped</span>;
    case 'error':    return <span className="text-red-400">Error</span>;
    case 'no_match': return <span className="text-gray-500">No Match</span>;
    default:         return <span className="text-gray-500">{outcome}</span>;
  }
}

export function FlowVisualizer({
  eventType,
  verdict,
  reason,
  executionMs,
  ruleTraces = [],
  revenueEvents = [],
}: FlowVisualizerProps) {
  if (!eventType && ruleTraces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Zap className="h-10 w-10 text-gray-700 mb-3" />
        <p className="text-sm text-gray-500">No event processed yet</p>
        <p className="text-xs text-gray-600 mt-1">Trigger an event to see the decision flow</p>
      </div>
    );
  }

  const totalSavingsKobo = revenueEvents
    .filter(e => e.direction === 'gain')
    .reduce((sum, e) => sum + e.amount.amountMinorUnits, 0);

  const totalCostKobo = revenueEvents
    .filter(e => e.direction === 'loss')
    .reduce((sum, e) => sum + e.amount.amountMinorUnits, 0);

  return (
    <div className="space-y-4">
      {/* Flow header */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Event */}
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/60 px-3 py-2">
          <span className="text-xs text-gray-500">Event</span>
          <span className="font-mono text-xs text-white font-medium">{eventType ?? '—'}</span>
        </div>

        <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />

        {/* Rules count */}
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-gray-900/60 px-3 py-2">
          <span className="text-xs text-gray-500">{ruleTraces.length} rule{ruleTraces.length !== 1 ? 's' : ''}</span>
          <span className="text-xs text-indigo-400">{ruleTraces.filter(t => t.outcome === 'fired').length} fired</span>
        </div>

        <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />

        {/* Verdict */}
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${verdictColor(verdict)}`}>
          <span className="text-xs font-semibold uppercase tracking-wider">{verdict ?? 'pending'}</span>
        </div>

        {/* Execution time */}
        {executionMs != null && (
          <div className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
            <Clock className="h-3 w-3" />
            <span>{executionMs}ms total</span>
          </div>
        )}
      </div>

      {/* Reason */}
      {reason && (
        <p className="text-xs text-gray-400 leading-relaxed border-l-2 border-indigo-500/40 pl-3">{reason}</p>
      )}

      {/* Revenue impact */}
      {revenueEvents.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {totalSavingsKobo > 0 && (
            <div className="flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5">
              <DollarSign className="h-3 w-3 text-green-400" />
              <span className="text-xs text-green-400 font-medium">
                ₦{(totalSavingsKobo / 100).toFixed(2)} saved
              </span>
            </div>
          )}
          {totalCostKobo > 0 && (
            <div className="flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1.5">
              <AlertTriangle className="h-3 w-3 text-orange-400" />
              <span className="text-xs text-orange-400 font-medium">
                ₦{(totalCostKobo / 100).toFixed(2)} cost
              </span>
            </div>
          )}
        </div>
      )}

      {/* Rule traces */}
      {ruleTraces.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-600">Rule Execution Trace</p>
          {ruleTraces.map((trace, i) => (
            <div
              key={`${trace.ruleId}-${i}`}
              className={`rounded-lg border p-3 ${
                trace.outcome === 'fired'
                  ? 'border-indigo-500/30 bg-indigo-500/5'
                  : trace.outcome === 'error'
                  ? 'border-red-500/30 bg-red-500/5'
                  : 'border-white/5 bg-gray-900/30'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {outcomeIcon(trace.outcome)}
                  <span className="text-sm font-medium text-white truncate">{trace.ruleName}</span>
                  <span className="text-xs text-gray-600 font-mono">{trace.ruleId}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {outcomeLabel(trace.outcome)}
                  <span className="font-mono text-xs text-gray-600">{trace.executionTimeMs}ms</span>
                </div>
              </div>
              {trace.explanation && (
                <p className="mt-1.5 text-xs text-gray-400 leading-relaxed pl-5">{trace.explanation}</p>
              )}
              {/* Actions summary */}
              {trace.actions && trace.actions.filter(a => a.executed).length > 0 && (
                <div className="mt-2 pl-5 space-y-1">
                  {trace.actions.filter(a => a.executed).map((action, ai) => (
                    <div key={ai} className="flex items-center gap-2">
                      <span className="font-mono text-xs text-indigo-400/70">{action.actionType}</span>
                      <span className="text-xs text-gray-600">—</span>
                      <span className="text-xs text-gray-500 truncate">{action.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
