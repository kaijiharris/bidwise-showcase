"""
Fulton County Tax Sale PDF Scraper

Scrapes property listings from Fulton County Sheriff's tax sale PDFs.
These PDFs are published monthly at:
https://fultoncountyga.gov/inside-fulton-county/fulton-county-departments/sheriff/tax-sales

Typical PDF structure:
- Page 1: Header with auction date and instructions
- Pages 2+: Property listings with:
  - Parcel ID
  - Owner name
  - Property address
  - Tax amount / Minimum bid
  - Legal description
"""
import re
import requests
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime
from loguru import logger
import pypdf
from io import BytesIO


class FultonPDFScraper:
    """
    Scraper for Fulton County Sheriff tax sale PDFs.
    """

    BASE_URL = "https://fultoncountyga.gov"
    TAX_SALES_URL = f"{BASE_URL}/inside-fulton-county/fulton-county-departments/sheriff/tax-sales"

    def __init__(self, cache_dir: Optional[Path] = None):
        """
        Initialize PDF scraper.

        Args:
            cache_dir: Directory to cache downloaded PDFs
        """
        self.cache_dir = cache_dir or Path(".tmp/fulton_pdfs")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.logger = logger.bind(scraper='FultonPDF')

    def download_latest_pdf(self, pdf_url: str) -> Optional[Path]:
        """
        Download a PDF from URL and save to cache.

        Args:
            pdf_url: URL to PDF file

        Returns:
            Path to downloaded PDF, or None if failed
        """
        try:
            self.logger.info(f"Downloading PDF from {pdf_url}")

            response = requests.get(pdf_url, timeout=30)
            response.raise_for_status()

            # Generate filename from URL or timestamp
            filename = pdf_url.split('/')[-1]
            if not filename.endswith('.pdf'):
                filename = f"fulton_tax_sale_{datetime.now().strftime('%Y%m%d')}.pdf"

            filepath = self.cache_dir / filename

            with open(filepath, 'wb') as f:
                f.write(response.content)

            self.logger.info(f"Downloaded PDF to {filepath}")
            return filepath

        except requests.exceptions.RequestException as e:
            self.logger.error(f"Failed to download PDF: {e}")
            return None
        except Exception as e:
            self.logger.error(f"Unexpected error downloading PDF: {e}")
            return None

    def extract_text_from_pdf(self, pdf_path: Path) -> str:
        """
        Extract all text from a PDF file.

        Args:
            pdf_path: Path to PDF file

        Returns:
            Extracted text content
        """
        try:
            self.logger.debug(f"Extracting text from {pdf_path}")

            with open(pdf_path, 'rb') as f:
                reader = pypdf.PdfReader(f)
                text = ""

                for i, page in enumerate(reader.pages):
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
                    else:
                        print(f"[WARN] Page {i+1} returned no text.")

            self.logger.info(f"Extracted {len(text)} characters from PDF")
            if len(text) > 200:
                print(f"[DEBUG] First 200 chars: {text[:200]}")
            else:
                print(f"[DEBUG] Text content: {text}")
            return text

        except Exception as e:
            self.logger.error(f"Failed to extract text from PDF: {e}")
            return ""

    def parse_properties_from_text(self, text: str) -> List[Dict]:
        """
        Parse property listings from extracted PDF text.

        Fulton County PDF format typically has:
        - Parcel ID (format: 14-XXXX-XXXX-XXX-X or similar)
        - Owner name
        - Property address
        - Tax amount

        Args:
            text: Extracted PDF text

        Returns:
            List of property dicts
        """
        properties = []

        # Split into lines
        lines = text.split('\n')

        # Patterns
        parcel_pattern = r'\b(\d{2}[A-Z\-\d]{10,})\b'  # Parcel ID pattern
        address_pattern = r'\b\d{1,5}\s+[A-Z][a-z]+.*?(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Blvd|Boulevard|Ln|Lane|Way|Ct|Court|Pl|Place|Cir|Circle)\b'
        amount_pattern = r'\$[\d,]+\.?\d*'  # Dollar amount

        current_property = {}

        for i, line in enumerate(lines):
            line = line.strip()
            if not line:
                continue

            # Check for parcel ID
            parcel_match = re.search(parcel_pattern, line)
            if parcel_match:
                # If we have a current property, save it
                if current_property.get('parcel_id'):
                    properties.append(current_property)

                # Start new property
                current_property = {
                    'parcel_id': parcel_match.group(1),
                    'source': 'Fulton County Sheriff Tax Sale',
                    'source_url': self.TAX_SALES_URL,
                    'property_type': 'Single Family',  # Default
                    'state': 'GA',
                    'county': 'Fulton'
                }

            # Check for address
            address_match = re.search(address_pattern, line, re.IGNORECASE)
            if address_match and 'address' not in current_property:
                address = address_match.group(0).strip()
                current_property['address'] = address

                # Try to extract city from following lines
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    # Common GA cities
                    cities = ['Atlanta', 'Sandy Springs', 'Roswell', 'Alpharetta', 'College Park',
                             'East Point', 'Union City', 'Fairburn', 'Palmetto', 'Hapeville']

                    for city in cities:
                        if city.lower() in next_line.lower():
                            current_property['city'] = city
                            break

                if 'city' not in current_property:
                    current_property['city'] = 'Atlanta'  # Default to Atlanta

            # Check for dollar amount (tax/bid)
            amount_match = re.search(amount_pattern, line)
            if amount_match and 'minimum_bid' not in current_property:
                amount_str = amount_match.group(0).replace('$', '').replace(',', '')
                try:
                    amount = float(amount_str)
                    if amount > 100:  # Filter noise (must be > $100)
                        current_property['minimum_bid'] = amount
                except ValueError:
                    pass

        # Add last property
        if current_property.get('parcel_id'):
            properties.append(current_property)

        self.logger.info(f"Parsed {len(properties)} properties from PDF text")
        return properties

    def normalize_properties(self, properties: List[Dict]) -> List[Dict]:
        """
        Normalize scraped properties to canonical schema.

        Args:
            properties: Raw scraped properties

        Returns:
            Normalized properties with auction_details, etc.
        """
        normalized = []

        for prop in properties:
            # Skip if missing critical fields
            if not prop.get('parcel_id') or not prop.get('address'):
                continue

            # Build normalized property
            normalized_prop = {
                'parcel_id': prop['parcel_id'],
                'address': prop['address'],
                'city': prop.get('city', 'Atlanta'),
                'state': 'GA',
                'county': 'Fulton',
                'zip_code': None,  # Not in PDF usually
                'property_type': 'Single Family',  # Default
                'bedrooms': None,  # Not in PDF
                'bathrooms': None,  # Not in PDF
                'sqft': None,  # Not in PDF
                'lot_size': None,  # Not in PDF
                'year_built': None,  # Not in PDF
                'source': prop.get('source', 'Fulton County Sheriff Tax Sale'),
                'source_url': prop.get('source_url', self.TAX_SALES_URL),
                'listing_status': 'active',
                'auction_details': {
                    'auction_date': None,  # Would need to extract from PDF header
                    'auction_type': 'tax_deed',
                    'minimum_bid': prop.get('minimum_bid', 0),
                    'platform': 'Fulton County Sheriff In-Person Auction',
                    'registration_deadline': None
                }
            }

            normalized.append(normalized_prop)

        self.logger.info(f"Normalized {len(normalized)} properties")
        return normalized

    def scrape_from_url(self, pdf_url: str) -> List[Dict]:
        """
        Complete scraping workflow from PDF URL.

        Args:
            pdf_url: URL to Fulton County tax sale PDF

        Returns:
            List of normalized property dicts
        """
        # Download PDF
        pdf_path = self.download_latest_pdf(pdf_url)
        if not pdf_path:
            return []

        # Extract text
        text = self.extract_text_from_pdf(pdf_path)
        if not text:
            return []

        # Parse properties
        properties = self.parse_properties_from_text(text)

        # Normalize
        normalized = self.normalize_properties(properties)

        return normalized

    def scrape_from_file(self, pdf_path: Path) -> List[Dict]:
        """
        Scrape from a local PDF file.

        Args:
            pdf_path: Path to local PDF file

        Returns:
            List of normalized property dicts
        """
        # Extract text
        text = self.extract_text_from_pdf(pdf_path)
        if not text:
            return []

        # Parse properties
        properties = self.parse_properties_from_text(text)

        # Normalize
        normalized = self.normalize_properties(properties)

        return normalized


def test_scraper():
    """Test the PDF scraper with a sample."""
    print("Testing Fulton County PDF Scraper...")
    print("=" * 60)

    scraper = FultonPDFScraper()

    # Note: You would need to provide an actual PDF URL or file path
    print("\nTo use this scraper:")
    print("1. Go to https://fultoncountyga.gov/.../sheriff/tax-sales")
    print("2. Find the latest PDF (e.g., 'FCSO-February-4-2025-Sales-List.pdf')")
    print("3. Get the direct PDF URL")
    print("4. Run: scraper.scrape_from_url(pdf_url)")
    print("\nOr provide a downloaded PDF file path:")
    print("   properties = scraper.scrape_from_file(Path('fulton_tax_sale.pdf'))")

    print("\n" + "=" * 60)
    print("Scraper ready for use!")


if __name__ == '__main__':
    test_scraper()
