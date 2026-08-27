"""
BidWise Supabase Client — Off-Market Lead Engine
=================================================
Python-side client for reading/writing off-market lead data.
Used by the PropStream enrichment worker (not by the Next.js API).

Requires:
    pip install supabase python-dotenv

Environment variables (from .env in the project root):
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY   ← service role bypasses RLS
"""

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from dotenv import load_dotenv
from loguru import logger

# Load .env from project root, then fallback to web/.env.local (where Supabase keys live)
_ROOT = Path(__file__).parent.parent.parent
load_dotenv(_ROOT / ".env")
load_dotenv(_ROOT / "web" / ".env.local", override=False)  # only fills gaps

try:
    from supabase import create_client, Client
    _SUPABASE_AVAILABLE = True
except ImportError:
    _SUPABASE_AVAILABLE = False
    logger.warning("supabase-py not installed — run: pip install supabase")


# ── Constants ─────────────────────────────────────────────────────────────────

SUPABASE_URL      = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_SVC_KEY  = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

TABLE_LEADS       = "off_market_leads"
TABLE_WATCHLISTS  = "watchlists"
TABLE_WL_LEADS    = "watchlist_leads"
TABLE_PIPELINE    = "lead_pipeline"


# ── Client Singleton ──────────────────────────────────────────────────────────

_client: Optional["Client"] = None

def get_client() -> "Client":
    """Return a cached Supabase service-role client (bypasses RLS)."""
    global _client
    if _client is None:
        if not _SUPABASE_AVAILABLE:
            raise RuntimeError("supabase-py not installed. Run: pip install supabase")
        if not SUPABASE_URL or not SUPABASE_SVC_KEY:
            raise RuntimeError(
                "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env"
            )
        _client = create_client(SUPABASE_URL, SUPABASE_SVC_KEY)
        logger.info(f"✓ Supabase client initialised → {SUPABASE_URL}")
    return _client


# ── Lead Operations ───────────────────────────────────────────────────────────

def upsert_lead(lead_data: dict) -> Optional[dict]:
    """
    Insert or update an off-market lead record.

    The ON CONFLICT target is (user_id, address, zip_code) — matching
    the UNIQUE constraint in the migration.

    Args:
        lead_data: dict containing at minimum:
            user_id, address, zip_code
            + any PropStream enrichment fields

    Returns:
        The upserted record dict, or None on error.
    """
    sb = get_client()

    # Always set updated_at on upserts
    lead_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    try:
        result = (
            sb.table(TABLE_LEADS)
            .upsert(lead_data, on_conflict="user_id,address,zip_code")
            .execute()
        )
        if result.data:
            logger.info(f"✓ Lead upserted: {lead_data.get('address')}")
            return result.data[0]
        logger.warning(f"Lead upsert returned no data for {lead_data.get('address')}")
        return None
    except Exception as e:
        logger.error(f"Lead upsert failed for {lead_data.get('address')}: {e}")
        return None


