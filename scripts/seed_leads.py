import sys
import uuid
import random
from pathlib import Path

# scripts/ lives one level below the project root; make `execution` importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from execution.db.supabase_client import get_client

def seed_leads():
    sb = get_client()
    
    # Need a valid user ID from the database
    res = sb.auth.admin.list_users()
    if not res:
        print("No users found.")
        return
        
    user_id = res[0].id
    
    print(f"Using user_id: {user_id}")
    
    leads = [
        {
            "user_id": user_id,
            "address": "456 Oak Tree Lane",
            "city": "Decatur",
            "state": "GA",
            "zip_code": "30030",
            "county": "dekalb",
            "estimated_equity": 185000,
            "mortgage_balance": 150000,
            "owner_type": "Absentee Owner",
            "years_owned": 14,
            "open_liens": 0,
            "foreclosure_status": "Lis Pendens",
            "listing_status": "None",
            "last_sold_price": 200000,
            "last_sold_date": "2010-05-15",
            "propstream_found": True,
            "equity_tier": "HIGH_EQUITY",
            "deal_score": 85,
            "deal_type": "wholesale",
            "distress_signals": ["absentee_owner", "lis_pendens", "long_held"],
        },
        {
            "user_id": user_id,
            "address": "789 Pine Street",
            "city": "Atlanta",
            "state": "GA",
            "zip_code": "30305",
            "county": "fulton",
            "estimated_equity": 45000,
            "mortgage_balance": 400000,
            "owner_type": "Owner Occupied",
            "years_owned": 3,
            "open_liens": 2,
            "foreclosure_status": "None",
            "listing_status": "None",
            "propstream_found": True,
            "equity_tier": "MED_EQUITY",
            "deal_score": 65,
            "deal_type": "distressed",
            "distress_signals": ["open_liens"],
        },
        {
            "user_id": user_id,
            "address": "101 Elm Blvd",
            "city": "Lawrenceville",
            "state": "GA",
            "zip_code": "30043",
            "county": "gwinnett",
            "propstream_found": False,
        }
    ]
    
    for lead in leads:
        try:
            res = sb.table("off_market_leads").upsert(lead, on_conflict="user_id,address,zip_code").execute()
            print(f"Inserted: {lead['address']}")
        except Exception as e:
            print(f"Error inserting {lead['address']}: {e}")

if __name__ == "__main__":
    seed_leads()
