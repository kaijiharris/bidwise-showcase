from abc import ABC, abstractmethod
from typing import List, Dict, Optional
import logging

class CountyAdapter(ABC):
    """
    Abstract base class for County Tax Sale Adapters.
    Handlers different data sources (PDF, HTML, Excel) via a unified interface.
    """

    def __init__(self, county_name: str, cache_dir: str = ".tmp"):
        self.county_name = county_name
        self.cache_dir = cache_dir
        self.logger = logging.getLogger(f"{county_name}Adapter")

    @abstractmethod
    def fetch_data(self) -> List[Dict]:
        """
        Main entry point. Fetches and normalizes data from the county source.
        Returns a list of property dictionaries in the internal schema.
        """
        pass

    def validate_data(self, data: List[Dict]) -> List[Dict]:
        """
        Optional validation of fetched data.
        """
        valid_data = []
        for item in data:
             if self._is_valid(item):
                 valid_data.append(item)
             else:
                 self.logger.warning(f"Invalid item skipped: {item}")
        return valid_data

    def _is_valid(self, item: Dict) -> bool:
        # Basic check: needs at least a tax ID or address
        return bool(item.get('tax_id') or item.get('full_address') or item.get('street_name'))
