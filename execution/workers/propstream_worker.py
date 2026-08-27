import time
import uuid
import sys
from datetime import datetime, timezone
from loguru import logger

from execution.enrichment.propstream_enricher import PropStreamEnricher
from execution.db.supabase_client import (
    fetch_leads_pending_enrichment,
    upsert_lead,
    match_lead_to_watchlists
)

# Set up logging
logger.add(sys.stdout, colorize=True, format="<green>{time}</green> <level>{message}</level>", level="INFO")

def calculate_deal_score(data: dict) -> tuple[int, str, list[str]]:
    """
    Calculate deal score (0-100), deal type, and extract distress signals.
    """
    score = 50  # base score
    signals = []
    
    # 1. Equity
    equity = data.get("estimated_equity")
    equity_tier = "UNKNOWN"
    if equity is not None:
        if equity < 0:
            equity_tier = "UNDERWATER"
            score -= 50
        elif equity < 30_000:
            equity_tier = "LOW_EQUITY"
        elif equity < 100_000:
            equity_tier = "MED_EQUITY"
            score += 15
        else:
            equity_tier = "HIGH_EQUITY"
            score += 30

    # 2. Absentee Owner
    owner_type = data.get("owner_type", "")
    if owner_type and owner_type.lower() == "absentee owner":
        score += 20
        signals.append("absentee_owner")

    # 3. Foreclosure / NOD
    foreclosure = data.get("foreclosure_status", "")
    if foreclosure and foreclosure.lower() not in ["none", "", "n/a"]:
        score += 25
        if "lis pendens" in foreclosure.lower():
            signals.append("lis_pendens")
        else:
            signals.append("foreclosure")

    # 4. Open Liens
    liens = data.get("open_liens")
    if liens and isinstance(liens, int) and liens > 0:
        score += 10
        signals.append("open_liens")
        if liens > 3:
            score -= 10

    # 5. Years Owned
    years = data.get("years_owned")
    if years and isinstance(years, int) and years > 10:
        score += 10
        signals.append("long_held")

    # 6. Listing Status
    listing = data.get("listing_status", "")
    if listing and listing.lower() not in ["none", "", "n/a"]:
        score += 5
        signals.append("listed")

    # Clamp score
    score = max(0, min(100, score))

    # Deal Type Classification (Heuristic)
    deal_type = "unknown"
    if equity_tier in ["HIGH_EQUITY", "MED_EQUITY"] and "absentee_owner" in signals:
        deal_type = "wholesale"
    elif equity_tier == "HIGH_EQUITY" and "foreclosure" in signals:
        deal_type = "flip"
    elif "long_held" in signals and "absentee_owner" in signals:
        deal_type = "rental"
    elif score > 70:
        deal_type = "flip"
    elif "lis_pendens" in signals or "open_liens" in signals:
        deal_type = "distressed"

    data["equity_tier"] = equity_tier

    return score, deal_type, signals


def run_worker_batch(batch_size: int = 50):
    """
    Pulls pending leads, enriches them, scores them, and pushes back to Supabase.
    """
    logger.info("Checking for pending off-market leads...")
    pending_leads = fetch_leads_pending_enrichment(limit=batch_size)

    if not pending_leads:
        logger.info("No pending leads found in Supabase.")
        return

    logger.info(f"Found {len(pending_leads)} pending leads. Starting PropStream session...")
    
    enricher = PropStreamEnricher()
    batch_id = str(uuid.uuid4())
    
    try:
        enricher.start_session()
        enricher.login()
        
        for i, lead in enumerate(pending_leads, 1):
            address = lead.get("address", "")
            city = lead.get("city", "")
            state = lead.get("state", "GA")
            zip_code = lead.get("zip_code", "")
            
            logger.info(f"[{i}/{len(pending_leads)}] Enriching: {address}, {city}")
            
            try:
                ps_data = enricher.enrich_property(
                    address=address,
                    city=city,
                    state=state,
                    zip_code=zip_code
                )
                
                # Merge original lead info with enriched data
                updated_lead = {**lead, **ps_data}
                updated_lead["batch_id"] = batch_id
                updated_lead["propstream_enriched_at"] = datetime.now(timezone.utc).isoformat()
                
                if updated_lead.get("propstream_found"):
                    score, deal_type, signals = calculate_deal_score(updated_lead)
                    updated_lead["deal_score"] = score
                    updated_lead["deal_type"] = deal_type
                    updated_lead["distress_signals"] = signals
                else:
                    updated_lead["deal_score"] = 0
                    updated_lead["deal_type"] = "unknown"
                    updated_lead["distress_signals"] = []
                    updated_lead["equity_tier"] = "UNKNOWN"

                # Strip keys not in DB schema
                safe_lead = {
                    k: v for k, v in updated_lead.items()
                    if k in [
                        "id", "user_id", "address", "city", "state", "zip_code", "county",
                        "estimated_equity", "mortgage_balance", "owner_type", "years_owned",
                        "open_liens", "foreclosure_status", "listing_status", "last_sold_price",
                        "last_sold_date", "assessed_value", "tax_amount", "propstream_found",
                        "equity_tier", "deal_score", "deal_type", "distress_signals",
                        "propstream_enriched_at", "propstream_error", "source", "batch_id"
                    ]
                }
                
                logger.info(f"  -> Score: {safe_lead.get('deal_score')} | Type: {safe_lead.get('deal_type')}")
                
                # Write to Supabase
                upserted = upsert_lead(safe_lead)
                if upserted:
                    # Trigger watchlist matching
                    matched_ids = match_lead_to_watchlists(upserted)
                    if matched_ids:
                        logger.info(f"  -> Matched {len(matched_ids)} watchlists")
                        
            except Exception as e:
                logger.error(f"  -> Enrichment failed: {e}")
                error_lead = {
                    "id": lead["id"],
                    "user_id": lead["user_id"],
                    "address": lead["address"],
                    "zip_code": lead["zip_code"],
                    "propstream_found": False,
                    "propstream_error": str(e),
                    "propstream_enriched_at": datetime.now(timezone.utc).isoformat()
                }
                upsert_lead(error_lead)
                
    except Exception as e:
        logger.error(f"Worker batch failed: {e}")
    finally:
        logger.info("Closing PropStream session...")
        enricher.close_session()
        logger.info("Worker batch complete.")


if __name__ == "__main__":
    logger.info("=== BidWise Off-Market PropStream Worker ===")
    run_worker_batch()
