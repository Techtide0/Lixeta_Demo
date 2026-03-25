/**
 * @file risk-event.ts
 * @description Tracks every risk signal identified during the simulation.
 *
 * Risk events are produced by the rules engine when a rule identifies a
 * potentially problematic condition. They accumulate on SimulationState and
 * feed into risk dashboards and alerting.
 */
import type { EventType } from "../events/index.js";
/**
 * Taxonomy of risk types the system recognises.
 * Aligns with common fraud/compliance risk frameworks.
 */
export type RiskCategory = "timezone_mismatch" | "velocity_breach" | "geo_anomaly" | "amount_anomaly" | "pattern_deviation" | "duplicate_transaction" | "sanctions_match" | "aml_flag" | "fraud_indicator" | "compliance_breach" | "sla_breach" | "data_quality" | "other";
export type RiskSeverity = "low" | "medium" | "high" | "critical";
export type RiskStatus = "open" | "reviewing" | "resolved" | "escalated" | "dismissed";
/**
 * A single risk signal record.
 */
export interface RiskEvent {
    /** Unique ID for this risk record */
    readonly id: string;
    /** ISO 8601 timestamp when the risk was identified */
    readonly detectedAt: string;
    /** The domain event that triggered this risk signal */
    readonly triggeringEventId: string;
    readonly triggeringEventType: EventType;
    /** The rule that raised this risk signal, if applicable */
    readonly triggeringRuleId: string | null;
    readonly triggeringRuleName: string | null;
    /** What kind of risk this represents */
    readonly category: RiskCategory;
    /** How serious this risk is */
    readonly severity: RiskSeverity;
    /** Current lifecycle status of this risk record */
    readonly status: RiskStatus;
    /**
     * Numeric risk score: 0.0 – 1.0.
     * 0.0 = negligible, 1.0 = maximum risk.
     */
    readonly score: number;
    /** Human-readable description of the risk */
    readonly description: string;
    /**
     * Evidence snapshot: key facts used to justify raising this risk.
     * Must be fully typed — consumers rely on this for rendering.
     */
    readonly evidence: RiskEvidence;
    /** ID of the agent or system that resolved this risk, if applicable */
    readonly resolvedBy?: string;
    /** ISO 8601 timestamp when risk was resolved, if applicable */
    readonly resolvedAt?: string;
    /** Free-text notes added during review */
    readonly reviewNotes?: string;
}
/**
 * Strongly-typed evidence supporting a risk signal.
 * Use the most specific sub-type available; fall back to `generic`.
 */
export type RiskEvidence = TimezoneEvidencePayload | VelocityEvidencePayload | AmountEvidencePayload | GeoEvidencePayload | GenericEvidencePayload;
export interface TimezoneEvidencePayload {
    readonly type: "timezone";
    readonly recipientTimezone: string;
    readonly transactionLocalHour: number;
    readonly normalWindowStart: number;
    readonly normalWindowEnd: number;
}
export interface VelocityEvidencePayload {
    readonly type: "velocity";
    readonly observedCount: number;
    readonly threshold: number;
    readonly windowMs: number;
    readonly partyId: string;
}
export interface AmountEvidencePayload {
    readonly type: "amount";
    readonly transactionAmountMinorUnits: number;
    readonly typicalAmountMinorUnits: number;
    readonly deviationPercent: number;
    readonly currency: string;
}
export interface GeoEvidencePayload {
    readonly type: "geo";
    readonly expectedCountry: string;
    readonly observedCountry: string;
    readonly distanceKm?: number;
}
export interface GenericEvidencePayload {
    readonly type: "generic";
    readonly facts: Readonly<Record<string, unknown>>;
}
export interface RiskAggregate {
    readonly totalSignals: number;
    readonly openSignals: number;
    readonly criticalSignals: number;
    readonly averageScore: number;
    readonly byCategory: Readonly<Partial<Record<RiskCategory, number>>>;
    readonly bySeverity: Readonly<Partial<Record<RiskSeverity, number>>>;
}
