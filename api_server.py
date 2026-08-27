"""
api_server.py — minimal, hardened Flask surface for the mobile read-only API.

SECURITY NOTE (launch hardening):
  This module previously exposed an UNAUTHENTICATED `/api/analyze` endpoint that
  ran `subprocess` (`python execution/...`) and `git add/commit/push` on the
  server, with wildcard CORS and `debug=True`. That is a remote-code-execution /
  supply-chain hole. The production apps (mobile + web) do NOT use this server —
  the mobile app talks to Supabase directly and the web app uses its own Next.js
  API routes. So the dangerous endpoints have been REMOVED entirely:

    - REMOVED: /api/analyze        (subprocess + git push)   ← RCE risk
    - REMOVED: /api/export         (unauth Excel dump)
    - REMOVED: /api/status         (info disclosure, unauth)
    - REMOVED: the local dashboard static routes
    - REMOVED: the _push_data_and_deploy() subprocess/git helper

  What remains is only the authenticated, read-only mobile v1 blueprint
  (`/api/v1/properties`), which validates a Supabase JWT on every request.

  This server is ALSO removed from the Procfile (it is no longer deployed). It is
  kept here as a runnable local dev surface only. If you ever re-deploy it:
    - keep debug=False
    - keep CORS restricted to known origins (ALLOWED_ORIGINS below)
    - require auth on every data route (the v1 blueprint already does)
    - never add a shell/subprocess/git endpoint
"""

import os

from flask import Flask, jsonify
from flask_cors import CORS

# Load .env if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Restrict CORS to known origins. Override with a comma-separated ALLOWED_ORIGINS
# env var in deployment. No wildcard — the mobile client sends a bearer JWT and
# does not need permissive CORS; the web app uses its own Next.js routes.
_DEFAULT_ORIGINS = "https://bidwiseinvest.com,https://www.bidwiseinvest.com,https://taxdeediq.vercel.app"
ALLOWED_ORIGINS = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",") if o.strip()
]

app = Flask(__name__)
# Scope CORS to the API surface and known origins only.
CORS(app, resources={r"/api/*": {"origins": ALLOWED_ORIGINS}})

# Authenticated, read-only mobile API v1 (validates Supabase JWT per request).
from api.v1 import v1_blueprint
app.register_blueprint(v1_blueprint, url_prefix="/api/v1")


@app.route("/healthz", methods=["GET"])
def healthz():
    """Unauthenticated liveness probe — no data, no side effects."""
    return jsonify({"ok": True})


if __name__ == "__main__":
    # debug=False: never run the reloader/PIN debugger on a network-facing app.
    port = int(os.getenv("PORT", "5000"))
    app.run(host="127.0.0.1", port=port, debug=False)
