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
  python3 scripts/airreach-api/phase2-apply.py apply-schedules           # AI計測の定期実行（measurement_schedules / measurement_jobs）を適用して検証。既定は無効
  python3 scripts/airreach-api/phase2-apply.py apply-client-requests     # お客様からの依頼（競合・キーワード・質問の追加と削除・担当者の承認）を適用して検証
  python3 scripts/airreach-api/phase2-apply.py apply-client-owner-due    # 顧客ごとの担当と報告期限の列（担当者ダッシュボードの絞り込み）を適用して検証
  python3 scripts/airreach-api/phase2-apply.py apply-request-note        # お客様の依頼に付ける「補足」の列と関数を適用して検証
  python3 scripts/airreach-api/phase2-apply.py apply-partner-orgs        # 共同会社（自社の顧客だけ見える人）の仕組みを適用して検証
  python3 scripts/airreach-api/phase2-apply.py apply-client-issues       # 案件の課題（client_issues）の表を適用して検証
  python3 scripts/airreach-api/phase2-apply.py apply-decision-replies    # ご判断へのお客様のお返事（client_requests の decision）を適用して検証
  python3 scripts/airreach-api/phase2-apply.py apply-measure-timing      # 計測の時期の日付だけを返す関数（お客様の「次の計測」）を適用して検証
  python3 scripts/airreach-api/phase2-apply.py apply-measure-timing-publish  # 上の関数に公開の記録と照合の版を足す（10/9）
  python3 scripts/airreach-api/phase2-apply.py apply-save-google-traffic  # お客様が取り込んだ Google の数字をサーバーだけが保存する関数（10/10）
  python3 scripts/airreach-api/phase2-apply.py add-partner-org <会社名>                       # 共同会社を作る
  python3 scripts/airreach-api/phase2-apply.py add-partner-staff <email> <会社名> [approver]   # 共同会社の人を追加（approver で承認者にする）
  python3 scripts/airreach-api/phase2-apply.py assign-client <顧客ID> <会社名|TB>              # 顧客の担当会社を決める（TB＝Trillion Bank に戻す）
  python3 scripts/airreach-api/phase2-apply.py partner-status [会社名]                         # 共同会社・人・割り当て・ログインの状態（読み取りのみ）
  python3 scripts/airreach-api/phase2-apply.py remove-partner-staff <email>                    # 共同会社の人を解除する（社内の人は消さない）

