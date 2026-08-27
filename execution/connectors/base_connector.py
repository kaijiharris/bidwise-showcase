"""Abstract base class for all data source connectors."""
from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Dict, Optional
from loguru import logger

from ..db import db, Property, IngestionLog
from ..utils import config


class BaseConnector(ABC):
    """
    Abstract base class defining the interface for all data source connectors.
    
    Each connector must implement:
    - fetch_raw_data(): Pull data from the source
    - normalize_to_canonical(): Transform to standard property format
    """
    
    def __init__(self, connector_config: Optional[Dict] = None):
        """
        Initialize connector with optional configuration.
        
        Args:
            connector_config: Connector-specific configuration dict
        """
        self.connector_config = connector_config or {}
        self.logger = logger.bind(connector=self.__class__.__name__)
        self.stats = {
            'attempted': 0,
            'succeeded': 0,
            'failed': 0,
            'errors': []
        }
    
    @abstractmethod
    def fetch_raw_data(self) -> List[Dict]:
        """
        Fetch raw data from the source.
        
        Returns:
            List of dicts containing raw property data
            
        Raises:
            Exception if fetch fails
        """
        pass
    
    @abstractmethod
    def normalize_to_canonical(self, raw_data: List[Dict]) -> List[Dict]:
        """
        Transform raw source data to canonical property schema.
        
        Must return dicts with these fields (at minimum):
        - parcel_id (required, unique)
        - address (required)
        - city, state, county, zip_code
        - property_type, bedrooms, bathrooms, sqft, year_built
        - source ('auction', 'tax_lien', 'otc')
        - source_id, source_url
        
        Args:
            raw_data: List of raw data dicts
            
        Returns:
            List of normalized property dicts
        """
        pass
    
    def ingest(self) -> Dict:
        """
        Full ingestion workflow:
        1. Fetch raw data from source
        2. Normalize to canonical format
        3. Write to database (with conflict resolution)
        4. Log ingestion results
        5. Return summary stats
        
        Returns:
            Dict with stats: {'attempted': int, 'succeeded': int, 'failed': int}
        """
        started_at = datetime.now()
        log_entry = IngestionLog(
            source=self.__class__.__name__,
            started_at=started_at,
            status='running'
        )
        
        try:
            self.logger.info(f"Starting ingestion for {self.__class__.__name__}")
            
            # Step 1: Fetch raw data
            raw_data = self.fetch_raw_data()
            self.logger.info(f"Fetched {len(raw_data)} raw records")
            
            # Step 2: Normalize
            normalized_data = self.normalize_to_canonical(raw_data)
            self.logger.info(f"Normalized {len(normalized_data)} records")
            
            # Step 3: Write to DB
            self.write_to_db(normalized_data)
            
            # Step 4: Log results
            completed_at = datetime.now()
            log_entry.completed_at = completed_at
            log_entry.status = 'success' if self.stats['failed'] == 0 else 'partial'
            log_entry.records_attempted = self.stats['attempted']
            log_entry.records_succeeded = self.stats['succeeded']
            log_entry.records_failed = self.stats['failed']
            
            self.logger.info(
                f"Ingestion complete: {self.stats['succeeded']} succeeded, "
                f"{self.stats['failed']} failed out of {self.stats['attempted']} attempted"
            )
            
            # Save log to database
            with db.get_session() as session:
                session.add(log_entry)
            
            return self.stats
            
        except Exception as e:
            self.logger.error(f"Ingestion failed: {e}", exc_info=True)
            log_entry.completed_at = datetime.now()
            log_entry.status = 'failed'
            log_entry.error_message = str(e)
            
            with db.get_session() as session:
                session.add(log_entry)
            
            raise
    
    def write_to_db(self, data: List[Dict]) -> None:
        """
        Write normalized data to database with conflict resolution.
        
        Uses upsert logic:
        - If parcel_id exists, update the record
        - If new, insert
        
        Args:
            data: List of normalized property dicts
        """
        batch_size = config.get('ingestion.batch_size', 100)
        
        with db.get_session() as session:
            for i, property_data in enumerate(data):
                self.stats['attempted'] += 1
                
                try:
                    # Check if property exists
                    existing = session.query(Property).filter_by(
                        parcel_id=property_data['parcel_id']
                    ).first()
                    
                    if existing:
                        # Update existing
                        for key, value in property_data.items():
                            setattr(existing, key, value)
                        existing.updated_at = datetime.now()
                        self.logger.debug(f"Updated property {property_data['parcel_id']}")
                    else:
                        # Insert new
                        new_property = Property(**property_data)
                        new_property.data_freshness = datetime.now()
                        session.add(new_property)
                        self.logger.debug(f"Inserted property {property_data['parcel_id']}")
                    
                    self.stats['succeeded'] += 1
                    
                    # Commit in batches
                    if (i + 1) % batch_size == 0:
                        session.flush()
                        self.logger.debug(f"Batch committed: {i + 1} records")
                        
                except Exception as e:
                    self.stats['failed'] += 1
                    self.stats['errors'].append(str(e))
                    self.logger.warning(
                        f"Failed to write property {property_data.get('parcel_id', 'unknown')}: {e}"
                    )
                    continue
    
    def validate_required_fields(self, data: Dict) -> bool:
        """
        Validate that required fields are present in normalized data.
        
        Args:
            data: Normalized property dict
            
        Returns:
            True if valid, False otherwise
        """
        required_fields = ['parcel_id', 'address', 'source']
        
        for field in required_fields:
            if field not in data or data[field] is None:
                self.logger.warning(f"Missing required field: {field}")
                return False
        
        return True
