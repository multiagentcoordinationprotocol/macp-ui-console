"""Offline tests for deploy/doppler-sync.sh.

    python3 scripts/test_doppler_sync.py

The script runs for real (bash, git, jq) against a throwaway git repo, with
fake `doppler`, `vercel` and `curl` binaries first on PATH. The fake curl
serves a small in-memory Vercel API from a JSON state file and logs every argv
it receives, so the tests prove that a failed Vercel read stops the run with
nothing written, and that no secret value or token reaches a command line or
the output. Adapted from aitp-website scripts/test_doppler_sync.py (#117).
"""

import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "deploy" / "doppler-sync.sh"
TOKEN = "tok-SENTINEL-4f1c"
SECRET = "s3cr3t-VALUE-9a7e"

FAKE_CURL = r'''#!/usr/bin/env python3
import json, os, re, sys
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write("curl " + json.dumps(sys.argv[1:]) + "\n")
args = sys.argv[1:]
url, headers = None, []
i = 0
while i < len(args):
    a = args[i]
    if a == "-H": headers.append(args[i + 1]); i += 2; continue
    if a.startswith("http"): url = a
    i += 1
auth = []
for h in headers:
    if h.startswith("@"):
        with open(h[1:]) as f: auth += [l.strip() for l in f if l.strip()]
    else:
        auth.append(h)
if "Authorization: Bearer " + os.environ["EXPECT_TOKEN"] not in auth:
    sys.stderr.write("fake curl: missing auth\n"); sys.exit(22)
path = "/" + url.split("://", 1)[1].split("/", 1)[1].split("?", 1)[0]
fail = os.environ.get("FAKE_GET_FAIL", "")
if fail.startswith(path.split("/")[1] + ":"):
    kind = fail.split(":", 1)[1]
    if kind == "http": sys.exit(22)      # curl -f on a non-2xx
    if kind == "network": sys.exit(6)    # could not resolve host
    if kind == "garbage": sys.stdout.write("<html>oops</html>"); sys.exit(0)
with open(os.environ["FAKE_VERCEL_STATE"]) as f: st = json.load(f)
def out(o): sys.stdout.write(json.dumps(o)); sys.exit(0)
if re.fullmatch(r"/v9/projects/[^/]+/env", path):
    out({"envs": [{k: e[k] for k in ("id", "key", "type", "target", "gitBranch")} for e in st["envs"]]})
m = re.fullmatch(r"/v1/projects/[^/]+/env/([^/]+)", path)
if m:
    e = next(e for e in st["envs"] if e["id"] == m.group(1))
    if e["type"] == "sensitive": sys.exit(22)
    out({"id": e["id"], "value": e["value"]})
if path == "/v6/deployments":
    out({"deployments": [{"uid": "dpl_latest"}]})
sys.stderr.write("fake curl: unexpected " + path + "\n"); sys.exit(22)
'''

FAKE_DOPPLER = r'''#!/usr/bin/env bash
printf 'doppler %s\n' "$*" >> "$FAKE_LOG"
case "$1" in
  me) exit 0 ;;
  secrets) [ -n "${FAKE_DOPPLER_FAIL:-}" ] && exit 1; cat "$FAKE_DOPPLER_JSON" ;;
  *) exit 1 ;;
esac
'''

# Any `vercel env add/update` or `vercel redeploy` is a write.
FAKE_VERCEL = r'''#!/usr/bin/env bash
printf 'vercel %s\n' "$*" >> "$FAKE_LOG"
cat >/dev/null
exit 0
'''


def entry(key, value, target=("production",), type_="encrypted"):
    return {"id": "env_" + key, "key": key, "type": type_, "target": list(target),
            "gitBranch": None, "value": value}


class DopplerSyncTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="doppler-sync-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.repo = self.tmp / "repo"
        (self.repo / "deploy").mkdir(parents=True)
        shutil.copy(SCRIPT, self.repo / "deploy" / "doppler-sync.sh")
        (self.repo / "deploy" / "doppler-keys.txt").write_text("# managed\nSITE_FLAG\n")
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
        for cmd in (["init", "-q"], ["add", "-A"], ["commit", "-q", "-m", "keys"]):
            subprocess.run(["git", "-C", str(self.repo), *cmd], check=True, capture_output=True, env=env)
        self.bin = self.tmp / "bin"
        self.bin.mkdir()
        for name, body in (("curl", FAKE_CURL), ("doppler", FAKE_DOPPLER), ("vercel", FAKE_VERCEL)):
            p = self.bin / name
            p.write_text(body)
            p.chmod(p.stat().st_mode | stat.S_IEXEC)
        self.log = self.tmp / "calls.log"
        self.log.write_text("")
        self.state = self.tmp / "vercel.json"
        self.doppler = self.tmp / "doppler.json"
        self.doppler.write_text(json.dumps({"SITE_FLAG": SECRET}))
        self.set_vercel([entry("SITE_FLAG", SECRET)])

    def set_vercel(self, envs):
        self.state.write_text(json.dumps({"envs": envs}))

    def run_sync(self, *args, **extra_env):
        env = {**os.environ, "PATH": f"{self.bin}:{os.environ['PATH']}", "VERCEL_TOKEN": TOKEN,
               "EXPECT_TOKEN": TOKEN, "FAKE_LOG": str(self.log), "FAKE_VERCEL_STATE": str(self.state),
               "FAKE_DOPPLER_JSON": str(self.doppler), **extra_env}
        r = subprocess.run(["bash", "deploy/doppler-sync.sh", *args], cwd=self.repo, env=env,
                           capture_output=True, text=True, timeout=60)
        for blob in (r.stdout, r.stderr, self.log.read_text()):
            self.assertNotIn(SECRET, blob, "secret value leaked")
            self.assertNotIn(TOKEN, blob, "token leaked onto argv or output")
        return r

    def writes(self):
        return [l for l in self.log.read_text().splitlines()
                if l.startswith("vercel ") and not l.startswith(("vercel whoami",))]

    def test_in_sync_dry_run_and_apply_write_nothing(self):
        for mode in ((), ("--apply",)):
            r = self.run_sync(*mode)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn("SITE_FLAG: unchanged", r.stderr)
            self.assertIn("in sync", r.stderr)
        self.assertEqual(self.writes(), [])
        # Every API call carried the token in a header file, not on argv.
        for line in self.log.read_text().splitlines():
            self.assertNotIn("Bearer", line)

    def test_failed_vercel_read_fails_closed(self):
        # The entry is shared with Preview: if a failed read looked like "no
        # entry" the script would report "new" and --apply would write.
        self.set_vercel([entry("SITE_FLAG", "old", target=("production", "preview"))])
        for failing in ("v9:http", "v9:network", "v9:garbage", "v1:http", "v1:network", "v1:garbage"):
            for mode in ((), ("--apply",)):
                with self.subTest(failing=failing, mode=mode):
                    r = self.run_sync(*mode, FAKE_GET_FAIL=failing)
                    self.assertNotEqual(r.returncode, 0)
                    self.assertIn("reading Vercel environment variables failed", r.stderr)
                    self.assertNotIn(": new", r.stderr)
                    self.assertNotIn(": changed", r.stderr)
        self.assertEqual(self.writes(), [])

    def test_failed_doppler_read_fails_closed(self):
        for mode in ((), ("--apply",)):
            r = self.run_sync(*mode, FAKE_DOPPLER_FAIL="1")
            self.assertNotEqual(r.returncode, 0)
            self.assertIn("reading Doppler", r.stderr)
        self.assertEqual(self.writes(), [])

    def test_sensitive_entry_refused_without_reading_it(self):
        self.set_vercel([entry("SITE_FLAG", "hidden", type_="sensitive")])
        r = self.run_sync("--apply")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("SITE_FLAG: sensitive-unreadable", r.stderr)
        self.assertEqual(self.writes(), [])

    def test_missing_token_stops_before_any_api_call(self):
        home = self.tmp / "home"
        home.mkdir()
        r = self.run_sync(VERCEL_TOKEN="", HOME=str(home), XDG_DATA_HOME=str(home))
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no Vercel token", r.stderr)
        self.assertNotIn("curl ", self.log.read_text())


if __name__ == "__main__":
    unittest.main()
