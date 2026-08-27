"""
BidWise - Invite or Create User (bypasses Stripe)
=================================================

Creates a Supabase auth account and grants app access by writing a real row to
the `subscriptions` table. This matters for the mobile app, which checks the
subscription table rather than user metadata.

Recommended App Review account:
    python execution/invite_user.py --email appreview@bidwiseinvest.com --plan pro --password "REPLACE_WITH_STRONG_PASSWORD" --full-name "App Review"

Invite flow:
    python execution/invite_user.py --email user@example.com --plan expert

Plans: starter | pro | expert
Default plan: expert

Requires one Supabase URL and one service-role key in web/.env.local,
mobile/.env.local, .env.local, or .env:
    NEXT_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parent.parent
ENV_FILES = [
    ROOT / "web" / ".env.local",
    ROOT / "mobile" / ".env.local",
    ROOT / ".env.local",
    ROOT / ".env",
    ROOT / "web" / ".env",
    ROOT / "mobile" / ".env",
]

VALID_PLANS = {"starter", "pro", "expert"}
VALID_BILLING_CYCLES = {"monthly", "annual"}


def load_env() -> None:
    for env_file in ENV_FILES:
        if not env_file.exists():
            continue
        with env_file.open(encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env()

SUPABASE_URL = (
    os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    or os.environ.get("EXPO_PUBLIC_SUPABASE_URL")
    or os.environ.get("SUPABASE_URL")
    or ""
).rstrip("/")

SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")


def require_config() -> None:
    if not SUPABASE_URL or not SERVICE_ROLE_KEY:
        print(
            "ERROR: Set NEXT_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_URL, "
            "plus SUPABASE_SERVICE_ROLE_KEY."
        )
        sys.exit(1)


def auth_headers() -> dict[str, str]:
    return {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def rest_headers(prefer: str = "return=representation") -> dict[str, str]:
    headers = auth_headers()
    headers["Prefer"] = prefer
    return headers


def request_json(
    method: str,
    url: str,
    *,
    ok_statuses: tuple[int, ...] = (200,),
    **kwargs: Any,
) -> Any:
    resp = requests.request(method, url, headers=kwargs.pop("headers", auth_headers()), timeout=20, **kwargs)
    if resp.status_code not in ok_statuses:
        raise RuntimeError(f"{method} {url} failed with {resp.status_code}: {resp.text}")
    if not resp.text:
        return None
    return resp.json()


def find_user_by_email(email: str) -> dict[str, Any] | None:
    page = 1
    per_page = 100
    email_lc = email.lower()

    while True:
        data = request_json(
            "GET",
            f"{SUPABASE_URL}/auth/v1/admin/users",
            params={"page": page, "per_page": per_page},
        )
        users = data.get("users", data if isinstance(data, list) else [])
        for user in users:
            if str(user.get("email", "")).lower() == email_lc:
                return user
        if len(users) < per_page:
            return None
        page += 1


def create_or_update_password_user(
    email: str,
    password: str,
    plan: str,
    full_name: str | None,
) -> dict[str, Any]:
    metadata = {
        "plan": plan,
        "subscription_status": "active",
        "granted_access": True,
    }
    if full_name:
        metadata["full_name"] = full_name

    existing = find_user_by_email(email)
    payload = {
        "email": email,
        "password": password,
        "email_confirm": True,
        "user_metadata": metadata,
    }

    if existing:
        user_id = existing["id"]
        user = request_json(
            "PUT",
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            json=payload,
        )
        print(f"UPDATED: Existing auth user {email}")
        return user

    user = request_json(
        "POST",
        f"{SUPABASE_URL}/auth/v1/admin/users",
        ok_statuses=(200, 201),
        json=payload,
    )
    print(f"CREATED: Auth user {email}")
    return user


def invite_user(email: str, plan: str, full_name: str | None) -> dict[str, Any]:
    metadata = {
        "plan": plan,
        "subscription_status": "active",
        "granted_access": True,
    }
    if full_name:
        metadata["full_name"] = full_name

    resp = requests.post(
        f"{SUPABASE_URL}/auth/v1/invite",
        headers=auth_headers(),
        json={"email": email, "data": metadata},
        timeout=20,
    )

    if resp.status_code == 200:
        print(f"SUCCESS: Invite sent to {email}")
        return resp.json()

    if resp.status_code == 422:
        user = find_user_by_email(email)
        if user:
            print(f"NOTE: Auth user already exists for {email}")
            return user

    raise RuntimeError(f"Invite failed with {resp.status_code}: {resp.text}")


def upsert_profile(user_id: str, email: str, full_name: str | None) -> None:
    payload = {
        "id": user_id,
        "email": email,
        "role": "client",
    }
    if full_name:
        payload["full_name"] = full_name

    request_json(
        "POST",
        f"{SUPABASE_URL}/rest/v1/user_profiles?on_conflict=id",
        headers=rest_headers("resolution=merge-duplicates,return=representation"),
        ok_statuses=(200, 201),
        json=payload,
    )
    print("UPDATED: user_profiles row")


def latest_subscription_id(user_id: str) -> str | None:
    data = request_json(
        "GET",
        f"{SUPABASE_URL}/rest/v1/subscriptions",
        headers=auth_headers(),
        params={
            "select": "id",
            "user_id": f"eq.{user_id}",
            "order": "created_at.desc",
            "limit": "1",
        },
    )
    if isinstance(data, list) and data:
        return data[0]["id"]
    return None


def upsert_subscription(
    user_id: str,
    plan: str,
    billing_cycle: str,
    period_days: int,
) -> None:
    current_period_end = datetime.now(timezone.utc) + timedelta(days=period_days)
    payload = {
        "user_id": user_id,
        "plan": plan,
        "status": "active",
        "billing_cycle": billing_cycle,
        "current_period_end": current_period_end.isoformat(),
    }

    sub_id = latest_subscription_id(user_id)
    if sub_id:
        request_json(
            "PATCH",
            f"{SUPABASE_URL}/rest/v1/subscriptions",
            headers=rest_headers("return=representation"),
            params={"id": f"eq.{sub_id}"},
            json=payload,
        )
        print("UPDATED: subscriptions row")
        return

    request_json(
        "POST",
        f"{SUPABASE_URL}/rest/v1/subscriptions",
        headers=rest_headers("return=representation"),
        ok_statuses=(200, 201),
        json=payload,
    )
    print("CREATED: subscriptions row")


def grant_access(
    email: str,
    plan: str,
    full_name: str | None,
    password: str | None,
    billing_cycle: str,
    period_days: int,
) -> None:
    require_config()

    if plan not in VALID_PLANS:
        raise ValueError(f"Invalid plan '{plan}'. Choose from: {', '.join(sorted(VALID_PLANS))}")
    if billing_cycle not in VALID_BILLING_CYCLES:
        raise ValueError(
            f"Invalid billing cycle '{billing_cycle}'. Choose from: {', '.join(sorted(VALID_BILLING_CYCLES))}"
        )

    email = email.strip().lower()
    if password:
        user = create_or_update_password_user(email, password, plan, full_name)
    else:
        user = invite_user(email, plan, full_name)

    user_id = user.get("id")
    if not user_id:
        raise RuntimeError("Supabase response did not include a user id.")

    upsert_profile(user_id, email, full_name)
    upsert_subscription(user_id, plan, billing_cycle, period_days)

    print("")
    print("DONE")
    print(f"  Email   : {email}")
    print(f"  User ID : {user_id}")
    print(f"  Plan    : {plan}")
    print(f"  Status  : active")
    if password:
        print("  Login   : Password set and email confirmed")
    else:
        print("  Login   : Invitation email sent")


def main() -> None:
    parser = argparse.ArgumentParser(description="Invite or create a BidWise user with active access")
    parser.add_argument("--email", required=True, help="Email address")
    parser.add_argument("--plan", default="expert", choices=sorted(VALID_PLANS), help="Plan to grant")
    parser.add_argument("--full-name", default=None, help="Optional display name")
    parser.add_argument("--password", default=None, help="Set a password directly instead of sending an invite")
    parser.add_argument(
        "--billing-cycle",
        default="annual",
        choices=sorted(VALID_BILLING_CYCLES),
        help="Billing cycle to write to subscriptions",
    )
    parser.add_argument(
        "--period-days",
        default=365,
        type=int,
        help="Days until current_period_end for the granted subscription",
    )
    args = parser.parse_args()

    grant_access(
        email=args.email,
        plan=args.plan,
        full_name=args.full_name,
        password=args.password,
        billing_cycle=args.billing_cycle,
        period_days=args.period_days,
    )


if __name__ == "__main__":
    main()
