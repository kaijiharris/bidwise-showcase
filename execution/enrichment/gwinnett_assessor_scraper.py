"""
Gwinnett County Property Assessor Scraper (qPublic Portal).

Provides ACCURATE property data by scraping official county records.
This is the most reliable source for property characteristics.
"""
import re
import time
import logging
from typing import Dict, Optional
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, NoSuchElementException


class GwinnettAssessorScraper:
    """
    Scrapes Gwinnett County Property Assessor (qPublic) for accurate property data.

    Official source: https://www.gwinnettassessor.com or qPublic portal
    """

    BASE_URL = "https://qpublic.schneidercorp.com/Application.aspx?AppID=789&LayerID=14888&PageTypeID=2&PageID=6396"
    SEARCH_BY_PARCEL_URL = "https://qpublic.schneidercorp.com/Application.aspx?AppID=789&LayerID=14888&PageTypeID=4&PageID=6397&KeyValue="

    def __init__(self, headless: bool = True):
        """Initialize scraper."""
        self.logger = logging.getLogger(__name__)
        self.headless = headless
        self.driver = None

    def _setup_driver(self):
        """Setup Chrome WebDriver with optimized settings."""
        chrome_options = Options()

        if self.headless:
            chrome_options.add_argument('--headless=new')

        # Performance optimizations
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('--disable-images')  # Faster loading
        chrome_options.add_argument('--disable-extensions')
        chrome_options.add_argument('--disable-logging')
        chrome_options.add_argument('--log-level=3')

        # User agent
        chrome_options.add_argument(
            'user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        )

        return webdriver.Chrome(options=chrome_options)

    def get_property_details(self, parcel_id: str) -> Optional[Dict]:
        """
        Scrape property details from Gwinnett Assessor by parcel ID.

        Args:
            parcel_id: Parcel ID (e.g., "R5329 047")

        Returns:
            Dict with property details or None if not found
        """
        if not self.driver:
            self.driver = self._setup_driver()

        try:
            # Normalize parcel ID (remove spaces, dashes)
            normalized_id = parcel_id.strip().replace(' ', '').replace('-', '')

            # Build search URL
            search_url = f"{self.SEARCH_BY_PARCEL_URL}{normalized_id}"
            self.logger.info(f"Fetching property data for parcel: {parcel_id}")
            self.logger.debug(f"URL: {search_url}")

            # Navigate to property page
            self.driver.get(search_url)
            time.sleep(2)  # Allow page to load

            # Extract property data
            property_data = {
                'parcel_id': parcel_id,
                'normalized_parcel_id': normalized_id,
                'source': 'gwinnett_assessor_qpublic'
            }

            # Try to extract various fields
            property_data.update(self._extract_property_info())
            property_data.update(self._extract_building_info())
            property_data.update(self._extract_address_info())
            property_data.update(self._extract_valuation_info())

            # Validate we got meaningful data
            if not any([
                property_data.get('property_address'),
                property_data.get('property_type'),
                property_data.get('assessed_value')
            ]):
                self.logger.warning(f"No meaningful data found for parcel: {parcel_id}")
                return None

            self.logger.info(
                f"Successfully scraped {parcel_id}: "
                f"{property_data.get('property_type', 'Unknown')} - "
                f"{property_data.get('sqft', 'N/A')} sqft"
            )

            return property_data

        except TimeoutException:
            self.logger.error(f"Timeout loading property page for {parcel_id}")
            return None

        except Exception as e:
            self.logger.error(f"Error scraping property {parcel_id}: {e}")
            import traceback
            traceback.print_exc()
            return None

    def _extract_property_info(self) -> Dict:
        """Extract basic property information."""
        data = {}

        try:
            # Look for property class/type
            # qPublic typically has these in tables or spans
            property_class = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'Property Class')]/following-sibling::td[1]"
            )
            if property_class:
                data['property_class'] = property_class
                data['property_type'] = self._classify_property_type(property_class)

            # City/Municipality
            city = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'City')]/following-sibling::td[1]"
            )
            if city:
                data['city'] = city.strip()

            # District
            district = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'District')]/following-sibling::td[1]"
            )
            if district:
                data['district'] = district.strip()

        except Exception as e:
            self.logger.debug(f"Error extracting property info: {e}")

        return data

    def _extract_building_info(self) -> Dict:
        """Extract building characteristics."""
        data = {}

        try:
            # Square footage
            sqft_text = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'Total Living Area') or contains(text(),'Building Area')]/following-sibling::td[1]"
            )
            if sqft_text:
                sqft = self._parse_number(sqft_text)
                if sqft:
                    data['sqft'] = sqft

            # Year built
            year_text = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'Year Built')]/following-sibling::td[1]"
            )
            if year_text:
                year = self._parse_number(year_text)
                if year and 1800 < year < 2030:
                    data['year_built'] = year

            # Bedrooms
            beds_text = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'Bedrooms') or contains(text(),'Beds')]/following-sibling::td[1]"
            )
            if beds_text:
                beds = self._parse_number(beds_text)
                if beds:
                    data['bedrooms'] = beds

            # Bathrooms
            baths_text = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'Bathrooms') or contains(text(),'Baths')]/following-sibling::td[1]"
            )
            if baths_text:
                baths = self._parse_number(baths_text, allow_float=True)
                if baths:
                    data['bathrooms'] = baths

            # Lot size / Acreage
            acres_text = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'Acres') or contains(text(),'Lot Size')]/following-sibling::td[1]"
            )
            if acres_text:
                acres = self._parse_number(acres_text, allow_float=True)
                if acres:
                    data['lot_acres'] = acres

        except Exception as e:
            self.logger.debug(f"Error extracting building info: {e}")

        return data

    def _extract_address_info(self) -> Dict:
        """Extract address information."""
        data = {}

        try:
            # Property address
            address = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'Property Address')]/following-sibling::td[1]"
            )
            if address:
                data['property_address'] = address.strip()

            # Mailing address
            mailing = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'Mailing Address')]/following-sibling::td[1]"
            )
            if mailing:
                data['mailing_address'] = mailing.strip()

        except Exception as e:
            self.logger.debug(f"Error extracting address info: {e}")

        return data

    def _extract_valuation_info(self) -> Dict:
        """Extract property valuation information."""
        data = {}

        try:
            # Assessed value
            assessed = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'Assessed Value') or contains(text(),'Total Value')]/following-sibling::td[1]"
            )
            if assessed:
                value = self._parse_currency(assessed)
                if value:
                    data['assessed_value'] = value

            # Market value
            market = self._safe_get_text(
                By.XPATH,
                "//td[contains(text(),'Market Value') or contains(text(),'Fair Market')]/following-sibling::td[1]"
            )
            if market:
                value = self._parse_currency(market)
                if value:
                    data['market_value'] = value

        except Exception as e:
            self.logger.debug(f"Error extracting valuation info: {e}")

        return data

    def _safe_get_text(self, by: By, selector: str, timeout: int = 5) -> Optional[str]:
        """Safely get text from element."""
        try:
            element = WebDriverWait(self.driver, timeout).until(
                EC.presence_of_element_located((by, selector))
            )
            return element.text
        except (TimeoutException, NoSuchElementException):
            return None

    def _classify_property_type(self, property_class: str) -> str:
        """Classify property type from property class."""
        pc_upper = property_class.upper()

        if any(x in pc_upper for x in ['RESIDENTIAL', 'SINGLE FAMILY', 'CONDO', 'TOWNHOUSE']):
            return 'residential'
        elif any(x in pc_upper for x in ['COMMERCIAL', 'OFFICE', 'RETAIL', 'INDUSTRIAL']):
            return 'commercial'
        elif any(x in pc_upper for x in ['VACANT', 'LAND', 'LOT', 'AGRICULTURAL']):
            return 'land'
        else:
            return 'unknown'

    def _parse_number(self, text: str, allow_float: bool = False) -> Optional[float]:
        """Parse number from text."""
        try:
            # Remove commas, dollar signs, etc.
            cleaned = re.sub(r'[^\d.]', '', text)
            if not cleaned:
                return None

            value = float(cleaned) if allow_float else int(float(cleaned))
            return value
        except (ValueError, AttributeError):
            return None

    def _parse_currency(self, text: str) -> Optional[float]:
        """Parse currency value from text."""
        try:
            # Remove $, commas
            cleaned = text.replace('$', '').replace(',', '').strip()
            return float(cleaned)
        except (ValueError, AttributeError):
            return None

    def close(self):
        """Close the WebDriver."""
        if self.driver:
            self.driver.quit()
            self.driver = None

    def __enter__(self):
        """Context manager entry."""
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Context manager exit."""
        self.close()
