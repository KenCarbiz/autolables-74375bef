"""Socket-only SQL regression runner; never reads PG* or hosted credentials.

Bootstrap gateway_template from all unchanged migrations and the documented auth fixtures first.
Every suite gets a fresh database clone. Success is ONLY its declared rollback sentinel.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
SOCKET = "/tmp/gateway-final/socket"

def psql(db, sql=None, file=None):
    cmd = ["psql", "-X", "-h", SOCKET, "-U", "lovable", "-d", db, "-v", "ON_ERROR_STOP=1"]
    if file:
        cmd.extend(["-f", str(file)])
    return subprocess.run(cmd, input=sql, text=True, capture_output=True, timeout=60)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--suite", action="append")
    parser.add_argument("--output", default="/tmp/gateway-final/sql-results.json")
    args = parser.parse_args()
    if not Path(SOCKET).is_dir():
        raise SystemExit("Disposable Unix socket missing; hosted fallback prohibited")
    suites = [ROOT / "tests/sql" / s for s in args.suite] if args.suite else sorted((ROOT / "tests/sql").glob("*.test.sql"))
    results = []
    for index, path in enumerate(suites):
        db = f"gw_suite_{index}_{int(time.time())}"
        created = psql("postgres", f'CREATE DATABASE "{db}" TEMPLATE gateway_template;')
        if created.returncode:
            raise SystemExit(created.stderr)
        started = time.monotonic()
        try:
            # A historical forensics assertion requires an explicit fresh capture, never fabricated rows.
            if path.name == "recovery_forensics.test.sql":
                revision = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True, capture_output=True, check=True).stdout.strip()
                if not re.fullmatch(r"[0-9a-f]{40}", revision):
                    raise RuntimeError("Invalid source pin")
                capture = psql(db, sql=f"SELECT set_config('gw.forensic_source_sha','{revision}',false);\n" + (ROOT / "scripts/recon/capture_forensic_drill.sql").read_text())
                if capture.returncode:
                    raise RuntimeError(capture.stderr)
            run = psql(db, file=path)
            text = run.stdout + run.stderr
            match = re.search(r"ERROR:\s+(GW_[A-Z_]*TESTS_PASSED):\s*(\d+)", text)
            expected = re.search(r"raise exception\s+'(GW_[A-Z_]*TESTS_PASSED):", path.read_text(), re.I)
            passed = bool(match and expected and match.group(1) == expected.group(1))
            log = Path(args.output).parent / (path.stem + ".log")
            log.write_text(text)
            result = {"suite": path.name, "pass": passed, "assertions": int(match.group(2)) if passed else 0, "seconds": round(time.monotonic()-started, 3), "evidence": str(log)}
            if not passed:
                result["failure"] = next((line for line in text.splitlines() if "ERROR:" in line), "No expected success sentinel")[:500]
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            result = {"suite": path.name, "pass": False, "assertions": 0, "failure": str(error)[:500]}
        finally:
            dropped = psql("postgres", f'DROP DATABASE "{db}";')
            if dropped.returncode:
                raise SystemExit(dropped.stderr)
        results.append(result)
        print(json.dumps(result))
    Path(args.output).write_text(json.dumps(results, indent=2)+"\n")
    raise SystemExit(0 if all(r["pass"] for r in results) else 1)

if __name__ == "__main__":
    main()