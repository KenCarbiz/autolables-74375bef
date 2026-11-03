"""Build a fresh socket-only local PostgreSQL 17 cluster; never reads or falls back to PG*.

Requires initdb, pg_ctl, psql and setpriv; PostgreSQL cannot run as root.
Existing /tmp/gateway-final/data is refused to avoid overwriting evidence.
"""
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = Path("/tmp/gateway-final")
def run(cmd, sql=None):
    subprocess.run(cmd, input=sql, text=True, check=True, timeout=60)
def main():
    if (BASE / "data/PG_VERSION").exists():
        raise SystemExit("Existing disposable cluster preserved; use its socket or a clean sandbox")
    for path in [BASE,BASE/"data",BASE/"socket"]:
        path.mkdir(parents=True,exist_ok=True)
        os.chown(path,1000,1000)
    prefix=["setpriv","--reuid=1000","--regid=1000","--clear-groups"]
    run(prefix+["initdb","-D",str(BASE/"data"),"-A","trust","--no-locale","--encoding=UTF8"])
    run(prefix+["pg_ctl","-D",str(BASE/"data"),"-l",str(BASE/"postgres.log"),"-o",f"-c listen_addresses='' -k {BASE/'socket'}","start"])
    cli=["psql","-X","-h",str(BASE/"socket"),"-U","lovable","-v","ON_ERROR_STOP=1"]
    run(cli+["-d","postgres"],"CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS; CREATE DATABASE gateway_template;")
    run(cli+["-d","gateway_template"],"""CREATE SCHEMA auth; CREATE SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false,aud text,role text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;""")
    files=sorted((ROOT/"drizzle/migrations").glob("[0-9]*.sql"))
    for file in files:
        run(cli+["-d","gateway_template","-f",str(file)])
    for file in [ROOT/"scripts/gateway-disposable-fixtures.sql",ROOT/"docs/proposals/final-execution/rtgip2.sql",ROOT/"docs/proposals/final-execution/reconciliation-v3.sql"]:
        run(cli+["-d","gateway_template","-f",str(file)])
    print(f"Loaded {len(files)} unchanged migrations and local proposals. No hosted database accessed.")
if __name__=="__main__":
    main()