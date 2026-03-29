import React from 'react';
import { LineChart, Line, Tooltip, ResponsiveContainer } from 'recharts';
import { DollarSign, TrendingUp, ShieldAlert, Zap, Activity } from 'lucide-react';

// --- TYPES ---
export interface KpiData {
  netRevenueAmount: number;
  totalSavingsMinorUnits: number;
  riskExposureScore: number;
  rulesFiredCount: number;
  totalEvents: number;
  currency: string;
  openRiskSignals: number;
  flaggedDecisions: number;
  blockedDecisions: number;
}

interface StatCardProps {
  title: string;
  value: string;
  change: string;
  changeType: 'positive' | 'negative' | 'neutral';
  icon: React.ElementType;
  chartData: Array<{ name: string; uv: number }>;
}

// --- CUSTOM TOOLTIP ---
const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-white/10 bg-gray-900/80 p-2 text-sm shadow-md backdrop-blur-sm">
        <p className="text-white">{`Value: ${payload[0].value}`}</p>
      </div>
    );
  }
  return null;
};

// --- STAT CARD COMPONENT ---
function StatCard({ title, value, change, changeType, icon: Icon, chartData }: StatCardProps) {
  const chartColor =
    changeType === 'positive' ? '#4ade80' :
    changeType === 'negative' ? '#f87171' :
    '#818cf8';

  return (
    <div className="group rounded-2xl border border-white/10 bg-gray-800/40 p-5 shadow-lg transition-all duration-300 ease-in-out hover:border-white/20 hover:bg-gray-800/60 transform hover:-translate-y-1 cursor-pointer">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium text-gray-400">{title}</h3>
        <Icon className="h-5 w-5 text-gray-500" />
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div className="flex flex-col">
          <p className="text-3xl font-bold tracking-tighter text-white">{value}</p>
          <p className={`mt-1 text-xs ${
            changeType === 'positive' ? 'text-green-400' :
            changeType === 'negative' ? 'text-red-400' :
            'text-indigo-400'
          }`}>
            {change}
          </p>
        </div>
        <div className="h-12 w-28">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id={`colorUv-${title}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={chartColor} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '3 3' }} />
              <Line type="monotone" dataKey="uv" stroke={chartColor} strokeWidth={2} dot={false} fillOpacity={1} fill={`url(#colorUv-${title})`} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// --- EMPTY CHART DATA ---
const emptyChart = Array.from({ length: 7 }, (_, i) => ({ name: String(i), uv: 0 }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format kobo (minor units) as a human-readable ₦ string.
 * The demo multiplies raw savings by DEMO_VOLUME_FACTOR so that a sandbox
 * session with ~10 events looks like realistic fintech scale (thousands of
 * daily transactions), giving the client a believable revenue picture.
 */
const DEMO_VOLUME_FACTOR = 250; // represents ~250 equivalent transactions per event

function fmtNgn(kobo: number, symbol = '₦'): string {
  const scaled = (kobo * DEMO_VOLUME_FACTOR) / 100;
  if (scaled >= 1_000_000) return `${symbol}${(scaled / 1_000_000).toFixed(2)}M`;
  if (scaled >= 1_000)     return `${symbol}${(scaled / 1_000).toFixed(1)}k`;
  return `${symbol}${scaled.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// --- KPI BAR COMPONENT (live data) ---
export function KpiBar({ kpi }: { kpi: KpiData | null }) {
  const currency = kpi?.currency === 'NGN' ? '₦' : (kpi?.currency ?? '₦');

  const totalSavings   = kpi ? fmtNgn(kpi.totalSavingsMinorUnits, currency) : '—';
  const netRevenue     = kpi ? fmtNgn(kpi.netRevenueAmount != null ? kpi.netRevenueAmount * 100 : kpi.totalSavingsMinorUnits, currency) : '—';
  const riskExposure   = kpi ? `${(kpi.riskExposureScore * 100).toFixed(1)}%` : '—';
  const rulesFired     = kpi ? kpi.rulesFiredCount.toLocaleString() : '—';
  const totalEvents    = kpi ? kpi.totalEvents.toLocaleString() : '—';

  const riskType = kpi && kpi.riskExposureScore > 0.5
    ? 'negative'
    : kpi && kpi.riskExposureScore > 0.2
    ? 'neutral'
    : 'positive';

  const cards: StatCardProps[] = [
    {
      title: 'Total Revenue Saved',
      value: netRevenue,
      change: kpi
        ? `${kpi.openRiskSignals} open risk signal${kpi.openRiskSignals !== 1 ? 's' : ''}`
        : 'Start a session to see live data',
      changeType: (kpi?.netRevenueAmount ?? 0) >= 0 ? 'positive' : 'negative',
      icon: DollarSign,
      chartData: emptyChart,
    },
    {
      title: 'SMS Cost Savings',
      value: totalSavings,
      change: kpi
        ? `${kpi.flaggedDecisions} decision${kpi.flaggedDecisions !== 1 ? 's' : ''} flagged for review`
        : 'No session active',
      changeType: 'positive',
      icon: TrendingUp,
      chartData: emptyChart,
    },
    {
      title: 'Risk Exposure %',
      value: riskExposure,
      change: kpi
        ? `${kpi.openRiskSignals} active signal${kpi.openRiskSignals !== 1 ? 's' : ''} · ${kpi.blockedDecisions} blocked`
        : 'No session active',
      changeType: riskType,
      icon: ShieldAlert,
      chartData: emptyChart,
    },
    {
      title: 'Rules Evaluated',
      value: rulesFired,
      change: kpi
        ? `${kpi.blockedDecisions} transaction${kpi.blockedDecisions !== 1 ? 's' : ''} auto-blocked`
        : 'No session active',
      changeType: 'neutral',
      icon: Zap,
      chartData: emptyChart,
    },
    {
      title: 'Events Processed',
      value: totalEvents,
      change: kpi
        ? `${kpi.flaggedDecisions} flagged · ${kpi.blockedDecisions} blocked`
        : 'No session active',
      changeType: 'positive',
      icon: Activity,
      chartData: emptyChart,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <StatCard key={card.title} {...card} />
      ))}
    </div>
  );
}

// --- ORIGINAL DEMO DASHBOARD (static mock data, kept for reference) ---
const analyticsData = [
  {
    title: 'Total Revenue',
    value: '$45,231.89',
    change: '+20.1%',
    changeType: 'positive' as const,
    icon: DollarSign,
    chartData: [
      { name: 'Page A', uv: 4000 }, { name: 'Page B', uv: 3000 }, { name: 'Page C', uv: 2000 },
      { name: 'Page D', uv: 2780 }, { name: 'Page E', uv: 1890 }, { name: 'Page F', uv: 2390 },
      { name: 'Page G', uv: 3490 },
    ],
  },
  {
    title: 'Subscriptions',
    value: '+2350',
    change: '+180.1%',
    changeType: 'positive' as const,
    icon: TrendingUp,
    chartData: [
      { name: 'Page A', uv: 1200 }, { name: 'Page B', uv: 2100 }, { name: 'Page C', uv: 1800 },
      { name: 'Page D', uv: 2500 }, { name: 'Page E', uv: 2100 }, { name: 'Page F', uv: 3000 },
      { name: 'Page G', uv: 3200 },
    ],
  },
  {
    title: 'Sales',
    value: '+12,234',
    change: '+19%',
    changeType: 'negative' as const,
    icon: Activity,
    chartData: [
      { name: 'Page A', uv: 4000 }, { name: 'Page B', uv: 3500 }, { name: 'Page C', uv: 3800 },
      { name: 'Page D', uv: 3200 }, { name: 'Page E', uv: 2800 }, { name: 'Page F', uv: 2500 },
      { name: 'Page G', uv: 2300 },
    ],
  },
  {
    title: 'Active Now',
    value: '+573',
    change: '+201 since last hour',
    changeType: 'positive' as const,
    icon: Activity,
    chartData: [
      { name: 'Page A', uv: 2000 }, { name: 'Page B', uv: 2200 }, { name: 'Page C', uv: 2800 },
      { name: 'Page D', uv: 2400 }, { name: 'Page E', uv: 3000 }, { name: 'Page F', uv: 2700 },
      { name: 'Page G', uv: 3800 },
    ],
  },
];

export default function AnalyticsDashboard() {
  return (
    <div className="w-full max-w-7xl mx-auto">
      <header className="flex items-center justify-between pb-6 border-b border-white/10">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-400">Welcome back! Here's your performance summary.</p>
        </div>
        <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900">
          Generate Report
        </button>
      </header>
      <main className="mt-8">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {analyticsData.map((data) => (
            <StatCard key={data.title} {...data} />
          ))}
        </div>
      </main>
    </div>
  );
}
