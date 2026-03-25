/**
 * DecisionTimeline — chronological view of every event + its decision.
 * Data comes directly from the backend. Zero hardcoded values.
 */

import React, { useState } from 'react';
import { CheckCircle2, XCircle, Flag, Clock, ArrowRight, DollarSign, AlertTriangle, Download, Loader2 } from 'lucide-react';

export interface TimelineEntry {
  eventId: string;
  eventType: string;
  timestamp: string;
  verdict: string;
  reason: string;
  executionMs: number;
  savingsKobo: number;
  costKobo: number;
  riskCount: number;
  rulesApplied: number;
}

interface DecisionTimelineProps {
  entries?: TimelineEntry[];
  onDownloadDispute?: (eventId: string) => Promise<void>;
}

function verdictBadge(verdict: string) {
  switch (verdict) {
    case 'allow':
      return (
        <span className="flex items-center gap-1 rounded-full border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
          <CheckCircle2 className="h-2.5 w-2.5" />allow
        </span>
      );
    case 'block':
      return (
        <span className="flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-400">
          <XCircle className="h-2.5 w-2.5" />block
        </span>
      );
    case 'flag':
      return (
        <span className="flex items-center gap-1 rounded-full border border-yellow-500/40 bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-400">
          <Flag className="h-2.5 w-2.5" />flag
        </span>
      );
    case 'defer':
      return (
        <span className="flex items-center gap-1 rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">
          <Clock className="h-2.5 w-2.5" />defer
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1 rounded-full border border-red-500/40 bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-300">
          <XCircle className="h-2.5 w-2.5" />error
        </span>
      );
    default:
      return (
        <span className="rounded-full border border-gray-500/40 bg-gray-500/10 px-2 py-0.5 text-xs font-medium text-gray-400">
          {verdict}
        </span>
      );
  }
}

function verdictLineColor(verdict: string) {
  switch (verdict) {
    case 'allow': return 'border-green-500/40';
    case 'block': return 'border-red-500/40';
    case 'flag':  return 'border-yellow-500/40';
    case 'defer': return 'border-blue-500/40';
    default:      return 'border-gray-500/30';
  }
}

export function DecisionTimeline({ entries = [], onDownloadDispute }: DecisionTimelineProps) {
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleDownload = async (eventId: string) => {
    if (!onDownloadDispute || downloading) return;
    setDownloading(eventId);
    try {
      await onDownloadDispute(eventId);
    } finally {
      setDownloading(null);
    }
  };
  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ArrowRight className="h-10 w-10 text-gray-700 mb-3" />
        <p className="text-sm text-gray-500">No decisions yet</p>
        <p className="text-xs text-gray-600 mt-1">Trigger events to populate the timeline</p>
      </div>
    );
  }

  // Show most recent first
  const sorted = [...entries].reverse();

  return (
    <div className="relative space-y-0">
      {sorted.map((entry, i) => (
        <div key={entry.eventId} className="relative flex gap-4">
          {/* Timeline spine */}
          <div className="flex flex-col items-center">
            <div className={`mt-3 h-3 w-3 rounded-full border-2 flex-shrink-0 ${verdictLineColor(entry.verdict)} bg-gray-900`} />
            {i < sorted.length - 1 && (
              <div className="w-px flex-1 bg-gray-800 mt-0.5 mb-0" style={{ minHeight: '28px' }} />
            )}
          </div>

          {/* Entry card */}
          <div className="flex-1 pb-4">
            <div className={`rounded-lg border p-3 ${
              entry.verdict === 'block' ? 'border-red-500/20 bg-red-500/5' :
              entry.verdict === 'flag'  ? 'border-yellow-500/20 bg-yellow-500/5' :
              entry.verdict === 'defer' ? 'border-blue-500/20 bg-blue-500/5' :
              'border-white/5 bg-gray-900/30'
            }`}>
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-medium text-white">{entry.eventType}</span>
                  {verdictBadge(entry.verdict)}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 font-mono">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  {onDownloadDispute && (
                    <button
                      onClick={() => handleDownload(entry.eventId)}
                      disabled={downloading === entry.eventId}
                      title="Download dispute evidence package"
                      className="flex items-center gap-1 rounded border border-white/10 bg-gray-800/60 px-2 py-0.5 text-xs text-gray-400 hover:border-indigo-500/40 hover:text-indigo-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {downloading === entry.eventId
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <Download className="h-3 w-3" />}
                      <span>Dispute</span>
                    </button>
                  )}
                </div>
              </div>

              {entry.reason && (
                <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">{entry.reason}</p>
              )}

              {/* Stats row */}
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <span className="flex items-center gap-1 text-xs text-gray-600">
                  <Clock className="h-3 w-3" />
                  {entry.executionMs}ms
                </span>
                <span className="text-xs text-gray-700">·</span>
                <span className="text-xs text-gray-600">
                  {entry.rulesApplied} rule{entry.rulesApplied !== 1 ? 's' : ''}
                </span>
                {entry.savingsKobo > 0 && (
                  <>
                    <span className="text-xs text-gray-700">·</span>
                    <span className="flex items-center gap-1 text-xs text-green-400">
                      <DollarSign className="h-3 w-3" />
                      ₦{(entry.savingsKobo / 100).toFixed(2)} saved
                    </span>
                  </>
                )}
                {entry.costKobo > 0 && (
                  <>
                    <span className="text-xs text-gray-700">·</span>
                    <span className="flex items-center gap-1 text-xs text-orange-400">
                      <AlertTriangle className="h-3 w-3" />
                      ₦{(entry.costKobo / 100).toFixed(2)} cost
                    </span>
                  </>
                )}
                {entry.riskCount > 0 && (
                  <>
                    <span className="text-xs text-gray-700">·</span>
                    <span className="text-xs text-red-400">
                      {entry.riskCount} risk signal{entry.riskCount !== 1 ? 's' : ''}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
