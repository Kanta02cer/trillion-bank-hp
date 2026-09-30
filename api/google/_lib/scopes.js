/**
 * Google OAuth で要求するスコープ。いまは Search Console（GSC）だけを本番で使う。
 *
 * GA4 を再開するとき（別PR）: OAUTH_SCOPES に GA4_SCOPE を足す。ga4.js と Studio の GA4 同期は
 * isGa4Enabled() を見て自動で有効になる。既に接続済みの人は再接続（同意のやり直し）が必要。
 */
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export const OAUTH_SCOPES = [GSC_SCOPE];

export function isGa4Enabled() {
  return OAUTH_SCOPES.includes(GA4_SCOPE);
}

/** トークン応答の scope（空白区切り）に、指定のスコープが含まれるか */
export function hasScope(grantedScope, scope) {
  return String(grantedScope || '').split(/\s+/).includes(scope);
}
