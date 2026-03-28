/**
 * @file analytics/compute-revenue.ts
 * @description Pure, deterministic revenue analytics derivation.
 *
 * Contract
 * ────────
 * • Takes the raw `revenueEvents[]` array from a SessionRecord.
 * • Returns a fully computed `RevenueAnalytics` object.
 * • Never mutates inputs. Never reads from the store.
 * • Calling this function twice with the same input returns the same output.
 *
 * "Savings" definition: events with `direction === "gain"` across the
 * categories: sms_saved, transaction_fee, interchange, bonus, subscription.
 * All other gain categories contribute to totalGain but not totalSavings.
 *
 * Currency handling: all amounts are in minor units (kobo, cents, etc.).
 * The multiplier (100 for NGN/USD) converts to decimal amounts for display.
 * If a session has mixed currencies, each currency bucket is computed
 * independently — mixed-currency totals are NOT summed to prevent
 * accounting errors. The primary currency is the one with the most events.
 */

import type { RevenueEvent } from "@lixeta/models";
import type {
  RevenueAnalytics,
  RevenueBreakdown,
  CategoryRevenue,
  DailyRevenue,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SAVINGS_CATEGORIES = new Set([
  "sms_saved",
  "transaction_fee",
  "interchange",
  "bonus",
  "subscription",
]);

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

export function computeRevenue(
  revenueEvents: ReadonlyArray<RevenueEvent>,
  minorUnitMultiplier = 100
): RevenueAnalytics {
  if (revenueEvents.length === 0) {
    return emptyRevenue(minorUnitMultiplier);
  }

  // Determine primary currency (most-used)
  const primaryCurrency = getPrimaryCurrency(revenueEvents);

  // Filter to primary currency — mixed-currency sessions show primary only
  const events = revenueEvents.filter(
    (e) => e.amount.currency === primaryCurrency
  );

  let totalGain = 0;
  let totalLoss = 0;
  let totalSavings = 0;
  let gainCount = 0;
  let lossCount = 0;

  const categoryMap = new Map<string, {
    gain: number; loss: number; count: number;
  }>();

  const channelMap = new Map<string, number>();
  const eventTypeMap = new Map<string, number>();
  const dayMap = new Map<string, { gain: number; loss: number; count: number }>();

  for (const event of events) {
    const amount = event.amount.amountMinorUnits;
    const isGain = event.direction === "gain";

    if (isGain) {
      totalGain += amount;
      gainCount++;
      if (SAVINGS_CATEGORIES.has(event.category)) {
        totalSavings += amount;
      }
    } else {
      totalLoss += amount;
      lossCount++;
    }

    // Category aggregation
    const cat = categoryMap.get(event.category) ?? { gain: 0, loss: 0, count: 0 };
    categoryMap.set(event.category, {
      gain: cat.gain + (isGain ? amount : 0),
      loss: cat.loss + (isGain ? 0 : amount),
      count: cat.count + 1,
    });

    // Channel aggregation (from metadata or default "unknown")
    const channel = extractChannel(event);
    channelMap.set(channel, (channelMap.get(channel) ?? 0) + (isGain ? amount : -amount));

    // Event type aggregation
    const evtType = event.triggeringEventType as string;
    eventTypeMap.set(evtType, (eventTypeMap.get(evtType) ?? 0) + (isGain ? amount : -amount));

    // Daily aggregation
    const day = event.recordedAt.substring(0, 10); // YYYY-MM-DD
    const dayEntry = dayMap.get(day) ?? { gain: 0, loss: 0, count: 0 };
    dayMap.set(day, {
      gain: dayEntry.gain + (isGain ? amount : 0),
      loss: dayEntry.loss + (isGain ? 0 : amount),
      count: dayEntry.count + 1,
    });
  }

  const net = totalGain - totalLoss;

  const byCategory: Record<string, CategoryRevenue> = {};
  for (const [cat, data] of categoryMap) {
    byCategory[cat] = {
      category: cat,
      totalGainMinorUnits: data.gain,
      totalLossMinorUnits: data.loss,
      netMinorUnits: data.gain - data.loss,
      eventCount: data.count,
      currency: primaryCurrency,
    };
  }

  const byChannel: Record<string, number> = {};
  for (const [ch, net2] of channelMap) byChannel[ch] = net2;

  const byEventType: Record<string, number> = {};
  for (const [et, net2] of eventTypeMap) byEventType[et] = net2;

  const byDay: DailyRevenue[] = [];
  for (const [date, data] of [...dayMap].sort(([a], [b]) => a.localeCompare(b))) {
    byDay.push({
      date,
      gainMinorUnits: data.gain,
      lossMinorUnits: data.loss,
      netMinorUnits: data.gain - data.loss,
      eventCount: data.count,
    });
  }

  const breakdown: RevenueBreakdown = { byCategory, byChannel, byEventType, byDay };

  return {
    totalGainMinorUnits: totalGain,
    totalLossMinorUnits: totalLoss,
    netMinorUnits: net,
    netAmount: roundToDecimals(net / minorUnitMultiplier, 2),
    currency: primaryCurrency,
    minorUnitMultiplier,
    totalRevenueEventCount: events.length,
    gainEventCount: gainCount,
    lossEventCount: lossCount,
    totalSavingsMinorUnits: totalSavings,
    breakdown,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPrimaryCurrency(events: ReadonlyArray<RevenueEvent>): string {
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.amount.currency, (counts.get(e.amount.currency) ?? 0) + 1);
  }
  let max = 0;
  let primary = "NGN";
  for (const [currency, count] of counts) {
    if (count > max) { max = count; primary = currency; }
  }
  return primary;
}

function extractChannel(event: RevenueEvent): string {
  const meta = event.metadata as Record<string, unknown>;
  const ch = meta["originalChannel"] ?? meta["sentChannel"] ?? meta["suppressedChannel"];
  return typeof ch === "string" ? ch : "unknown";
}

function roundToDecimals(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

function emptyRevenue(multiplier: number): RevenueAnalytics {
  return {
    totalGainMinorUnits: 0,
    totalLossMinorUnits: 0,
    netMinorUnits: 0,
    netAmount: 0,
    currency: "NGN",
    minorUnitMultiplier: multiplier,
    totalRevenueEventCount: 0,
    gainEventCount: 0,
    lossEventCount: 0,
    totalSavingsMinorUnits: 0,
    breakdown: { byCategory: {}, byChannel: {}, byEventType: {}, byDay: [] },
  };
}
