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
import { buildPacs008 } from "@lixeta/iso-builder";
import { buildPacs004 } from "@lixeta/iso-builder";
import { sendSuccess, send400 } from "../lib/response.js";
const router = createRouter();
// ---------------------------------------------------------------------------
// Demo payment fixture — deterministic, realistic NGN values
// ---------------------------------------------------------------------------
const SUCCESS_FIXTURE = {
    amountMinorUnits: 150_000, // ₦1,500.00
    currency: "NGN",
    sender: "Adaeze Okonkwo",
    receiver: "Emeka Nwosu",
    senderAccount: "0123456789",
    receiverAccount: "9876543210",
    bankCode: "044", // Access Bank CBN sort code
};
const KILL_FIXTURE = {
    ...SUCCESS_FIXTURE,
    returnCode: "AM04", // InsufficientFunds
    returnReason: "Sender account has insufficient funds to complete the transfer",
    originalMsgId: "MSG-00000000",
};
// ---------------------------------------------------------------------------
// Simulated latency — deterministic, not real time.sleep()
// Uses a simple hash of the mode string for consistent demo output.
// ---------------------------------------------------------------------------
function simulatedLatencyMs(mode) {
    // Produce a stable 5–25ms range based on mode string
    let h = 0;
    for (let i = 0; i < mode.length; i++)
        h = (h * 31 + mode.charCodeAt(i)) & 0xffff;
    return 5 + (h % 20);
}
// ---------------------------------------------------------------------------
// Route: GET /pacs008
// ---------------------------------------------------------------------------
router.get("/pacs008", (req, res) => {
    const requestId = res.locals["requestId"] ?? "unknown";
    const rawMode = req.query?.["mode"] ?? "success";
    const mode = rawMode.toLowerCase();
    if (mode !== "success" && mode !== "kill") {
        send400(res, `Invalid mode "${rawMode}". Must be "success" or "kill".`, requestId);
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
        }
        else {
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
                latencyMs,
            }, requestId);
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        send400(res, `ISO build failed: ${msg}`, requestId);
    }
});
export { router as isoRouter };