def get_lead_by_address(user_id: str, address: str, zip_code: str) -> Optional[dict]:
    """Check if a lead already exists (deduplication)."""
    sb = get_client()
    try:
        result = (
            sb.table(TABLE_LEADS)
            .select("id,address,zip_code,deal_score,propstream_found")
            .eq("user_id", user_id)
            .eq("address", address)
            .eq("zip_code", zip_code)
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else None
    except Exception as e:
        logger.error(f"get_lead_by_address failed: {e}")
        return None


def fetch_leads_pending_enrichment(limit: int = 50) -> list[dict]:
    """
    Fetch leads that have been inserted but not yet enriched.
    Used by the PropStream worker to pull its queue.
    """
    sb = get_client()
    try:
        result = (
            sb.table(TABLE_LEADS)
            .select("id,user_id,address,city,state,zip_code,county")
            .eq("propstream_found", False)
            .is_("propstream_error", None)
            .order("created_at", desc=False)
            .limit(limit)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error(f"fetch_leads_pending_enrichment failed: {e}")
        return []


# ── Watchlist Matching ────────────────────────────────────────────────────────

def fetch_active_watchlists() -> list[dict]:
    """Return all active watchlists across all users (service role needed)."""
    sb = get_client()
    try:
        result = (
            sb.table(TABLE_WATCHLISTS)
            .select("*")
            .eq("is_active", True)
            .execute()
        )
        return result.data or []
    except Exception as e:
        logger.error(f"fetch_active_watchlists failed: {e}")
        return []


def match_lead_to_watchlists(lead: dict) -> list[str]:
    """
    Compare a freshly enriched lead against all active watchlists.
    Inserts matching pairs into watchlist_leads.

    Returns:
        List of watchlist IDs that matched.
    """
    sb         = get_client()
    watchlists = fetch_active_watchlists()
    matched    = []

    for wl in watchlists:
        criteria = wl.get("criteria", {})

        # Criteria checks — all must pass if set
        if criteria.get("equity_min") is not None:
            eq = lead.get("estimated_equity") or 0
            if eq < criteria["equity_min"]:
                continue

        if criteria.get("deal_types"):
            if lead.get("deal_type") not in criteria["deal_types"]:
                continue

        if criteria.get("counties"):
            if lead.get("county", "").lower() not in [c.lower() for c in criteria["counties"]]:
                continue

        if criteria.get("min_deal_score") is not None:
            if (lead.get("deal_score") or 0) < criteria["min_deal_score"]:
                continue

        if criteria.get("max_open_liens") is not None:
            liens = lead.get("open_liens") or 0
            if liens > criteria["max_open_liens"]:
                continue

        if criteria.get("owner_types"):
            if lead.get("owner_type") not in criteria["owner_types"]:
                continue

        if criteria.get("min_years_owned") is not None:
            years = lead.get("years_owned") or 0
            if years < criteria["min_years_owned"]:
                continue

        if criteria.get("distress_signals"):
            lead_signals = set(lead.get("distress_signals") or [])
            required     = set(criteria["distress_signals"])
            if not required.intersection(lead_signals):
                continue

        # ✓ All criteria passed — record the match
        try:
            sb.table(TABLE_WL_LEADS).upsert(
                {
                    "watchlist_id": wl["id"],
                    "lead_id":      lead["id"],
                    "matched_at":   datetime.now(timezone.utc).isoformat(),
                    "notified":     False,
                },
                on_conflict="watchlist_id,lead_id",
            ).execute()
            matched.append(wl["id"])
            logger.info(f"  Watchlist match: '{wl['name']}' ← {lead.get('address')}")
        except Exception as e:
            logger.error(f"  Failed to insert watchlist_lead: {e}")

    return matched


# ── Pipeline Operations ───────────────────────────────────────────────────────

def add_to_pipeline(user_id: str, lead_id: str, stage: str = "new") -> Optional[dict]:
    """Add a lead to the off-market pipeline for a user."""
    sb = get_client()
    try:
        result = (
            sb.table(TABLE_PIPELINE)
            .upsert(
                {
                    "user_id":      user_id,
                    "lead_id":      lead_id,
                    "stage":        stage,
                    "activity_log": [
                        {
                            "at":     datetime.now(timezone.utc).isoformat(),
                            "action": "added",
                            "to":     stage,
                        }
                    ],
                },
                on_conflict="user_id,lead_id",
            )
            .execute()
        )
        return result.data[0] if result.data else None
    except Exception as e:
        logger.error(f"add_to_pipeline failed: {e}")
        return None


# ── Quick Smoke Test ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("Testing BidWise Supabase connection...")
    try:
        sb = get_client()
        result = sb.table(TABLE_LEADS).select("id").limit(1).execute()
        logger.info(f"✓ Connection OK — off_market_leads table reachable. Rows: {len(result.data)}")
    except Exception as e:
        logger.error(f"✗ Connection failed: {e}")
        logger.info(
            "Make sure you have run the migration at:\n"
            "  web/supabase/migrations/001_off_market_leads.sql\n"
            "and that NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are in your .env"
        )
