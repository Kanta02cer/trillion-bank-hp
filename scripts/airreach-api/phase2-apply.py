#!/usr/bin/env python3
"""
AirReach Phase 2（ログイン・顧客管理・月次レポート）を本番の AirReach Project に反映する手順を、1つずつ実行する。
Change ID（DEV-YYYY-NNN）の承認後にだけ使う。各手順は単独で実行でき、同じ手順を2回実行しても壊れない。

  python3 scripts/airreach-api/phase2-apply.py check                  # 読むだけ。現状を表示
  python3 scripts/airreach-api/phase2-apply.py apply-db                # migration を適用して検証
  python3 scripts/airreach-api/phase2-apply.py verify                  # 検証だけ
  python3 scripts/airreach-api/phase2-apply.py add-staff <email> admin|staff
  python3 scripts/airreach-api/phase2-apply.py auth-config             # ログインの戻り先・日本語メール（SMTP は smtp.json があれば）
  python3 scripts/airreach-api/phase2-apply.py auth-hook               # 登録済みのメールだけがアカウントを作れるフックを有効化
  python3 scripts/airreach-api/phase2-apply.py anon-key-to-vercel      # 公開用キーを Vercel 本番の SUPABASE_ANON_KEY に登録
  python3 scripts/airreach-api/phase2-apply.py apply-report-2026-10      # 10月の追加: レポートの根拠＋承認フロー（2本）を適用して検証
  python3 scripts/airreach-api/phase2-apply.py set-approver <email> on|off  # 月次レポートの承認者を設定（apply-report-2026-10 の後）
  python3 scripts/airreach-api/phase2-apply.py apply-studio-workspaces   # Studio の作業の共有（studio_workspaces）を適用して検証

Supabase のアクセストークン（Account → Access Tokens で発行・期限つき推奨）は、
~/.config/airreach/supabase_token（chmod 600）に置く。画面にもログにも出さない。
トークンは全 Project に効くため、このスクリプトは AirReach 以外の Project を拒否する。
"""
import json
import os
import stat
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

REF = 'opjjxbdrgfyoydyrmzns'          # AirReach（Tokyo）
FORBIDDEN = {'inlnrdjdfccnhmskpyrs'}  # Hack2 Project。絶対に触らない
API = 'https://api.supabase.com/v1'
ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = [
    ('airreach_phase2_auth_reports', ROOT / 'supabase/migrations/20260930120000_airreach_phase2_auth_reports.sql'),
    ('airreach_phase2_signup_guard', ROOT / 'supabase/migrations/20260930130000_airreach_phase2_signup_guard.sql'),
]
# 2026-10 の追加（レポートの根拠を返す・承認フロー）。どちらも Phase 2 の後に適用する
MIGRATIONS_2026_10 = [
    ('airreach_report_evidence', ROOT / 'supabase/migrations/20261002120000_airreach_report_evidence.sql'),
    ('airreach_report_approval', ROOT / 'supabase/migrations/20261002130000_airreach_report_approval.sql'),
]
HOOK_URI = 'pg-functions://postgres/public/airreach_before_user_created'
CONF_DIR = Path.home() / '.config/airreach'
SITE_URL = 'https://trillion-bank.jp'
REDIRECT = 'https://trillion-bank.jp/airreach/app/'
VERCEL = ['npx', '--yes', 'vercel@latest']
VERCEL_SCOPE = ['--scope', 'kinouecertify-gmailcoms-projects', '--project', 'trillion-bank-hp']
PHASE2_TABLES = ['action_items', 'client_members', 'client_sites', 'clients', 'measurement_runs',
                 'reports', 'staff_members', 'traffic_snapshots']


def die(msg):
    print('中止: ' + msg, file=sys.stderr)
    sys.exit(1)


def private_file(name):
    p = CONF_DIR / name
    if not p.exists():
        return None
    if p.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        die(f'{p} は本人以外も読める権限です。chmod 600 してください')
    return p


