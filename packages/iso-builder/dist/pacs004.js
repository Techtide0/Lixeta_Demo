/**
 * @file pacs004.ts
 * @description ISO 20022 pacs.004.001.09 — Payment Return
 *
 * Produces a valid, deterministic ISO 20022 payment return message.
 * Used when a credit transfer (pacs.008) is rejected, reversed, or
 * cannot be completed — e.g. invalid account, insufficient funds,
 * regulatory block, or fraud prevention.
 *
 * Security guarantees: same as pacs.008 — all inputs escaped/validated.
 */
import { RETURN_REASON_LABELS } from "./types.js";
import { escapeXml, sanitizeId, assertCurrencyCode, assertPositiveMinorUnits } from "./xml-escape.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fnv1a(str) {
    let h = 2_166_136_261 >>> 0;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16_777_619) >>> 0;
    }
    return h;
}
function computeInputHash(input) {
    const key = [
        input.amountMinorUnits, input.currency,
        input.sender, input.receiver,
        input.senderAccount, input.receiverAccount,
        input.bankCode, input.returnCode, input.originalMsgId,
    ].join("|");
    return `fnv_${fnv1a(key).toString(16).padStart(8, "0")}`;
}
function formatAmount(minorUnits) {
    return (minorUnits / 100).toFixed(2);
}
// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------
/**
 * Build a pacs.004.001.09 Payment Return XML document.
 *
 * @param input  Payment return parameters including return code and original msgId
 * @returns      Structured output with return XML + metadata
 * @throws       If input validation fails
 */
export function buildPacs004(input) {
    // ── Validate ─────────────────────────────────────────────────────────────
    assertPositiveMinorUnits(input.amountMinorUnits);
    assertCurrencyCode(input.currency);
    const generatedAt = new Date().toISOString();
    const hashHex = fnv1a([
        input.amountMinorUnits, input.currency, input.sender,
        input.receiver, input.senderAccount, input.returnCode,
    ].join("|")).toString(16).padStart(8, "0");
    const msgId = sanitizeId(input.msgId ?? `RET-${hashHex}`);
    const endToEndId = sanitizeId(input.endToEndId ?? `E2E-RET-${hashHex}`);
    const formattedAmount = formatAmount(input.amountMinorUnits);
    const inputHash = computeInputHash(input);
    // ── Sanitize all user-supplied strings ────────────────────────────────────
    const safeId = escapeXml(msgId);
    const safeE2eId = escapeXml(endToEndId);
    const safeSender = escapeXml(input.sender.slice(0, 140));
    const safeReceiver = escapeXml(input.receiver.slice(0, 140));
    const safeSenderAcc = escapeXml(input.senderAccount.slice(0, 34));
    const safeRecvrAcc = escapeXml(input.receiverAccount.slice(0, 34));
    const safeBankCode = escapeXml(input.bankCode.slice(0, 11));
    const safeBic = input.bankBic ? escapeXml(input.bankBic.slice(0, 11)) : null;
    const safeCcy = escapeXml(input.currency);
    const safeAmt = escapeXml(formattedAmount);
    const safeReturnCode = escapeXml(input.returnCode);
    const safeReturnLabel = escapeXml(RETURN_REASON_LABELS[input.returnCode] ?? input.returnCode);
    const safeReturnRsn = escapeXml(input.returnReason.slice(0, 105));
    const safeOrigMsgId = escapeXml(sanitizeId(input.originalMsgId));
    // OrgnlTxId links directly to the TxId in the original pacs.008 — critical for bank reconciliation
    const originalTxId = input.originalTxId ?? `TXN-${sanitizeId(input.originalMsgId)}`;
    const safeOrigTxId = escapeXml(originalTxId);
    const bicLine = safeBic ? `\n              <BICFI>${safeBic}</BICFI>` : "";
    // ── Build XML ─────────────────────────────────────────────────────────────
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pacs.004.001.09"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:pacs.004.001.09 pacs.004.001.09.xsd">
  <PmtRtr>
    <GrpHdr>
      <MsgId>${safeId}</MsgId>
      <CreDtTm>${escapeXml(generatedAt)}</CreDtTm>
      <NbOfTxs>1</NbOfTxs>
      <TtlRtrdIntrBkSttlmAmt Ccy="${safeCcy}">${safeAmt}</TtlRtrdIntrBkSttlmAmt>
      <SttlmInf>
        <SttlmMtd>CLRG</SttlmMtd>
        <ClrSys>
          <Cd>CBN</Cd>
        </ClrSys>
      </SttlmInf>
    </GrpHdr>
    <TxInf>
      <RtrId>${sanitizeId(`RTRID-${safeId}`)}</RtrId>
      <OrgnlGrpInf>
        <OrgnlMsgId>${safeOrigMsgId}</OrgnlMsgId>
        <OrgnlMsgNmId>pacs.008.001.08</OrgnlMsgNmId>
      </OrgnlGrpInf>
      <OrgnlEndToEndId>${safeE2eId}</OrgnlEndToEndId>
      <OrgnlTxId>${safeOrigTxId}</OrgnlTxId>
      <RtrdIntrBkSttlmAmt Ccy="${safeCcy}">${safeAmt}</RtrdIntrBkSttlmAmt>
      <IntrBkSttlmDt>${generatedAt.slice(0, 10)}</IntrBkSttlmDt>
      <RtrRsnInf>
        <Rsn>
          <Cd>${safeReturnCode}</Cd>
        </Rsn>
        <AddtlInf>${safeReturnLabel}: ${safeReturnRsn}</AddtlInf>
      </RtrRsnInf>
      <OrgnlTxRef>
        <IntrBkSttlmAmt Ccy="${safeCcy}">${safeAmt}</IntrBkSttlmAmt>
        <Dbtr>
          <Nm>${safeSender}</Nm>
          <PstlAdr>
            <Ctry>NG</Ctry>
          </PstlAdr>
        </Dbtr>
        <DbtrAcct>
          <Id>
            <Othr>
              <Id>${safeSenderAcc}</Id>
            </Othr>
          </Id>
        </DbtrAcct>
        <DbtrAgt>
          <FinInstnId>${bicLine}
            <ClrSysMmbId>
              <ClrSysId><Cd>CBN</Cd></ClrSysId>
              <MmbId>${safeBankCode}</MmbId>
            </ClrSysMmbId>
          </FinInstnId>
        </DbtrAgt>
        <CdtrAgt>
          <FinInstnId>${bicLine}
            <ClrSysMmbId>
              <ClrSysId><Cd>CBN</Cd></ClrSysId>
              <MmbId>${safeBankCode}</MmbId>
            </ClrSysMmbId>
          </FinInstnId>
        </CdtrAgt>
        <Cdtr>
          <Nm>${safeReceiver}</Nm>
          <PstlAdr>
            <Ctry>NG</Ctry>
          </PstlAdr>
        </Cdtr>
        <CdtrAcct>
          <Id>
            <Othr>
              <Id>${safeRecvrAcc}</Id>
            </Othr>
          </Id>
        </CdtrAcct>
      </OrgnlTxRef>
    </TxInf>
  </PmtRtr>
</Document>`;
    return {
        isoType: "pacs.004.001.09",
        msgId,
        endToEndId,
        xml,
        generatedAt,
        inputHash,
        formattedAmount,
        currency: input.currency,
        returnCode: input.returnCode,
        returnReason: input.returnReason,
        originalMsgId: input.originalMsgId,
        originalTxId,
    };
}
