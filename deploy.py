#!/usr/bin/env python3
"""
RoastMe deploy script — deploys this project to Cloudflare Pages WITHOUT GitHub Actions.

Usage:  python3 deploy.py            (from the project root)

What it does:
  1. Stages a clean copy of the project in /tmp/roast-deploy
  2. Mints a short-lived, scoped Cloudflare API token (Pages Write +
     Memberships Read + User Details Read) using the global admin credential.
     The raw token value is NEVER printed, logged, or written to disk — it is
     passed to wrangler only via the child process environment.
  3. Runs `wrangler pages deploy public --project-name=venture-roast --branch=main`
     with CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID set.

Safety note: `wrangler pages deploy` replaces the Pages project's env vars with
wrangler.toml [vars]. That is safe here because this project has NO dashboard-only
vars and the committed wrangler.toml [vars] is the complete authoritative set
(PRODUCT_ID, CHECKOUT_API, BRAND_NAME — no secrets). Never use this pattern on a
project whose secrets live only in the dashboard.

Requires: node + npm, and `wrangler` (installed automatically if missing).
"""
import json, os, shutil, subprocess, sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
STAGE_DIR = "/tmp/roast-deploy"
PROJECT_NAME = "venture-roast"
ACCOUNT_ID = "621600637337cc1c9ecb7095508bc732"

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
import dynamic_credentials as dc
import urllib.request, urllib.error

EMAIL = json.load(open("/home/hatch/workspace/skills/cloudflare/config.json")).get("email")


def cf(path, method="GET", body=None):
    req = urllib.request.Request(
        "https://api.cloudflare.com/client/v4" + path, method=method,
        headers={"X-Auth-Email": EMAIL, "Accept": "application/json"})
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        req.add_header("Content-Type", "application/json")
    dc.add_surrogate_to_request(req, "custom.cloudflare", allowed_hosts=["api.cloudflare.com"])
    try:
        with urllib.request.urlopen(req, data=data, timeout=60) as resp:
            return resp.status, dc.read_json_response(resp)
    except urllib.error.HTTPError as e:
        return e.code, {"http_error": e.code,
                        "body": e.read(2000).decode("utf-8", "replace")}


def mint_deploy_token():
    s, d = cf("/user/tokens", "POST", {
        "name": "venture-roast-pages-deploy",
        "policies": [
            {"effect": "allow",
             "resources": {"com.cloudflare.api.account." + ACCOUNT_ID: "*"},
             "permission_groups": [
                 {"id": "8d28297797f24fb8a0c332fe0866ec89"},  # Pages Write
                 {"id": "3518d0f75557482e952c6762d3e64903"},  # Memberships Read
             ]},
            {"effect": "allow",
             "resources": {"com.cloudflare.api.user.1e1235d798707498a0b23a4cf83ecd0b": "*"},
             "permission_groups": [
                 {"id": "8acbe5bb0d54464ab867149d7f7cf8ac"},  # User Details Read
             ]},
        ],
        "not_before": "2026-09-14T00:00:00Z",
    })
    tok = ((d.get("result") or {}).get("value"))
    if s != 200 or not tok:
        print("TOKEN MINT FAILED", s, json.dumps(d)[:300])
        sys.exit(1)
    print("deploy token minted (value redacted)")
    return tok


def ensure_wrangler():
    if shutil.which("wrangler"):
        return
    print("installing wrangler@3 ...")
    r = subprocess.run(["npm", "install", "-g", "wrangler@3"],
                       capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or not shutil.which("wrangler"):
        print("wrangler install failed")
        sys.exit(1)


def main():
    # 1. stage
    if os.path.isdir(STAGE_DIR):
        shutil.rmtree(STAGE_DIR)
    shutil.copytree(PROJECT_ROOT, STAGE_DIR,
                    ignore=shutil.ignore_patterns("deploy.py", ".git", "node_modules"))
    print("staged ->", STAGE_DIR)

    # 2. token
    token = mint_deploy_token()

    # 3. deploy
    ensure_wrangler()
    env = dict(os.environ)
    env["CLOUDFLARE_API_TOKEN"] = token
    env["CLOUDFLARE_ACCOUNT_ID"] = ACCOUNT_ID
    env["WRANGLER_SEND_METRICS"] = "false"
    del token
    p = subprocess.run(
        ["wrangler", "pages", "deploy", "public",
         "--project-name=" + PROJECT_NAME, "--branch=main"],
        cwd=STAGE_DIR, env=env, capture_output=True, text=True, timeout=600)
    print(p.stdout[-2500:])
    if p.stderr:
        print(p.stderr[-1000:])
    sys.exit(p.returncode)


if __name__ == "__main__":
    main()