Supabase のアクセストークン（Account → Access Tokens で発行・期限つき推奨）は、
~/.config/airreach/supabase_token（chmod 600）に置く。画面にもログにも出さない。
トークンは全 Project に効くため、このスクリプトは AirReach 以外の Project を拒否する。
"""
import json
import os
import re
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


def cmd_apply_schedules():
    """AI計測の定期実行の表と RPC を入れる（設定は既定で無効。自動実行はさらに Vercel の AIRREACH_SCHEDULE_ENABLED=true が要る）"""
    confirm_project()
    if 'measurement_runs' not in tables():
        die('Phase 2 の measurement_runs がありません。先に apply-db を実行してください')
    # 表と RPC（20261005）と、上限・停止の確かめ方の修正（20261006）を順に入れる
    for name, fn in [('airreach_measurement_schedules', '20261005120000_airreach_measurement_schedules.sql'), ('airreach_schedule_guards', '20261006120000_airreach_schedule_guards.sql')]:
        path = ROOT / 'supabase/migrations' / fn
        call('POST', f'/projects/{REF}/database/migrations', {'name': name, 'query': path.read_text()})
        print('migration を適用しました: ' + name)
    checks = [
        ('measurement_schedules・measurement_jobs があり RLS が有効', "select bool_and(relrowsecurity) as ok from pg_class where oid in ('public.measurement_schedules'::regclass, 'public.measurement_jobs'::regclass)"),
        ('anon は2つの表に権限なし', "select not exists(select 1 from information_schema.role_table_grants where table_name in ('measurement_schedules', 'measurement_jobs') and grantee = 'anon') as ok"),
        ('authenticated は実行の記録を読むだけ', "select not exists(select 1 from information_schema.role_table_grants where table_name = 'measurement_jobs' and grantee = 'authenticated' and privilege_type <> 'SELECT') as ok"),
        ('service_role は表に権限なし（RPC だけ）', "select not exists(select 1 from information_schema.role_table_grants where table_name in ('measurement_schedules', 'measurement_jobs') and grantee = 'service_role') as ok"),
        ('RPC はすべて search_path 固定・SECURITY DEFINER', "select bool_and(prosecdef and proconfig is not null) as ok from pg_proc where proname like 'airreach_schedule%'"),
        ('authenticated は取り出し・記録の RPC を実行できない', "select not has_function_privilege('authenticated', 'public.airreach_schedule_claim(timestamptz,jsonb,integer)', 'EXECUTE') and not has_function_privilege('authenticated', 'public.airreach_schedule_finish(uuid,text,jsonb,integer,integer,integer,numeric,text,timestamptz)', 'EXECUTE') as ok"),
        ('定期実行の設定はまだ0件（既定で何も動かない）', "select count(*) = 0 as ok from public.measurement_schedules where enabled"),
        ('上限の確かめ（20261006）が入っている・直接は呼べない', "select exists(select 1 from pg_proc where proname = 'airreach_schedule_limit_check') and not has_function_privilege('authenticated', 'public.airreach_schedule_limit_check(uuid,timestamptz,jsonb,uuid)', 'EXECUTE') as ok"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/ の SQL で戻すか判断してください')


def cmd_apply_client_requests():
    """お客様からの依頼（競合・キーワード・質問の追加と削除。担当者が承認すると Studio の作業に反映）の表と RPC を入れる"""
    confirm_project()
    if 'studio_workspaces' not in tables():
        die('studio_workspaces がありません。先に apply-studio-workspaces を実行してください')
    path = ROOT / 'supabase/migrations/20261007120000_airreach_client_requests.sql'
    call('POST', f'/projects/{REF}/database/migrations', {'name': 'airreach_client_requests', 'query': path.read_text()})
    print('migration を適用しました: airreach_client_requests')
    checks = [
        ('client_requests があり RLS が有効', "select relrowsecurity as ok from pg_class where oid = 'public.client_requests'::regclass"),
        ('anon・service_role は表に権限なし', "select not exists(select 1 from information_schema.role_table_grants where table_name = 'client_requests' and grantee in ('anon', 'service_role')) as ok"),
        ('authenticated は表を読むだけ（書くのは RPC）', "select not exists(select 1 from information_schema.role_table_grants where table_name = 'client_requests' and grantee = 'authenticated' and privilege_type <> 'SELECT') as ok"),
        ('RPC はすべて search_path 固定・SECURITY DEFINER', "select bool_and(prosecdef and proconfig is not null) as ok from pg_proc where proname in ('airreach_client_settings', 'airreach_request_create', 'airreach_request_cancel', 'airreach_request_decide')"),
        ('anon は RPC を実行できない', "select not has_function_privilege('anon', 'public.airreach_request_create(uuid,text,text,jsonb)', 'EXECUTE') and not has_function_privilege('anon', 'public.airreach_request_decide(uuid,boolean,text)', 'EXECUTE') as ok"),
        ('中身の整形の関数は直接呼べない', "select not has_function_privilege('authenticated', 'public.airreach_request_payload(text,jsonb)', 'EXECUTE') as ok"),
        ('依頼はまだ0件', "select count(*) = 0 as ok from public.client_requests"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/20261007120000_airreach_client_requests_rollback.sql で戻すか判断してください')


def cmd_apply_client_owner_due():
    """顧客ごとの担当（社内）と毎月の報告期限（日）の列を足す（担当者ダッシュボードの顧客一覧・ホームの「期限」）"""
    confirm_project()
    if 'clients' not in tables():
        die('clients がありません。先に apply-db を実行してください')
    path = ROOT / 'supabase/migrations/20261007180000_airreach_client_owner_due.sql'
    call('POST', f'/projects/{REF}/database/migrations', {'name': 'airreach_client_owner_due', 'query': path.read_text()})
    print('migration を適用しました: airreach_client_owner_due')
    checks = [
        ('clients に owner_email・report_due_day がある', "select count(*) = 2 as ok from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name in ('owner_email', 'report_due_day')"),
        ('担当は社内メンバーへの参照（消えたら未設定）', "select exists(select 1 from pg_constraint where conname = 'clients_owner_email_fkey' and confdeltype = 'n') as ok"),
        ('期限は 1〜31 の制約', "select exists(select 1 from pg_constraint where conname = 'clients_report_due_day_check') as ok"),
        ('既存の顧客は未設定のまま（架空の担当・期限を入れていない）', "select count(*) = 0 as ok from public.clients where owner_email is not null or report_due_day is not null"),
        ('clients の RLS は有効のまま', "select relrowsecurity as ok from pg_class where oid = 'public.clients'::regclass"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/20261007180000_airreach_client_owner_due_rollback.sql で戻すか判断してください')


def cmd_apply_client_issues():
    """案件の課題（client_issues）の表と RLS を足す。担当者（社内・共同会社は自社の顧客だけ）が書く。お客様には見せない"""
    confirm_project()
    if 'clients' not in tables() or 'partner_orgs' not in tables():
        die('clients か partner_orgs がありません。先に apply-db・apply-partner-orgs を実行してください')
    path = ROOT / 'supabase/migrations/20261009120000_airreach_client_issues.sql'
    call('POST', f'/projects/{REF}/database/migrations', {'name': 'airreach_client_issues', 'query': path.read_text()})
    print('migration を適用しました: airreach_client_issues')
    checks = [
        ('client_issues がある', "select to_regclass('public.client_issues') is not null as ok"),
        ('RLS が有効', "select relrowsecurity as ok from pg_class where oid = 'public.client_issues'::regclass"),
        ('方針は airreach_can_staff の1つだけ（お客様の方針は無い）', "select count(*) = 1 and bool_and(qual like '%airreach_can_staff%') as ok from pg_policies where schemaname = 'public' and tablename = 'client_issues'"),
        ('anon に権限が無い', "select not has_table_privilege('anon', 'public.client_issues', 'select') as ok"),
        ('書いた人・日時を入れるトリガーがある', "select exists(select 1 from pg_trigger where tgname = 'client_issues_touch' and not tgisinternal) as ok"),
        ('顧客を消すと課題も消える（on delete cascade）', "select exists(select 1 from pg_constraint where conrelid = 'public.client_issues'::regclass and contype = 'f' and confdeltype = 'c') as ok"),
        ('まだ課題は0件（架空の課題を入れていない）', "select count(*) = 0 as ok from public.client_issues"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/20261009120000_airreach_client_issues_rollback.sql で戻すか判断してください')


def cmd_apply_decision_replies():
    """「ご判断いただきたいこと」へのお客様のお返事（client_requests に kind = 'decision'）。担当者は「確認した」を押すだけ"""
    confirm_project()
    if 'client_requests' not in tables() or 'partner_orgs' not in tables():
        die('client_requests か partner_orgs がありません。先に apply-client-requests・apply-partner-orgs を実行してください')
    path = ROOT / 'supabase/migrations/20261009130000_airreach_decision_replies.sql'
    call('POST', f'/projects/{REF}/database/migrations', {'name': 'airreach_decision_replies', 'query': path.read_text()})
    print('migration を適用しました: airreach_decision_replies')
    fn = "'public.airreach_decision_reply(uuid, integer, text, text)'"
    checks = [
        ('返事の関数がある', f"select to_regprocedure({fn}) is not null as ok"),
        ('ログインした人だけが呼べる（anon は呼べない）', f"select has_function_privilege('authenticated', {fn}, 'execute') and not has_function_privilege('anon', {fn}, 'execute') as ok"),
        ('種類に decision・動作に ok / revise が入った', "select bool_and(pg_get_constraintdef(oid) like '%decision%') and count(*) = 2 as ok from pg_constraint where conrelid = 'public.client_requests'::regclass and conname in ('client_requests_kind_check', 'client_requests_kind_action_check')"),
        ('担当者の承認に「ご判断の返事は確認だけ」の分かれ道がある', "select position($k$kind = 'decision'$k$ in pg_get_functiondef('public.airreach_request_decide(uuid, boolean, text)'::regprocedure)) > 0 as ok"),
        ('これまでの依頼はそのまま（decision の行は0件）', "select count(*) = 0 as ok from public.client_requests where kind = 'decision'"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/20261009130000_airreach_decision_replies_rollback.sql で戻すか判断してください')


def cmd_apply_measure_timing():
    """計測の時期を出すための日付だけを返す関数（お客様のホームの「次の計測」に使う・読み取りだけ）"""
    confirm_project()
    if 'studio_workspaces' not in tables() or 'partner_orgs' not in tables():
        die('studio_workspaces か partner_orgs がありません。先に apply-studio-workspaces・apply-partner-orgs を実行してください')
    path = ROOT / 'supabase/migrations/20261009140000_airreach_measure_timing.sql'
    call('POST', f'/projects/{REF}/database/migrations', {'name': 'airreach_measure_timing', 'query': path.read_text()})
    print('migration を適用しました: airreach_measure_timing')
    fn = "'public.airreach_measure_timing(uuid)'"
    checks = [
        ('関数がある', f"select to_regprocedure({fn}) is not null as ok"),
        ('ログインした人だけが呼べる（anon は呼べない）', f"select has_function_privilege('authenticated', {fn}, 'execute') and not has_function_privilege('anon', {fn}, 'execute') as ok"),
        ('読み取りだけ（stable）・security definer', f"select provolatile = 's' and prosecdef as ok from pg_proc where oid = to_regprocedure({fn})"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/20261009140000_airreach_measure_timing_rollback.sql で戻すか判断してください')


def cmd_apply_measure_timing_publish():
    """計測の時期の関数に、公開の記録と照合の版を足す（読み取りだけ・項目を足すだけ）"""
    confirm_project()
    if 'studio_workspaces' not in tables():
        die('studio_workspaces がありません')
    path = ROOT / 'supabase/migrations/20261009150000_airreach_measure_timing_publish.sql'
    call('POST', f'/projects/{REF}/database/migrations', {'name': 'airreach_measure_timing_publish', 'query': path.read_text()})
    print('migration を適用しました: airreach_measure_timing_publish')
    fn = "'public.airreach_measure_timing(uuid)'"
    checks = [
        ('関数が公開と照合の記録（publish_job）を返す', f"select position('publish_job' in pg_get_functiondef(to_regprocedure({fn}))) > 0 as ok"),
        ('ログインした人だけが呼べる（anon は呼べない）', f"select has_function_privilege('authenticated', {fn}, 'execute') and not has_function_privilege('anon', {fn}, 'execute') as ok"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/20261009150000_airreach_measure_timing_publish_rollback.sql で戻すか判断してください')


def cmd_apply_save_google_traffic():
    """お客様が自分で Google とつないで取り込んだ数字を、サーバーだけが保存する関数（service_role だけが呼べる）"""
    confirm_project()
    if 'traffic_snapshots' not in tables() or 'client_sites' not in tables():
        die('traffic_snapshots か client_sites がありません')
    path = ROOT / 'supabase/migrations/20261010120000_airreach_save_google_traffic.sql'
    call('POST', f'/projects/{REF}/database/migrations', {'name': 'airreach_save_google_traffic', 'query': path.read_text()})
    print('migration を適用しました: airreach_save_google_traffic')
    fn = "'public.airreach_save_google_traffic(uuid, date, text, jsonb, text)'"
    checks = [
        ('関数がある', f"select to_regprocedure({fn}) is not null as ok"),
        ('サーバー（service_role）だけが呼べる（ログインした人・anon は呼べない）', f"select has_function_privilege('service_role', {fn}, 'execute') and not has_function_privilege('authenticated', {fn}, 'execute') and not has_function_privilege('anon', {fn}, 'execute') as ok"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/20261010120000_airreach_save_google_traffic_rollback.sql で戻すか判断してください')


def cmd_apply_request_note():
    """お客様の依頼に「補足」（なぜ足したい・外したいか・500文字まで）を付けられるようにする"""
    confirm_project()
    if 'client_requests' not in tables():
        die('client_requests がありません。先に apply-client-requests を実行してください')
    path = ROOT / 'supabase/migrations/20261007190000_airreach_request_note.sql'
    call('POST', f'/projects/{REF}/database/migrations', {'name': 'airreach_request_note', 'query': path.read_text()})
    print('migration を適用しました: airreach_request_note')
    checks = [
        ('client_requests に note がある', "select count(*) = 1 as ok from information_schema.columns where table_schema = 'public' and table_name = 'client_requests' and column_name = 'note'"),
        ('補足は500文字までの制約', "select exists(select 1 from pg_constraint where conname = 'client_requests_note_check') as ok"),
        ('補足つきの依頼の関数がある（ログインした人だけ実行できる）', "select has_function_privilege('authenticated', 'public.airreach_request_create(uuid, text, text, jsonb, text)', 'execute') and not has_function_privilege('anon', 'public.airreach_request_create(uuid, text, text, jsonb, text)', 'execute') as ok"),
        ('補足なしの関数もそのまま残る', "select has_function_privilege('authenticated', 'public.airreach_request_create(uuid, text, text, jsonb)', 'execute') as ok"),
        ('既存の依頼に補足を入れていない', "select count(*) = 0 as ok from public.client_requests where note is not null"),
        ('client_requests の RLS は有効のまま', "select relrowsecurity as ok from pg_class where oid = 'public.client_requests'::regclass"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/20261007190000_airreach_request_note_rollback.sql で戻すか判断してください')


def cmd_set_approver(email, flag):
    email = email.strip().lower()
    if flag not in ('on', 'off') or '@' not in email or "'" in email:
        die('使い方: set-approver <email> on|off')
    confirm_project()
    r = sql(f"update public.staff_members set can_approve = {'true' if flag == 'on' else 'false'} where email = '{email}' returning email")
    if not r:
        die(f'{email} は社内メンバーに登録されていません。先に add-staff で登録してください')
    print('承認者:', sql('select email, role, can_approve from public.staff_members where can_approve order by email', True))


PARTNER_FUNCS = [  # 本番の関数が、この migration が置き換える前提の形かを確かめる（違えば適用しない）
    ('airreach_client_scans', 'public.airreach_is_staff() or public.airreach_is_member(p_client_id)'),
    ('airreach_studio_save', 'if not public.airreach_is_staff() then'),
    ('airreach_client_settings', 'public.airreach_is_staff() or public.airreach_is_member(p_client_id)'),
    ('airreach_request_create', 'public.airreach_is_staff() or public.airreach_is_member(p_client_id)'),
    ('airreach_request_cancel', 'public.airreach_is_staff() or (public.airreach_is_member(r.client_id)'),
    ('airreach_request_decide', 'if not public.airreach_is_staff() then'),
    ('airreach_google_access', 'if public.airreach_is_staff() then'),
]


def cmd_apply_partner_orgs():
    """共同会社の人は自社の顧客だけ見える。airreach_is_staff は社内だけの意味に変わる"""
    confirm_project()
    need = {'clients', 'staff_members', 'client_requests', 'studio_workspaces', 'report_events', 'google_data_deletions'}
    missing = need - set(tables())
    if missing:
        die('先に必要な表がありません: ' + ', '.join(sorted(missing)))
    for name, needle in PARTNER_FUNCS:
        rows = sql(f"select count(*) filter (where prosrc like '%{needle}%') as hit, count(*) as n from pg_proc where proname = '{name}' and pronamespace = 'public'::regnamespace", True)
        if not rows or rows[0]['n'] == 0 or rows[0]['hit'] != rows[0]['n']:
            die(f'本番の {name} が想定と違います（{needle} が見つからない）。適用を中止しました')
    print('適用前の確認: 置き換える関数7つが想定どおり')
    path = ROOT / 'supabase/migrations/20261008120000_airreach_partner_orgs.sql'
    call('POST', f'/projects/{REF}/database/migrations', {'name': 'airreach_partner_orgs', 'query': path.read_text()})
    print('migration を適用しました: airreach_partner_orgs')
    checks = [
        ('partner_orgs があり RLS が有効', "select relrowsecurity as ok from pg_class where oid = 'public.partner_orgs'::regclass"),
        ('staff_members・clients に org_id がある', "select count(*) = 2 as ok from information_schema.columns where table_schema = 'public' and column_name = 'org_id' and table_name in ('staff_members', 'clients')"),
        ('airreach_is_staff は社内だけ（org_id is null）', "select prosrc like '%org_id is null%' as ok from pg_proc where proname = 'airreach_is_staff' and pronamespace = 'public'::regnamespace"),
        ('置き換えた関数に、全顧客を許す古い判定が残っていない', "select count(*) = 0 as ok from pg_proc where pronamespace = 'public'::regnamespace and proname in ('airreach_client_scans','airreach_studio_save','airreach_client_settings','airreach_request_create','airreach_request_cancel','airreach_google_access') and prosrc like '%airreach_is_staff() or%'"),
        ('顧客ごとの判定がログインした人だけに実行できる', "select has_function_privilege('authenticated', 'public.airreach_can_staff(uuid)', 'execute') and not has_function_privilege('anon', 'public.airreach_can_staff(uuid)', 'execute') as ok"),
        ('顧客の表のポリシーが新しいもの（insert・update・delete に分かれた）', "select count(*) = 3 as ok from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname in ('clients_insert','clients_update','clients_delete')"),
        ('古い clients_write が残っていない', "select count(*) = 0 as ok from pg_policies where schemaname = 'public' and tablename = 'clients' and policyname = 'clients_write'"),
        ('いまの社内の人・顧客はすべて Trillion Bank のまま（共同会社に入れていない）', "select (select count(*) from public.staff_members where org_id is not null) = 0 and (select count(*) from public.clients where org_id is not null) = 0 as ok"),
        ('顧客の所属を守るトリガがある', "select exists(select 1 from pg_trigger where tgname = 'clients_org_guard') as ok"),
    ]
    bad = 0
    for label, q in checks:
        r = sql(q, True)
        ok = bool(r and r[0].get('ok'))
        bad += 0 if ok else 1
        print(('OK  ' if ok else 'NG  ') + label)
    if bad:
        die(f'検証で {bad} 件が想定と違います。supabase/rollback/20261008120000_airreach_partner_orgs_rollback.sql で戻すか判断してください')


def _plain(name, what):
    name = name.strip()
    if not name or any(ch in name for ch in "'\\;"):
        die(f'{what}に使えない文字があります')
    return name


def cmd_add_partner_org(name):
    name = _plain(name, '会社名')
    confirm_project()
    if sql(f"select 1 from public.partner_orgs where name = '{name}'", True):
        die(f'「{name}」はもうあります')
    sql(f"insert into public.partner_orgs (name) values ('{name}')")
    print('共同会社:', sql('select name, created_at from public.partner_orgs order by created_at', True))


def cmd_add_partner_staff(email, org, approver):
    email = email.strip().lower()
    if '@' not in email or "'" in email:
        die('使い方: add-partner-staff <email> <会社名> [approver]')
    org = _plain(org, '会社名')
    confirm_project()
    o = sql(f"select id from public.partner_orgs where name = '{org}'", True)
    if not o:
        die(f'共同会社「{org}」がありません。先に add-partner-org で作ってください')
    cur = sql(f"select org_id from public.staff_members where email = '{email}'", True)
    if cur and cur[0].get('org_id') is None:
        die(f'{email} は Trillion Bank の社内の人として登録済みです。共同会社の人にはしません（間違いを防ぐため）')
    sql(f"insert into public.staff_members (email, role, org_id, can_approve) values ('{email}', 'staff', '{o[0]['id']}', {'true' if approver else 'false'}) "
        f"on conflict (email) do update set org_id = excluded.org_id, can_approve = excluded.can_approve, role = 'staff'")
    print(f'「{org}」の人:', sql(f"select email, can_approve from public.staff_members where org_id = '{o[0]['id']}' order by email", True))


def cmd_assign_client(client_id, org):
    if not re.fullmatch(r'[0-9a-f-]{36}', client_id or ''):
        die('使い方: assign-client <顧客ID> <会社名|TB>')
    confirm_project()
    if org == 'TB':
        oid = 'null'
    else:
        org = _plain(org, '会社名')
        o = sql(f"select id from public.partner_orgs where name = '{org}'", True)
        if not o:
            die(f'共同会社「{org}」がありません')
        oid = f"'{o[0]['id']}'"
    r = sql(f"update public.clients set org_id = {oid}, owner_email = case when {oid} is null then owner_email else null end where id = '{client_id}' returning name", True)
    if not r:
        die('その顧客はありません')
    print(f"{r[0]['name']} の担当会社を {org} にしました（共同会社に移すときは、担当者は未設定に戻します）")


def cmd_partner_status(org=None):
    """共同会社ごとに、人（承認者か・最後のログイン）と割り当てた顧客を読む（変更しない）"""
    confirm_project()
    where = f"where o.name = '{_plain(org, '会社名')}'" if org else ''
    for o in sql(f"select o.id, o.name from public.partner_orgs o {where} order by o.created_at", True) or []:
        print(f"■ {o['name']}")
        for s_ in sql(f"select s.email, s.name, s.can_approve, (select max(u.last_sign_in_at) from auth.users u where lower(u.email) = s.email) as last_sign_in from public.staff_members s where s.org_id = '{o['id']}' order by s.email", True) or []:
            print(f"  人: {s_['email']} {s_['name'] or ''} 承認者={'はい' if s_['can_approve'] else 'いいえ'} 最後のログイン={s_['last_sign_in'] or 'まだ'}")
        cl = sql(f"select c.id, c.name from public.clients c where c.org_id = '{o['id']}' order by c.name", True) or []
        print(f"  割り当てた顧客: {len(cl)}件" + ''.join(f"\n    {c['id']} {c['name']}" for c in cl))


def cmd_remove_partner_staff(email):
    email = email.strip().lower()
    if '@' not in email or "'" in email:
        die('使い方: remove-partner-staff <email>')
    confirm_project()
    cur = sql(f"select org_id from public.staff_members where email = '{email}'", True)
    if not cur:
        die(f'{email} は登録されていません')
    if cur[0].get('org_id') is None:
        die(f'{email} は Trillion Bank の社内の人です。このコマンドでは消しません')
    sql(f"delete from public.staff_members where email = '{email}' and org_id is not null")
    print(f'{email} を解除しました（次の画面の読み込みから、社内向けの画面と自社の顧客のデータを使えなくなる）')


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
            'anon-key-to-vercel': cmd_anon_key_to_vercel, 'apply-report-2026-10': cmd_apply_report_2026_10, 'apply-studio-workspaces': cmd_apply_studio_workspaces, 'apply-schedules': cmd_apply_schedules, 'apply-client-requests': cmd_apply_client_requests, 'apply-client-owner-due': cmd_apply_client_owner_due, 'apply-request-note': cmd_apply_request_note, 'apply-partner-orgs': cmd_apply_partner_orgs, 'apply-client-issues': cmd_apply_client_issues, 'apply-decision-replies': cmd_apply_decision_replies, 'apply-measure-timing': cmd_apply_measure_timing, 'apply-measure-timing-publish': cmd_apply_measure_timing_publish, 'apply-save-google-traffic': cmd_apply_save_google_traffic, 'verify': lambda: (confirm_project(), verify())}
    if a and a[0] in cmds and len(a) == 1:
        cmds[a[0]]()
    elif a and a[0] == 'add-staff' and len(a) == 3:
        cmd_add_staff(a[1], a[2])
    elif a and a[0] == 'set-approver' and len(a) == 3:
        cmd_set_approver(a[1], a[2])
    elif a and a[0] == 'add-partner-org' and len(a) == 2:
        cmd_add_partner_org(a[1])
    elif a and a[0] == 'add-partner-staff' and len(a) in (3, 4) and (len(a) == 3 or a[3] == 'approver'):
        cmd_add_partner_staff(a[1], a[2], len(a) == 4)
    elif a and a[0] == 'assign-client' and len(a) == 3:
        cmd_assign_client(a[1], a[2])
    elif a and a[0] == 'partner-status' and len(a) in (1, 2):
        cmd_partner_status(a[1] if len(a) == 2 else None)
    elif a and a[0] == 'remove-partner-staff' and len(a) == 2:
        cmd_remove_partner_staff(a[1])
    else:
        print(__doc__)
        sys.exit(0 if not a else 2)


if __name__ == '__main__':
    main()