def token():
    p = private_file('supabase_token')
    if not p:
        die('~/.config/airreach/supabase_token がありません')
    t = p.read_text().strip()
    if not t.startswith('sbp_'):
        die('トークンの形式が違います（sbp_ で始まる Personal Access Token を置いてください）')
    return t


def call(method, path, body=None):
    if REF in FORBIDDEN:
        die('対象が Hack2 Project です')
    req = urllib.request.Request(API + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json',
                                          'User-Agent': 'airreach-phase2-apply'})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        die(f'{method} {path} → HTTP {e.code}: {e.read().decode(errors="replace")[:500]}')


def sql(query, read_only=False):
    body = {'query': query}
    if read_only:
        body['read_only'] = True
    return call('POST', f'/projects/{REF}/database/query', body)


def confirm_project():
    p = call('GET', f'/projects/{REF}')
    if p.get('id', p.get('ref')) != REF or p.get('name') != 'AirReach':
        die(f'Project が想定と違います（{p.get("name")} / {p.get("id")}）')
    print(f'対象: {p["name"]} / {REF} / {p.get("region")} / {p.get("status")}')


def tables():
    rows = sql("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1", True)
    return [r['relname'] for r in rows]


def vercel_has_anon_key():
    r = subprocess.run(VERCEL + ['env', 'ls', 'production'] + VERCEL_SCOPE, capture_output=True, text=True, cwd=ROOT)
    return 'SUPABASE_ANON_KEY' in r.stdout


def cmd_check():
    confirm_project()
    t = tables()
    print('Phase 1 テーブル:', ', '.join(x for x in t if x not in PHASE2_TABLES))
    have = [x for x in PHASE2_TABLES if x in t]
    print(f'Phase 2 テーブル: {len(have)}/{len(PHASE2_TABLES)}', ', '.join(have))
    mig = sql('select version, name from supabase_migrations.schema_migrations order by version', True)
    print('migration 履歴:', ', '.join(f'{m["version"]} {m["name"]}' for m in mig))
    if 'staff_members' in t:
        print('社内メンバー:', sql('select role, count(*)::int as n from public.staff_members group by role', True))
    a = call('GET', f'/projects/{REF}/config/auth')
    print('Auth: site_url =', a.get('site_url'))
    print('Auth: 戻り先の許可 =', a.get('uri_allow_list'))
    print('Auth: メールログイン =', a.get('external_email_enabled'), '/ 新規登録の停止 =', a.get('disable_signup'))
    print('Auth: 独自 SMTP =', ('あり（' + str(a.get('smtp_host')) + '）') if a.get('smtp_host') else 'なし（標準：チームのメンバー宛てにしか届かない）')
    print('Auth: メール件名 =', a.get('mailer_subjects_magic_link'), '/', a.get('mailer_subjects_confirmation'))
    print('Auth: 登録制限フック =', a.get('hook_before_user_created_enabled'), a.get('hook_before_user_created_uri'))
    print('Vercel 本番 SUPABASE_ANON_KEY:', 'あり' if vercel_has_anon_key() else 'なし')


def cmd_apply_db():
    confirm_project()
    t = tables()
    for need in ('sites', 'scans', 'rule_versions'):
        if need not in t:
            die(f'Phase 1 の {need} がありません')
    for name, path in MIGRATIONS:
        call('POST', f'/projects/{REF}/database/migrations', {'name': name, 'query': path.read_text()})
        print('migration を適用しました:', name)
    verify()


P2 = "array['action_items','client_members','client_sites','clients','measurement_runs','reports','staff_members','traffic_snapshots']"
P1 = "array['rule_versions','sites','scans','scan_factor_scores','scan_checks','scan_evidence_sources']"


