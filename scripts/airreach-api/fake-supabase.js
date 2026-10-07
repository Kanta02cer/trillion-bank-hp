/**
 * 画面テスト専用の「偽の Supabase」。本番では読み込まない（ページには含めない）。
 * 手元で配信した /airreach/app/ に差し込み、window.AirReachSupabaseFactory として使う。
 * 行の制限（RLS）は本物の DB 側で scripts/airreach-api/phase2-rls-test.sql が検証する。ここでは簡易に真似るだけ。
 */
(function () {
  'use strict';
  var KEY = 'airreach_fake_db_v1';
  var STAFF = { 'staff@tb.test': 'staff', 'admin@tb.test': 'admin' };
  function uuid() { return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); }); }
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
  function save(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  var db = load() || { clients: [], client_members: [], client_sites: [], measurement_runs: [], traffic_snapshots: [], action_items: [], reports: [], staff_members: [], scans: [] };
  function email() { return (sessionStorage.getItem('fake_email') || '').toLowerCase(); }
  function isStaff() { return !!STAFF[email()]; }
  function isMember(cid) { return db.client_members.some(function (m) { return m.client_id === cid && m.email === email(); }); }
  function visible(table, row) {
    if (isStaff()) return true;
    if (table === 'clients') return isMember(row.id);
    if (table === 'client_members') return row.email === email();
    if (table === 'reports') return row.status === 'published' && isMember(row.client_id);
    if (table === 'google_data_deletions' || table === 'studio_workspaces') return false; // 社内だけ
    if (row.client_id) return isMember(row.client_id);
    return false;
  }
  var listeners = [];

  function Query(table) { this.t = table; this.filters = []; this.op = 'select'; this.ord = null; this.one = null; this.embed = null; this.retSelect = false; }
  Query.prototype.select = function (cols) { if (this.op !== 'select') this.retSelect = true; var m = /(\w+)\(([\w,]+)\)/.exec(cols || ''); if (m) this.embed = m; return this; };
  Query.prototype.eq = function (k, v) { this.filters.push([k, v]); return this; };
  Query.prototype.in = function (k, vs) { this.filters.push([k, vs, 'in']); return this; };
  Query.prototype.order = function (k, o) { this.ord = [k, !(o && o.ascending === false)]; return this; };
  Query.prototype.limit = function () { return this; };
  Query.prototype.maybeSingle = function () { this.one = 'maybe'; return this; };
  Query.prototype.single = function () { this.one = 'single'; return this; };
  Query.prototype.insert = function (row) { this.op = 'insert'; this.row = row; return this; };
  Query.prototype.update = function (row) { this.op = 'update'; this.row = row; return this; };
  Query.prototype.upsert = function (row, o) { this.op = 'upsert'; this.row = row; this.conflict = (o && o.onConflict || 'id').split(','); return this; };
  Query.prototype.delete = function () { this.op = 'delete'; return this; };
  Query.prototype.match = function (r) { return this.filters.every(function (f) { return f[2] === 'in' ? f[1].map(String).indexOf(String(r[f[0]])) >= 0 : String(r[f[0]]) === String(f[1]); }); };
  Query.prototype.then = function (res, rej) {
    var self = this, t = db[this.t] || (db[this.t] = []), out = null, err = null;
    try {
      if (this.op !== 'select' && !isStaff()) throw new Error('new row violates row-level security policy');
      if (this.op === 'select') {
        out = t.filter(function (r) { return visible(self.t, r) && self.match(r); });
        if (this.ord) { var k = this.ord[0], asc = this.ord[1]; out.sort(function (a, b) { return (String(a[k]) < String(b[k]) ? -1 : 1) * (asc ? 1 : -1); }); }
        if (this.embed) out = out.map(function (r) { var c = db.clients.filter(function (x) { return x.id === r.client_id; })[0]; var o = Object.assign({}, r); o[self.embed[1]] = c ? self.embed[2].split(',').reduce(function (acc, k) { acc[k] = c[k]; return acc; }, {}) : null; return o; });
      } else if (this.op === 'insert') {
        var tbl = this.t;
        out = (Array.isArray(this.row) ? this.row : [this.row]).map(function (r) {
          var row = Object.assign({ id: uuid(), created_at: new Date().toISOString(), status: tbl === 'reports' ? 'draft' : (tbl === 'action_items' ? 'done' : (tbl === 'clients' ? 'active' : undefined)) }, r);
          t.push(row); return row;
        });
      } else if (this.op === 'update') {
        out = t.filter(function (r) { return self.match(r); }); out.forEach(function (r) { Object.assign(r, self.row, { updated_at: new Date().toISOString() }); });
      } else if (this.op === 'upsert') {
        var ex = t.filter(function (r) { return self.conflict.every(function (k) { return String(r[k]) === String(self.row[k]); }); })[0];
        if (ex) { Object.assign(ex, this.row); out = [ex]; } else { var nr = Object.assign({ id: uuid(), created_at: new Date().toISOString(), conclusions: [], next_actions: [], client_decisions: [] }, this.row); t.push(nr); out = [nr]; }
      } else if (this.op === 'delete') {
        db[this.t] = t.filter(function (r) { return !self.match(r); }); out = [];
      }
      save(db);
      if (this.one) {
        if (this.one === 'single' && (!out || out.length !== 1)) throw new Error('single row expected');
        out = out && out.length ? out[0] : null;
      }
    } catch (e) { err = { message: e.message }; }
    return Promise.resolve({ data: err ? null : out, error: err }).then(res, rej);
  };

  window.AirReachFakeDb = { get: function () { return db; }, reset: function () { localStorage.removeItem(KEY); db = load() || { clients: [], client_members: [], client_sites: [], measurement_runs: [], traffic_snapshots: [], action_items: [], reports: [], staff_members: [], scans: [] }; }, seedScans: function (rows) { db.scans = rows; save(db); } };
  window.AirReachSupabaseFactory = function () {
    return {
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: email() ? { user: { email: email() }, access_token: 'fake-access-token-' + email().replace(/[^a-z0-9]/g, '') } : null } }); },
        onAuthStateChange: function (cb) { listeners.push(cb); return { data: { subscription: { unsubscribe: function () {} } } }; },
        signInWithOtp: function (o) { sessionStorage.setItem('fake_email', o.email); window.__fakeOtp = o; setTimeout(function () { listeners.forEach(function (cb) { cb('SIGNED_IN'); }); }, 300); return Promise.resolve({ error: null }); },
        signOut: function () { sessionStorage.removeItem('fake_email'); return Promise.resolve({ error: null }); }
      },
      from: function (t) { return new Query(t); },
      rpc: function (name, args) {
        if (name === 'airreach_me') return Promise.resolve({ data: { email: email(), is_staff: isStaff(), is_admin: STAFF[email()] === 'admin', client_ids: db.client_members.filter(function (m) { return m.email === email(); }).map(function (m) { return m.client_id; }) }, error: null });
        if (name === 'airreach_client_scans') {
          if (!(isStaff() || isMember(args.p_client_id))) return Promise.resolve({ data: null, error: { message: 'forbidden' } });
          var hosts = db.client_sites.filter(function (s) { return s.client_id === args.p_client_id; }).map(function (s) { return s.host; });
          return Promise.resolve({ data: (db.scans || []).filter(function (s) { return hosts.indexOf(String(s.host).replace(/^www\./, '')) >= 0; }), error: null });
        }
        // 削除依頼（supabase/migrations/20261007150000 の airreach_delete_google_data を簡易に真似る）
        if (name === 'airreach_delete_google_data') {
          if (STAFF[email()] !== 'admin') return Promise.resolve({ data: null, error: { message: 'forbidden' } });
          var c = db.clients.filter(function (x) { return x.id === args.p_client_id; })[0];
          if (!c) return Promise.resolve({ data: null, error: { message: 'client not found' } });
          if (String(args.p_confirm_name || '').trim() !== String(c.name).trim()) return Promise.resolve({ data: null, error: { message: 'confirm name mismatch' } });
          var counts = {};
          ['traffic_snapshots', 'studio_workspaces', 'measurement_runs'].forEach(function (t) {
            var before = (db[t] || []).length; db[t] = (db[t] || []).filter(function (r) { return r.client_id !== c.id; }); counts[t] = before - db[t].length;
          });
          c.google_purged_at = new Date().toISOString();
          (db.google_data_deletions = db.google_data_deletions || []).push({ client_id: c.id, client_name: c.name, reason: 'user_request', request_note: args.p_note || null, executed_by: email(), executed_at: c.google_purged_at, counts: counts });
          save(db);
          return Promise.resolve({ data: { ok: true, counts: counts }, error: null });
        }
        // 競合・キーワード・質問の依頼（migration 20261007120000 を簡易に真似る。本物の検証は client-requests-test.sql）
        if (/^airreach_(client_settings|request_create|request_cancel|request_decide)$/.test(name)) {
          var reqs = db.client_requests = db.client_requests || [], wss = db.studio_workspaces = db.studio_workspaces || [];
          var ok = function (d) { save(db); return Promise.resolve({ data: d, error: null }); }, ng = function (m) { return Promise.resolve({ data: null, error: { message: m } }); };
          var wsOf = function (cid) { return wss.filter(function (w) { return w.client_id === cid; })[0]; };
          var keyR = function (p) { return String(p.name || p.text || '').trim().toLowerCase(); };
          if (name === 'airreach_client_settings') {
            if (!(isStaff() || isMember(args.p_client_id))) return ng('forbidden');
            var st0 = ((wsOf(args.p_client_id) || {}).data || {}).studio || {};
            return ok({ competitors: (st0.competitors || []).map(function (c) { return { name: c.name || c.url, url: c.url || null }; }),
              keywords: (st0.keywords || []).slice(0, 50).map(function (k) { return { text: k.text, priority: k.priority || null, customer: k.src === 'customer' }; }),
              prompts: (st0.prompts || []).map(function (p) { return { text: p.text, on: p.on !== false }; }) });
          }
          if (name === 'airreach_request_create') {
            if (!(isStaff() || isMember(args.p_client_id))) return ng('forbidden');
            var pl = args.p_kind === 'competitor' ? { name: String(args.p_payload.name || '').trim(), url: String(args.p_payload.url || '').trim() || null } : { text: String(args.p_payload.text || '').trim() };
            if (!keyR(pl)) return ng('名前・言葉を入れてください');
            if (pl.url && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(pl.url)) return ng('サイトの URL は https:// から入れてください');
            var pend = reqs.filter(function (r) { return r.client_id === args.p_client_id && r.status === 'pending'; });
            if (pend.length >= 30) return ok({ ok: false, reason: '確認待ちの依頼が30件あります。担当者の確認をお待ちください' });
            if (pend.some(function (r) { return r.kind === args.p_kind && r.action === args.p_action && keyR(r.payload) === keyR(pl); })) return ok({ ok: false, reason: '同じ内容の依頼が確認待ちです' });
            var nr = { id: uuid(), client_id: args.p_client_id, kind: args.p_kind, action: args.p_action, payload: pl, status: 'pending', requested_by: email(), requested_at: new Date().toISOString() };
            reqs.push(nr); return ok({ ok: true, id: nr.id });
          }
          var rq = reqs.filter(function (r) { return r.id === args.p_id; })[0];
          if (!rq) return ng('not found');
          if (name === 'airreach_request_cancel') {
            if (!(isStaff() || (isMember(rq.client_id) && rq.requested_by === email()))) return ng('forbidden');
            if (rq.status !== 'pending') return ok({ ok: false, reason: 'もう確認が済んでいます' });
            rq.status = 'cancelled'; rq.decided_by = email(); rq.decided_at = new Date().toISOString(); return ok({ ok: true });
          }
          if (!isStaff()) return ng('forbidden');
          if (rq.status !== 'pending') return ok({ ok: false, reason: 'もう確認が済んでいます' });
          rq.decided_by = email(); rq.decided_at = new Date().toISOString();
          if (!args.p_approve) { rq.status = 'rejected'; rq.decision_note = args.p_note || null; return ok({ ok: true, status: 'rejected' }); }
          var w = wsOf(rq.client_id); if (!w) { w = { client_id: rq.client_id, data: { studio: {} }, version: 0 }; wss.push(w); }
          var stt = w.data.studio = w.data.studio || {}, k0 = rq.kind === 'competitor' ? 'competitors' : rq.kind + 's', arr = stt[k0] = stt[k0] || [], key = keyR(rq.payload), applied;
          var has = arr.some(function (x) { return keyR(x) === key; });
          if (rq.action === 'remove') { stt[k0] = arr.filter(function (x) { return keyR(x) !== key; }); applied = { competitor: '競合から外しました', keyword: 'キーワードから外しました', prompt: '質問から外しました' }[rq.kind]; }
          else if (has) applied = 'すでに登録されていました';
          else if (rq.kind === 'competitor') { arr.push({ name: rq.payload.name, url: rq.payload.url || undefined, src: STAFF[rq.requested_by] ? 'staff' : 'customer' }); applied = '競合に追加しました'; }
          else if (rq.kind === 'keyword') { arr.push({ id: 'cust' + uuid().slice(0, 8), text: rq.payload.text, priority: 'P1', cluster: 'Customer', status: '未対策', src: STAFF[rq.requested_by] ? 'staff' : 'customer' }); applied = 'キーワードに追加しました'; }
          else { var on = arr.filter(function (p) { return p.on !== false; }).length < 10; arr.push({ id: 'cust' + uuid().slice(0, 8), text: rq.payload.text, on: on, src: STAFF[rq.requested_by] ? 'staff' : 'customer' }); applied = on ? '毎月測る質問に追加しました' : '毎月測る質問が10問あるため、候補に追加しました'; }
          w.version += 1; rq.status = 'approved'; rq.decision_note = applied;
          return ok({ ok: true, status: 'approved', applied: applied });
        }
        return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
      }
    };
  };
})();
