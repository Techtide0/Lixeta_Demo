/**
 * @file analytics/compute-events.ts
 * @description Pure, deterministic event analytics derivation.
 *
 * Computes event-level aggregate statistics from the raw `events[]` array
 * in SimulationState.
 *
 * Hourly bucketing
 * ────────────────
 * Events are bucketed by UTC hour. The bucket key is the ISO string of the
 * start of the hour: "2026-03-19T14:00:00.000Z".
 * This makes the timeline data directly usable in frontend chart libraries
 * without any client-side transformation.
 *
 * Duration calculation
 * ────────────────────
 * sessionDurationMs = lastEventTimestamp - firstEventTimestamp.
 * Returns null if < 2 events (duration is undefined for a single event).
 */

import type { DomainEvent } from "../../../../packages/models/src/index.js";
import type { EventAnalytics, EventTypeCount, HourlyEventCount } from "./types.js";

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeEvents(
  events: ReadonlyArray<DomainEvent>
): EventAnalytics {
  if (events.length === 0) {
    return emptyEvents();
  }

  const typeMap = new Map<string, number>();
  const hourMap = new Map<string, number>();

  let firstTimestamp: number | null = null;
  let lastTimestamp: number | null = null;

  for (const event of events) {
    // Type count
    typeMap.set(event.type, (typeMap.get(event.type) ?? 0) + 1);

    // Hourly bucket
    const hourKey = toHourBucket(event.timestamp);
    hourMap.set(hourKey, (hourMap.get(hourKey) ?? 0) + 1);

    // Timeline tracking
    const ts = safeParseTimestamp(event.timestamp);
    if (ts !== null) {
      if (firstTimestamp === null || ts < firstTimestamp) firstTimestamp = ts;
      if (lastTimestamp === null || ts > lastTimestamp) lastTimestamp = ts;
    }
  }

  const n = events.length;

  // Type distribution with percentages
  const byType: EventTypeCount[] = [];
  for (const [eventType, count] of [...typeMap].sort(([, a], [, b]) => b - a)) {
    byType.push({
      eventType,
      count,
      percentage: roundTo2(count / n * 100),
    });
  }

  // Hourly timeline sorted chronologically
  const byHour: HourlyEventCount[] = [];
  for (const [hour, count] of [...hourMap].sort(([a], [b]) => a.localeCompare(b))) {
    byHour.push({ hour, count });
  }

  // Average events per hour (based on observed hour span)
  const hourSpan = hourMap.size || 1;
  const averageEventsPerHour = roundTo2(n / hourSpan);

  const sessionDurationMs =
    firstTimestamp !== null && lastTimestamp !== null && lastTimestamp > firstTimestamp
      ? lastTimestamp - firstTimestamp
      : null;

  return {
    totalEventCount: n,
    uniqueEventTypes: typeMap.size,
    byType,
    byHour,
    averageEventsPerHour,
    firstEventAt: firstTimestamp !== null ? new Date(firstTimestamp).toISOString() : null,
    lastEventAt: lastTimestamp !== null ? new Date(lastTimestamp).toISOString() : null,
    sessionDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toHourBucket(isoTimestamp: string): string {
  try {
    const d = new Date(isoTimestamp);
    d.setUTCMinutes(0, 0, 0);
    return d.toISOString();
  } catch {
    return "unknown";
  }
}

function safeParseTimestamp(ts: string): number | null {
  try {
    const ms = new Date(ts).getTime();
    return isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyEvents(): EventAnalytics {
  return {
    totalEventCount: 0,
    uniqueEventTypes: 0,
    byType: [],
    byHour: [],
    averageEventsPerHour: 0,
    firstEventAt: null,
    lastEventAt: null,
    sessionDurationMs: null,
  };
}
