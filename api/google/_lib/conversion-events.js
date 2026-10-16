/**
 * GA4 で「問い合わせ・予約」として数えるイベント（お客様ごとに担当者が Studio で決める。studio_workspaces.data.studio.ga4Events）。
 *   決めてあれば、そのイベントの回数（eventCount）の合計を数える。決めていなければ、今までどおりキーイベントすべての合計で、
 *   「イベントを決めていない」と記録に残す（レポートで、どの数え方かを書くため）。
 *   設定はサーバーが DB から読む（担当者の画面からでも、お客様の画面からの取り込みでも同じ数え方にする。画面からは受け取らない）。
 *   service_role の鍵はヘッダーにだけ載せ、応答・記録に出さない。
 */

const MAX_EVENTS = 10;

/** GA4 のイベント名として正しいものだけ（英字で始まり、英数字と _ で40字まで）。重複を除き、10個まで */
export function normalizeEvents(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((x) => {
    const v = String(x == null ? '' : x).trim();
    if (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(v) && out.indexOf(v) < 0) out.push(v);
  });
  return out.slice(0, MAX_EVENTS);
}

/** このお客様で数えるイベント。読めないとき・決めていないときは []（キーイベントすべての合計にする） */
export async function loadConversionEvents(clientId, env = process.env, fetchImpl = globalThis.fetch) {
  const url = String(env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key || !/^[0-9a-f-]{36}$/i.test(String(clientId || ''))) return { events: [], loaded: false };
  try {
    const r = await fetchImpl(url + '/rest/v1/studio_workspaces?select=ga4:data->studio->ga4Events&client_id=eq.' + encodeURIComponent(clientId), {
      headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (!r.ok) return { events: [], loaded: false };
    const d = await r.json().catch(() => null);
    const row = Array.isArray(d) ? d[0] : null;
    return { events: normalizeEvents(row && row.ga4), loaded: true };
  } catch (e) {
    return { events: [], loaded: false };
  }
}

/**
 * 決めたイベントの回数を数える（対象ホストの行だけ）。
 * @returns {{ total:number, byEvent:Object<string,number> }}
 */
export function sumEventRows(rows, host, events, hostOf) {
  const byEvent = {};
  events.forEach((e) => { byEvent[e] = 0; });
  (rows || []).forEach((row) => {
    const h = hostOf(row.dimensionValues?.[0]?.value || '');
    const ev = row.dimensionValues?.[1]?.value || '';
    if (h !== host || !(ev in byEvent)) return;
    byEvent[ev] += Number(row.metricValues?.[0]?.value || 0);
  });
  return { total: Object.keys(byEvent).reduce((s, k) => s + byEvent[k], 0), byEvent };
}

/** GA4 の runReport に送る形（イベント名で絞る） */
export function eventReportBody(startDate, endDate, events) {
  return {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'hostName' }, { name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: events, caseSensitive: true } } },
    limit: '10000'
  };
}
