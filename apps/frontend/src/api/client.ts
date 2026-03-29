/**
 * API Client — thin fetch layer only.
 * No business logic. No transformations. Just fetch + return.
 */

const BASE_URL = (import.meta as any).env?.VITE_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.message ?? `HTTP ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// --- Session ---

export async function createSession(label?: string) {
  return request<any>('/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      metadata: {
        label: label ?? 'Sandbox Session',
        environment: 'development',
        tags: ['sandbox-ui'],
      },
    }),
  });
}

export async function closeSession(sessionId: string) {
  return request<any>('/session/close', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
}

// --- Event payload builder ---
// Each event type expects a specific payload shape from the model definitions.
// message.sent requires appOpen: true to trigger the Smart Notification rule
// and generate sms_saved revenue (gain direction).

function buildEventPayload(eventType: string): Record<string, unknown> {
  const msgId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const payId = () => `pay_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const simId = () => `sim_${Date.now()}`;

  switch (eventType) {
    case 'message.sent':
      return {
        messageId: msgId(),
        recipientPhone: '+2348100000000',
        appOpen: true,          // triggers Smart Notification rule → sms_saved gain revenue
      };
    case 'message.delivered':
      return { messageId: msgId() };
    case 'message.failed':
      return { messageId: msgId(), reason: 'Network timeout' };
    case 'message.read':
      return { messageId: msgId() };
    case 'message.retried':
      return { messageId: msgId(), attempt: 2 };
    case 'payment.initiated':
      return { paymentId: payId(), amount: 150000 };
    case 'payment.succeeded':
      return { paymentId: payId() };
    case 'payment.failed':
      return { paymentId: payId(), reason: 'Insufficient funds' };
    case 'payment.reversed':
      return { paymentId: payId() };
    case 'payment.timeout':
      return { paymentId: payId() };
    case 'user.authenticated':
      return {
        userId: `usr_${Date.now()}`,
        deviceCountry: 'GB',
        accountCountry: 'NG',
        deviceTimezone: 'Europe/London',
        accountTimezone: 'Africa/Lagos',
      };
    case 'user.login':
      return {
        userId: `usr_${Date.now()}`,
        deviceCountry: 'US',
        accountCountry: 'NG',
        deviceTimezone: 'America/New_York',
        accountTimezone: 'Africa/Lagos',
      };
    case 'user.deauthenticated':
      return { userId: `usr_${Date.now()}` };
    case 'session.started':
      return { sessionId: `sess_${Date.now()}`, userId: `usr_${Date.now()}` };
    case 'session.ended':
      return { sessionId: `sess_${Date.now()}` };
    case 'risk.flag_raised':
      return { riskId: `risk_${Date.now()}`, score: 0.82, category: 'fraud' };
    case 'risk.threshold_breached':
      return { riskId: `risk_${Date.now()}`, threshold: 0.75, score: 0.91 };
    case 'risk.flag_cleared':
      return { riskId: `risk_${Date.now()}` };
    case 'simulation.started':
      return { simulationId: simId() };
    case 'simulation.completed':
      return { simulationId: simId() };
    case 'revenue.earned':
      return { amount: 50000, category: 'subscription', currency: 'NGN' };
    case 'revenue.lost':
      return { amount: 10000, category: 'refund', currency: 'NGN' };
    default:
      return { triggeredBy: 'sandbox-ui', eventType };
  }
}

// --- Events ---

export async function triggerEvent(sessionId: string, eventType: string) {
  return request<any>('/trigger-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      type: eventType,
      timestamp: new Date().toISOString(),
      source: {
        id: 'sandbox-ui',
        name: 'Sandbox UI',
        version: '1.0.0',
        channel: 'api',
      },
      payload: buildEventPayload(eventType),
    }),
  });
}

// --- Analytics ---

export async function getAnalytics(sessionId: string) {
  return request<any>(`/analytics?sessionId=${encodeURIComponent(sessionId)}`);
}

// --- Logs ---

export async function getLogs(sessionId: string, limit = 100) {
  return request<any>(`/logs?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`);
}

// --- Session aggression ---

export async function setAggression(sessionId: string, level: number) {
  return request<any>('/session/aggression', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, level }),
  });
}

// --- ISO ---

export async function getIso(mode: 'success' | 'kill') {
  return request<any>(`/iso/pacs008?mode=${mode}`);
}

// --- Dispute ---

/**
 * Download a dispute evidence ZIP for a specific event.
 * Returns a Blob — caller should create an object URL and trigger download.
 */
export async function downloadDispute(sessionId: string, eventId: string): Promise<Blob> {
  const res = await fetch(`${BASE_URL}/dispute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, eventId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any)?.error?.message ?? `HTTP ${res.status}`);
  }
  return res.blob();
}

// --- Health ---

export async function getHealth() {
  return request<any>('/health');
}

// --- Simulation controller ---

export async function startSim() {
  return request<any>('/sim/start', { method: 'POST' });
}

export async function stopSim() {
  return request<any>('/sim/stop', { method: 'POST' });
}

export async function getSimStatus() {
  return request<any>('/sim/status');
}
