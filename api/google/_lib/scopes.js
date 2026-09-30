/**
 * Google OAuth で要求するスコープ。Search Console（GSC）と GA4 の読み取りだけ（書き込み権限は要求しない）。
 *
 * GA4 は analytics.readonly。GA4 を止めるときは OAUTH_SCOPES から GA4_SCOPE を外すと、ga4.js は 503 ga4_not_enabled を返す。
 * スコープを増やしたときは、既に接続済みの人は再接続（同意のやり直し）が必要。
 */
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export const OAUTH_SCOPES = [
  GSC_SCOPE,
  GA4_SCOPE
];

export function isGa4Enabled() {
  return OAUTH_SCOPES.includes(GA4_SCOPE);
}

/** 画面に知らせる「許可された機能」の名前（Cookie airreach_google_scopes の値。秘密ではない） */
export const SCOPE_FEATURES = { [GSC_SCOPE]: 'gsc', [GA4_SCOPE]: 'ga4' };

/** トークン応答の scope（空白区切り）に、指定のスコープが含まれるか */
export function hasScope(grantedScope, scope) {
  return String(grantedScope || '').split(/\s+/).includes(scope);
}