def verify():
    checks = [
        ('Phase 2 の8テーブルがあり RLS が有効',
         f"select count(*)::int as n from pg_class where relnamespace='public'::regnamespace and relkind='r' and relrowsecurity and relname = any({P2})",
         lambda r: r[0]['n'] == 8),
        ('anon は Phase 2 のテーブルに権限なし',
         f"select count(*)::int as n from information_schema.role_table_grants where table_schema='public' and grantee='anon' and table_name = any({P2})",
         lambda r: r[0]['n'] == 0),
        ('authenticated は Phase 1 のテーブルに権限なし（診断データは RPC 経由だけ）',
         f"select count(*)::int as n from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and table_name = any({P1})",
         lambda r: r[0]['n'] == 0),
        ('anon は airreach_me / airreach_client_scans を実行できない',
         "select has_function_privilege('anon','public.airreach_me()','execute') as a, "
         "has_function_privilege('anon','public.airreach_client_scans(uuid,integer)','execute') as b",
         lambda r: r[0]['a'] is False and r[0]['b'] is False),
        ('登録制限のフック関数は Auth だけが実行できる',
         "select has_function_privilege('anon','public.airreach_before_user_created(jsonb)','execute') as a, "
         "has_function_privilege('authenticated','public.airreach_before_user_created(jsonb)','execute') as b, "
         "has_function_privilege('supabase_auth_admin','public.airreach_before_user_created(jsonb)','execute') as c",
         lambda r: r[0]['a'] is False and r[0]['b'] is False and r[0]['c'] is True),
        ('SECURITY DEFINER の関数は search_path 固定',
         "select count(*)::int as n from pg_proc where pronamespace='public'::regnamespace and proname like 'airreach_%' "
         "and prosecdef and (proconfig is null or not exists (select 1 from unnest(proconfig) c where c like 'search_path=%'))",
         lambda r: r[0]['n'] == 0),
    ]
    bad = 0
    for name, q, ok in checks:
        r = sql(q, True)
        good = ok(r)
        bad += 0 if good else 1
        print(('OK  ' if good else 'NG  ') + name + ('' if good else f'  → {r}'))
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/ の SQL で戻すか判断してください')


def cmd_add_staff(email, role):
    email = email.strip().lower()
    if role not in ('admin', 'staff') or '@' not in email or "'" in email:
        die('使い方: add-staff <email> admin|staff')
    confirm_project()
    sql(f"insert into public.staff_members(email, role) values ('{email}', '{role}') "
        f"on conflict (email) do update set role = excluded.role")
    print('社内メンバー:', sql('select email, role from public.staff_members order by email', True))


