"""Database initialization script."""
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from execution.db import db
from execution.utils import logger

def init_database():
    """Initialize database tables."""
    try:
        logger.info("Starting database initialization...")
        
        # Drop and recreate all tables
        logger.warning("Dropping existing tables to ensure clean schema...")
        db.drop_all_tables()
        db.create_all_tables()
        
        logger.info("✅ Database tables created successfully!")
        logger.info("Tables: properties, auction_details, tax_lien_details, otc_details, enrichment_data, valuation_metrics, ingestion_logs")
        
        return True
        
    except Exception as e:
        logger.error(f"❌ Database initialization failed: {e}")
        logger.error("Please check your DATABASE_URL in .env file")
        return False

if __name__ == "__main__":
    success = init_database()
    sys.exit(0 if success else 1)
