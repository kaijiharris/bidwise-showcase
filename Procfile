# NOTE: api_server.py is intentionally NOT deployed.
#
# It was previously deployed here as:
#   web: gunicorn api_server:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
# but it exposed an unauthenticated subprocess + git-push endpoint (RCE risk) and
# is not used by the production apps (mobile uses Supabase directly; web uses
# Next.js API routes). The dangerous endpoints have been removed from
# api_server.py and the process has been removed from deployment.
#
# If you ever need to run the hardened read-only mobile API again, uncomment the
# line below — but first confirm a host is actually meant to serve it, and set
# SUPABASE_JWT_SECRET and ALLOWED_ORIGINS in the environment.
#
# web: gunicorn api_server:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120
