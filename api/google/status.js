import { setCors, getAccessToken, bearerFromReq, parseCookies } from './_lib.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
  const token = await getAccessToken(req);
  const cookies = parseCookies(req.headers.cookie || '');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    connected: !!token,
    via: bearerFromReq(req) ? 'bearer' : (cookies.airreach_google_access ? 'cookie' : (token ? 'refresh' : null)),
    defaults: {
      gscSiteUrl: process.env.GOOGLE_GSC_SITE_URL || 'https://trillion-bank.jp/',
      ga4PropertyId: process.env.GOOGLE_GA4_PROPERTY_ID || ''
    }
  }));
}
