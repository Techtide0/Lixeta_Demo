/**
 * RiskPanel — real-time risk scoring driven entirely by backend riskEvents.
 * No hardcoded numbers. Every value comes from the engine.
 */

import React from 'react';
import { ShieldAlert, Shield, TrendingUp, Globe, Smartphone, Activity } from 'lucide-react';

export interface RiskEvent {
  id: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  description: string;
  triggeringEventType: string;
  detectedAt: string;
  evidence?: Record<string, unknown>;
}

interface RiskPanelProps {
  riskEvents?: RiskEvent[];
}

function severityColor(severity: string) {
  switch (severity) {
    case 'critical': return 'text-red-400 bg-red-500/20 border-red-500/40';
    case 'high':     return 'text-orange-400 bg-orange-500/20 border-orange-500/40';
    case 'medium':   return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/40';
    default:         return 'text-blue-400 bg-blue-500/20 border-blue-500/40';
  }
}

function scoreFill(score: number) {
  if (score >= 0.85) return 'bg-red-500';
  if (score >= 0.65) return 'bg-orange-500';
  if (score >= 0.40) return 'bg-yellow-500';
  return 'bg-blue-500';
}

function categoryIcon(category: string) {
  switch (category) {
    case 'geo_anomaly':       return <Globe className="h-4 w-4" />;
    case 'velocity_breach':   return <TrendingUp className="h-4 w-4" />;
    case 'pattern_deviation': return <Activity className="h-4 w-4" />;
    case 'timezone_anomaly':  return <Smartphone className="h-4 w-4" />;
    case 'sla_breach':        return <ShieldAlert className="h-4 w-4" />;
    default:                  return <Shield className="h-4 w-4" />;
  }
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    geo_anomaly:       'Location Risk',
    velocity_breach:   'Velocity Risk',
    pattern_deviation: 'Behaviour Risk',
    timezone_anomaly:  'Timezone Risk',
    sla_breach:        'SLA Breach',
  };
  return labels[category] ?? category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function RiskPanel({ riskEvents = [] }: RiskPanelProps) {
  if (riskEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Shield className="h-10 w-10 text-gray-700 mb-3" />
        <p className="text-sm text-green-500">No risk signals detected</p>
        <p className="text-xs text-gray-600 mt-1">System operating within normal parameters</p>
      </div>
    );
  }

  // Aggregate by category (take max score per category)
  const byCategory = new Map<string, { maxScore: number; count: number; severity: string; latest: RiskEvent }>();
  for (const event of riskEvents) {
    const existing = byCategory.get(event.category);
    if (!existing || event.score > existing.maxScore) {
      byCategory.set(event.category, {
        maxScore: event.score,
        count: (existing?.count ?? 0) + 1,
        severity: event.severity,
        latest: event,
      });
    } else {
      existing.count++;
    }
  }

  // Overall risk = max score across all signals
  const overallScore = Math.max(...riskEvents.map(e => e.score));
  const overallPercent = Math.round(overallScore * 100);
  const overallLabel = overallScore >= 0.85 ? 'Critical' : overallScore >= 0.65 ? 'High' : overallScore >= 0.40 ? 'Medium' : 'Low';
  const overallColor = overallScore >= 0.85 ? 'text-red-400' : overallScore >= 0.65 ? 'text-orange-400' : overallScore >= 0.40 ? 'text-yellow-400' : 'text-blue-400';

  const sortedCategories = [...byCategory.entries()].sort(([, a], [, b]) => b.maxScore - a.maxScore);

  return (
    <div className="space-y-4">
      {/* Overall score */}
      <div className="rounded-xl border border-white/10 bg-gray-900/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">Overall Risk Score</span>
          <div className="flex items-center gap-2">
            <span className={`text-2xl font-bold font-mono ${overallColor}`}>{overallPercent}</span>
            <span className={`text-sm font-semibold ${overallColor}`}>{overallLabel}</span>
          </div>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-800 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${scoreFill(overallScore)}`}
            style={{ width: `${overallPercent}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
          <span>0 — Clean</span>
          <span>{riskEvents.length} signal{riskEvents.length !== 1 ? 's' : ''} detected</span>
          <span>100 — Critical</span>
        </div>
      </div>

      {/* Category breakdown */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-600">Risk Breakdown</p>
        {sortedCategories.map(([category, data]) => (
          <div key={category} className="rounded-lg border border-white/5 bg-gray-900/40 p-3">
            <div className="flex items-center gap-3">
              <div className={`flex-shrink-0 rounded-lg border p-1.5 ${severityColor(data.severity)}`}>
                {categoryIcon(category)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">{categoryLabel(category)}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-mono font-bold ${scoreFill(data.maxScore).replace('bg-', 'text-')}`}>
                      {Math.round(data.maxScore * 100)}
                    </span>
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${severityColor(data.severity)}`}>
                      {data.severity}
                    </span>
                  </div>
                </div>
                <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${scoreFill(data.maxScore)}`}
                    style={{ width: `${Math.round(data.maxScore * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500 truncate">{data.latest.description}</p>
              </div>
              {data.count > 1 && (
                <span className="flex-shrink-0 rounded-full bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
                  ×{data.count}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Event log */}
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-600">Recent Signals</p>
        {riskEvents.slice(-5).reverse().map((event) => (
          <div key={event.id} className="flex items-start gap-3 rounded-md border border-white/5 bg-gray-900/30 px-3 py-2">
            <span className={`mt-0.5 rounded-full border px-1.5 py-0.5 text-xs font-medium flex-shrink-0 ${severityColor(event.severity)}`}>
              {event.severity}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-300 leading-relaxed">{event.description}</p>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-600">
                <span className="font-mono">{event.triggeringEventType}</span>
                <span>·</span>
                <span>{new Date(event.detectedAt).toLocaleTimeString()}</span>
              </div>
            </div>
            <span className="flex-shrink-0 font-mono text-xs text-gray-500">
              {Math.round(event.score * 100)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
