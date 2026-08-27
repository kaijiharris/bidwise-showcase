import os
from functools import wraps
from flask import request, jsonify, g

try:
    import jwt as pyjwt
except ImportError:
    pyjwt = None

DISCLAIMER = (
    "This tool provides analysis only and is not investment advice. "
    "Past tax deed performance does not guarantee future results. "
    "Consult a licensed real estate attorney before making decisions. "
    "ARV estimates, rehab costs, and ROI projections are based on assumptions "
    "and available data — actual results may vary. Analysis generated using AI."
)

def _get_token():
    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        return auth_header[7:]
    return None

def require_auth(f):
    """Validate Supabase JWT. Set g.user_id on success."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = _get_token()
        if not token:
            return jsonify({'error': 'Missing authorization token'}), 401

        secret = os.getenv('SUPABASE_JWT_SECRET')
        if not secret:
            # Deny by default. Never fail open: a missing secret is a server
            # misconfiguration, not a licence to bypass auth. (Previously this
            # set g.user_id='dev-user' when ENVIRONMENT defaulted to
            # 'development' — that silently disabled auth in production.)
            return jsonify({'error': 'Auth not configured'}), 401

        if pyjwt is None:
            # PyJWT unavailable => we cannot verify the token. Deny by default;
            # never fail open (a 500 here would have meant "couldn't check, so
            # block" anyway, but 401 makes the DENY explicit to clients).
            return jsonify({'error': 'Auth not available'}), 401

        # Validate the issuer so a token minted by a *different* Supabase
        # project that happens to share this signing secret is rejected.
        # SUPABASE_ISSUER may be set directly; otherwise derive it from
        # SUPABASE_URL as "<url>/auth/v1".
        issuer = os.getenv('SUPABASE_ISSUER')
        if not issuer:
            supabase_url = os.getenv('SUPABASE_URL', '').rstrip('/')
            issuer = f'{supabase_url}/auth/v1' if supabase_url else None

        decode_kwargs = {
            'algorithms': ['HS256'],
            'audience': 'authenticated',
            'options': {'require': ['exp']},
        }
        if issuer:
            decode_kwargs['issuer'] = issuer
            decode_kwargs['options']['verify_iss'] = True

        try:
            payload = pyjwt.decode(token, secret, **decode_kwargs)
            g.user_id = payload.get('sub', 'unknown')
        except pyjwt.ExpiredSignatureError:
            return jsonify({'error': 'Token expired'}), 401
        except pyjwt.InvalidIssuerError:
            return jsonify({'error': 'Invalid token issuer'}), 401
        except pyjwt.InvalidTokenError as e:
            return jsonify({'error': f'Invalid token: {str(e)}'}), 401
        except Exception:
            # Any unexpected decode failure must DENY, never fail open / 500.
            return jsonify({'error': 'Invalid token'}), 401

        return f(*args, **kwargs)
    return decorated