def cmd_apply_report_2026_10():
    confirm_project()
    if 'reports' not in tables():
        die('Phase 2 の reports がありません。先に apply-db を実行してください')
    for name, path in MIGRATIONS_2026_10:
        call('POST', f'/projects/{REF}/database/migrations', {'name': name, 'query': path.read_text()})
        print('migration を適用しました:', name)
    checks = [
        ('airreach_client_scans が根拠（checks・scope）を返す',
         "select (position('''checks''' in pg_get_functiondef('public.airreach_client_scans(uuid,integer)'::regprocedure)) > 0 and position('''scope''' in pg_get_functiondef('public.airreach_client_scans(uuid,integer)'::regprocedure)) > 0) as ok"),
        ('reports に承認のトリガがある', "select exists(select 1 from pg_trigger where tgname = 'reports_guard' and not tgisinternal) as ok"),
        ('reports の状態に確認待ち・承認済みがある', "select position('in_review' in pg_get_constraintdef(oid)) > 0 as ok from pg_constraint where conname = 'reports_status_check'"),
        ('report_events は RLS 有効・anon に権限なし', "select (select relrowsecurity from pg_class where oid = 'public.report_events'::regclass) and not exists(select 1 from information_schema.role_table_grants where table_name = 'report_events' and grantee = 'anon') as ok"),
        ('airreach_me が can_approve を返す', "select position('can_approve' in pg_get_functiondef('public.airreach_me()'::regprocedure)) > 0 as ok"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/ の SQL で戻すか判断してください')
    print('承認者はまだいません。set-approver <email> on で設定してください')


def cmd_apply_studio_workspaces():
    confirm_project()
    if 'clients' not in tables():
        die('Phase 2 の clients がありません。先に apply-db を実行してください')
    path = ROOT / 'supabase/migrations/20261003120000_airreach_studio_workspaces.sql'
    call('POST', f'/projects/{REF}/database/migrations', {'name': 'airreach_studio_workspaces', 'query': path.read_text()})
    print('migration を適用しました: airreach_studio_workspaces')
    checks = [
        ('studio_workspaces があり RLS が有効', "select relrowsecurity as ok from pg_class where oid = 'public.studio_workspaces'::regclass"),
        ('anon は studio_workspaces に権限なし', "select not exists(select 1 from information_schema.role_table_grants where table_name = 'studio_workspaces' and grantee = 'anon') as ok"),
        ('authenticated は読むだけ（書き込みは関数だけ）', "select not exists(select 1 from information_schema.role_table_grants where table_name = 'studio_workspaces' and grantee = 'authenticated' and privilege_type <> 'SELECT') as ok"),
        ('保存の関数は search_path 固定・SECURITY DEFINER', "select prosecdef and proconfig is not null as ok from pg_proc where proname = 'airreach_studio_save'"),
        ('anon は保存の関数を実行できない', "select not has_function_privilege('anon', 'public.airreach_studio_save(uuid,jsonb,integer)', 'EXECUTE') as ok"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/ の SQL で戻すか判断してください')


def cmd_set_approver(email, flag):
    email = email.strip().lower()
    if flag not in ('on', 'off') or '@' not in email or "'" in email:
        die('使い方: set-approver <email> on|off')
    confirm_project()
    r = sql(f"update public.staff_members set can_approve = {'true' if flag == 'on' else 'false'} where email = '{email}' returning email")
    if not r:
        die(f'{email} は社内メンバーに登録されていません。先に add-staff で登録してください')
    print('承認者:', sql('select email, role, can_approve from public.staff_members where can_approve order by email', True))


MAIL_BODY = '''<h2>AirReach ログイン</h2>
<p>下のリンクを押すと AirReach にログインします。このメールに心当たりがない場合は、何もせずに削除してください。</p>
<p><a href="{{ .ConfirmationURL }}">ログインする</a></p>
<p>リンクの有効期限は1時間です。<br>株式会社Trillion Bank</p>'''


def cmd_auth_config():
    confirm_project()
    cur = call('GET', f'/projects/{REF}/config/auth')
    CONF_DIR.mkdir(parents=True, exist_ok=True)
    backup = CONF_DIR / f'auth-config-backup-{datetime.now():%Y%m%d-%H%M%S}.json'
    safe = {k: v for k, v in cur.items() if not any(s in k for s in ('secret', 'pass', 'key', 'token'))}
    backup.write_text(json.dumps(safe, ensure_ascii=False, indent=2))
    os.chmod(backup, 0o600)
    print('変更前の設定（秘密の項目を除く）を保存:', backup)
    allow = [u for u in (cur.get('uri_allow_list') or '').split(',') if u]
    if REDIRECT not in allow:
        allow.append(REDIRECT)
    patch = {
        'site_url': cur.get('site_url') if str(cur.get('site_url') or '').startswith(SITE_URL) else SITE_URL,
        'uri_allow_list': ','.join(allow),
        'external_email_enabled': True,
        'mailer_otp_exp': 3600,
    }
    # 無料プランで標準のメール送信を使っている間は、文面を変えると 400 で断られる（2026-09-30 実測）。
    # 文面は独自 SMTP を設定するときにだけ変える。
    templates = {
        'mailer_subjects_magic_link': 'AirReach ログイン用リンク',
        'mailer_templates_magic_link_content': MAIL_BODY,
        # 初めてログインする人には「確認」メールが送られるので、同じ文面にそろえる
        'mailer_subjects_confirmation': 'AirReach ログイン用リンク',
        'mailer_templates_confirmation_content': MAIL_BODY,
    }
    smtp = private_file('smtp.json')
    if smtp:
        patch.update(templates)
        s = json.loads(smtp.read_text())
        need = ('smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_admin_email', 'smtp_sender_name')
        missing = [k for k in need if not s.get(k)]
        if missing:
            die('smtp.json に足りない項目: ' + ', '.join(missing))
        patch.update({k: str(s[k]) for k in need})
        patch['rate_limit_email_sent'] = int(s.get('rate_limit_email_sent', 30))
        print('SMTP も設定します:', s['smtp_host'], '/ 送信元', s['smtp_admin_email'])
    else:
        print('smtp.json が無いので SMTP とメール文面は変えません（標準のままだとチームのメンバー宛てにしか届かず、文面は英語）')
    call('PATCH', f'/projects/{REF}/config/auth', patch)
    after = call('GET', f'/projects/{REF}/config/auth')
    for k in ('site_url', 'uri_allow_list', 'external_email_enabled', 'mailer_subjects_magic_link', 'smtp_host'):
        print(f'  {k} = {after.get(k)}')


def cmd_auth_hook():
    confirm_project()
    if not sql("select 1 as x from pg_proc where proname = 'airreach_before_user_created'", True):
        die('フック関数がありません。先に apply-db を実行してください')
    if not sql('select count(*)::int as n from public.staff_members', True)[0]['n']:
        die('社内メンバーが0人です。先に add-staff で最初の管理者を登録してください（誰もログインできなくなるため）')
    call('PATCH', f'/projects/{REF}/config/auth', {'hook_before_user_created_enabled': True, 'hook_before_user_created_uri': HOOK_URI})
    a = call('GET', f'/projects/{REF}/config/auth')
    print('Before User Created フック:', a.get('hook_before_user_created_enabled'), a.get('hook_before_user_created_uri'))


def cmd_anon_key_to_vercel():
    confirm_project()
    keys = call('GET', f'/projects/{REF}/api-keys?reveal=true') or []
    pub = next((k for k in keys if k.get('type') == 'publishable'), None) or next((k for k in keys if k.get('name') == 'anon'), None)
    if not pub or not pub.get('api_key'):
        die('公開用キー（publishable / anon）が見つかりません')
    value = pub['api_key']
    if pub.get('name') == 'service_role' or value.startswith('sb_secret_'):
        die('秘密キーを拾いかけたので中止しました')
    print('登録するキーの種類:', pub.get('type') or pub.get('name'), '（値は表示しません）')
    if vercel_has_anon_key():
        die('Vercel 本番に SUPABASE_ANON_KEY が既にあります')
    r = subprocess.run(VERCEL + ['env', 'add', 'SUPABASE_ANON_KEY', 'production'] + VERCEL_SCOPE,
                       input=value, capture_output=True, text=True, cwd=ROOT)
    if r.returncode != 0:
        die('Vercel への登録に失敗: ' + (r.stderr or r.stdout).replace(value, '***')[-400:])
    print('Vercel 本番に SUPABASE_ANON_KEY を登録しました。反映には本番の再デプロイが必要です')


def main():
    a = sys.argv[1:]
    cmds = {'check': cmd_check, 'apply-db': cmd_apply_db, 'auth-config': cmd_auth_config, 'auth-hook': cmd_auth_hook,
            'anon-key-to-vercel': cmd_anon_key_to_vercel, 'apply-report-2026-10': cmd_apply_report_2026_10, 'apply-studio-workspaces': cmd_apply_studio_workspaces, 'verify': lambda: (confirm_project(), verify())}
    if a and a[0] in cmds and len(a) == 1:
        cmds[a[0]]()
    elif a and a[0] == 'add-staff' and len(a) == 3:
        cmd_add_staff(a[1], a[2])
    elif a and a[0] == 'set-approver' and len(a) == 3:
        cmd_set_approver(a[1], a[2])
    else:
        print(__doc__)
        sys.exit(0 if not a else 2)


if __name__ == '__main__':
    main()
