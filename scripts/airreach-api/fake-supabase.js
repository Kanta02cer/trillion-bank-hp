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
    if (row.client_id) return isMember(row.client_id);
    return false;
  }
  var listeners = [];

  function Query(table) { this.t = table; this.filters = []; this.op = 'select'; this.ord = null; this.one = null; this.embed = null; this.retSelect = false; }
  Query.prototype.select = function (cols) { if (this.op !== 'select') this.retSelect = true; var m = /(\w+)\((\w+)\)/.exec(cols || ''); if (m) this.embed = m; return this; };
  Query.prototype.eq = function (k, v) { this.filters.push([k, v]); return this; };
  Query.prototype.order = function (k, o) { this.ord = [k, !(o && o.ascending === false)]; return this; };
  Query.prototype.limit = function () { return this; };
  Query.prototype.maybeSingle = function () { this.one = 'maybe'; return this; };
  Query.prototype.single = function () { this.one = 'single'; return this; };
  Query.prototype.insert = function (row) { this.op = 'insert'; this.row = row; return this; };
  Query.prototype.update = function (row) { this.op = 'update'; this.row = row; return this; };
  Query.prototype.upsert = function (row, o) { this.op = 'upsert'; this.row = row; this.conflict = (o && o.onConflict || 'id').split(','); return this; };
  Query.prototype.delete = function () { this.op = 'delete'; return this; };
  Query.prototype.match = function (r) { return this.filters.every(function (f) { return String(r[f[0]]) === String(f[1]); }); };
  Query.prototype.then = function (res, rej) {
    var self = this, t = db[this.t] || (db[this.t] = []), out = null, err = null;
    try {
      if (this.op !== 'select' && !isStaff()) throw new Error('new row violates row-level security policy');
      if (this.op === 'select') {
        out = t.filter(function (r) { return visible(self.t, r) && self.match(r); });
        if (this.ord) { var k = this.ord[0], asc = this.ord[1]; out.sort(function (a, b) { return (String(a[k]) < String(b[k]) ? -1 : 1) * (asc ? 1 : -1); }); }
        if (this.embed) out = out.map(function (r) { var c = db.clients.filter(function (x) { return x.id === r.client_id; })[0]; var o = Object.assign({}, r); o[self.embed[1]] = c ? { name: c.name } : null; return o; });
      } else if (this.op === 'insert') {
        var row = Object.assign({ id: uuid(), created_at: new Date().toISOString(), status: this.t === 'reports' ? 'draft' : (this.t === 'action_items' ? 'done' : (this.t === 'clients' ? 'active' : undefined)) }, this.row);
        t.push(row); out = [row];
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
        getSession: function () { return Promise.resolve({ data: { session: email() ? { user: { email: email() } } : null } }); },
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
        return Promise.resolve({ data: null, error: { message: 'unknown rpc' } });
      }
    };
  };
})();
