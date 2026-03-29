/**
 * @file routes/iso.ts
 * @description GET /iso/pacs008 — Generate ISO 20022 demo messages.
 *
 * Provides a testable interface for the frontend ISO viewer.
 *
 * Query parameters:
 *   mode = "success" | "kill"
 *     success → produces a pacs.008.001.08 Customer Credit Transfer
 *     kill    → produces a pacs.004.001.09 Payment Return (failure/reversal)
 *
 * Security:
 *   - No session required (standalone demo endpoint)
 *   - Still rate-limited + auth-gated at the router level
 *   - All XML is built by the iso-builder package (injection-safe)
 *   - Latency is simulated deterministically (not random) to enable replay
 */

import { createRouter } from "../lib/mini-router.js";
import type { Req as Request, Res as Response } from "../lib/mini-router.js";
import { buildPacs008 } from "@lixeta/iso-builder";
import { buildPacs004 } from "@lixeta/iso-builder";
import { sendSuccess, send400, send500 } from "../lib/response.js";

const router = createRouter();

// ---------------------------------------------------------------------------
// Demo payment fixture — deterministic, realistic NGN values
// ---------------------------------------------------------------------------

const SUCCESS_FIXTURE = {
  amountMinorUnits: 150_000,   // ₦1,500.00
  currency: "NGN",
  sender: "Adaeze Okonkwo",
  receiver: "Emeka Nwosu",
  senderAccount: "0123456789",
  receiverAccount: "9876543210",
  bankCode: "044",              // Access Bank CBN sort code
  bankBic: "ABNGNGLA",          // Access Bank Nigeria SWIFT BIC
} as const;

// Pre-build once to derive the deterministic msgId — used as the original
// reference in the pacs.004 so the two messages form a traceable chain.
const _successRef = buildPacs008(SUCCESS_FIXTURE);

const KILL_FIXTURE = {
  ...SUCCESS_FIXTURE,
  // Preserve the original EndToEndId — it must flow unchanged across the
  // full payment lifecycle (pacs.008 → pacs.004) for bank reconciliation.
  endToEndId: _successRef.endToEndId,
  returnCode: "AB03" as const,  // SettlementTransactionTimeout — SLA breach
  returnReason: "SLA Breach: Transaction failed to reach deterministic finality within the 25.00s threshold. Auto-reversed by Lixeta.",
  originalMsgId: _successRef.msgId,
  originalTxId: `TXN-${_successRef.msgId}`,
} as const;

// ---------------------------------------------------------------------------
// Simulated latency — deterministic, not real time.sleep()
// Uses a simple hash of the mode string for consistent demo output.
// ---------------------------------------------------------------------------

function simulatedLatencyMs(mode: string): number {
  // Produce a stable 5–25ms range based on mode string
  let h = 0;
  for (let i = 0; i < mode.length; i++) h = (h * 31 + mode.charCodeAt(i)) & 0xffff;
  return 5 + (h % 20);
}

// ---------------------------------------------------------------------------
// Route: GET /pacs008
// ---------------------------------------------------------------------------

router.get("/pacs008", (req: Request, res: Response): void => {
  const requestId = (res.locals["requestId"] as string | undefined) ?? "unknown";
  const rawMode   = (req.query?.["mode"] as string | undefined) ?? "success";
  const mode      = rawMode.toLowerCase();

  if (mode !== "success" && mode !== "kill") {
    send400(
      res,
      `Invalid mode "${rawMode}". Must be "success" or "kill".`,
      requestId
    );
    return;
  }

  try {
    const start = Date.now();

    if (mode === "success") {
      const result = buildPacs008(SUCCESS_FIXTURE);
      const latencyMs = simulatedLatencyMs(mode) + (Date.now() - start);
      sendSuccess(res, {
        mode,
        isoType: result.isoType,
        msgId: result.msgId,
        endToEndId: result.endToEndId,
        xml: result.xml,
        generatedAt: result.generatedAt,
        inputHash: result.inputHash,
        formattedAmount: result.formattedAmount,
        currency: result.currency,
        latencyMs,
      }, requestId);
    } else {
      const result = buildPacs004(KILL_FIXTURE);
      const latencyMs = simulatedLatencyMs(mode) + (Date.now() - start);
      sendSuccess(res, {
        mode,
        isoType: result.isoType,
        msgId: result.msgId,
        endToEndId: result.endToEndId,
        xml: result.xml,
        generatedAt: result.generatedAt,
        inputHash: result.inputHash,
        formattedAmount: result.formattedAmount,
        currency: result.currency,
        returnCode: result.returnCode,
        returnReason: result.returnReason,
        originalMsgId: result.originalMsgId,
        originalTxId: result.originalTxId,
        latencyMs,
      }, requestId);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    send400(res, `ISO build failed: ${msg}`, requestId);
  }
});

export { router as isoRouter };
