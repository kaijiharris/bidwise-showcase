import requests
import re
import pdfplumber
import pandas as pd
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime
from bs4 import BeautifulSoup
from .base_adapter import CountyAdapter
from execution.utils.http_client import http_get

class GwinnettAdapter(CountyAdapter):
    """
    Adapter for Gwinnett County, GA.
    Source: https://www.gwinnetttaxcommissioner.com/property-tax/delinquent_tax/tax-liens-tax-sales
    Format: PDF (Monthly tax sale lists)
    """

    BASE_URL = "https://www.gwinnetttaxcommissioner.com"
    TAX_SALE_PAGE = f"{BASE_URL}/property-tax/delinquent_tax/tax-liens-tax-sales"

    def __init__(self, cache_dir: str = ".tmp/gwinnett_pdfs"):
        super().__init__("Gwinnett", cache_dir)
        Path(cache_dir).mkdir(parents=True, exist_ok=True)

    def fetch_data(self) -> List[Dict]:
        """
        Downloads and parses the Gwinnett County tax sale PDF.
        """
        self.logger.info("Starting fetch_data for Gwinnett County...")

        # 1. Find the current/upcoming tax sale PDF URL
        pdf_url = self._find_tax_sale_pdf()
        if not pdf_url:
            self.logger.error("Could not find tax sale PDF URL")
            return []

        # 2. Download
        pdf_path = self._download_pdf(pdf_url)
        if not pdf_path:
            return []

        # 3. Parse
        return self._parse_pdf(pdf_path)

    def _find_tax_sale_pdf(self) -> Optional[str]:
        """
        Scrapes the tax sale page to find the latest tax sale PDF link.
        """
        try:
            self.logger.info(f"Navigating to {self.TAX_SALE_PAGE}...")
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            # Retry/backoff + proper TLS verification (was verify=False, no retry).
            resp = http_get(self.TAX_SALE_PAGE, headers=headers, timeout=30)
            if resp.status_code != 200:
                self.logger.warning(f"Failed to fetch page, status: {resp.status_code}")
                return None

            soup = BeautifulSoup(resp.text, 'html.parser')

            # Look for links containing "list of properties" or similar
            # Based on WebFetch, the link format is: /documents/d/egov/march-2026-tax-sale-web-list-020226?download=true
            candidates = []

            for link in soup.find_all('a'):
                href = link.get('href', '')
                text = link.get_text().strip().lower()

                # Look for tax sale list links
                if 'tax sale' in text and 'list' in text:
                    if href.startswith('/'):
                        href = self.BASE_URL + href
                    # Prioritize upcoming sales over results
                    priority = 1 if 'result' not in text else 2
                    candidates.append((priority, text, href))
                    self.logger.info(f"Found candidate: {text} -> {href}")

                # Also look for direct document links
                if '/documents/d/' in href and 'tax-sale' in href:
                    if href.startswith('/'):
                        href = self.BASE_URL + href
                    # Ensure download=true parameter
                    if '?download=true' not in href:
                        href += '?download=true' if '?' not in href else '&download=true'
                    # Prioritize upcoming sales (with year in filename) over results
                    priority = 1 if 'result' not in href.lower() and '2026' in href else 2
                    candidates.append((priority, text, href))
                    self.logger.info(f"Found document link: {text} -> {href} (priority: {priority})")

            if not candidates:
                self.logger.warning("No tax sale PDF links found")
                return None

            # Sort by priority (lower = better) and return the best match
            candidates.sort(key=lambda x: x[0])
            self.logger.info(f"Selected PDF: {candidates[0][2]}")
            return candidates[0][2]

        except Exception as e:
            self.logger.error(f"Error finding PDF: {e}")
            import traceback
            traceback.print_exc()
            return None

    def _download_pdf(self, url: str) -> Optional[Path]:
        """
        Downloads the PDF from the given URL.
        """
        try:
            filename = f"gwinnett_tax_sale_{datetime.now().strftime('%Y%m%d')}.pdf"
            save_path = Path(self.cache_dir) / filename
            self.logger.info(f"Downloading {url} to {save_path}...")

            headers = {
                'User-Agent': 'Mozilla/5.0'
            }
            # Retry/backoff + proper TLS verification (was verify=False, no retry).
            response = http_get(url, stream=True, headers=headers, timeout=120)
            response.raise_for_status()

            with open(save_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)

            self.logger.info(f"Downloaded successfully: {save_path}")
            return save_path

        except Exception as e:
            self.logger.error(f"Download failed: {e}")
            import traceback
            traceback.print_exc()
            return None

    def _parse_pdf(self, pdf_path: Path) -> List[Dict]:
        """
        Parses the Gwinnett County tax sale PDF.

        Expected format (based on similar GA counties):
        - Parcel ID (format: XX-XXX-XX-XXX or similar)
        - Property address
        - Tax amount due
        - Property owner name
        """
        properties = []
        try:
            with pdfplumber.open(pdf_path) as pdf:
                self.logger.info(f"Opened PDF with {len(pdf.pages)} pages.")

                # Gwinnett County parcel ID patterns (Georgia standard):
                # Format: R followed by numbers and dashes (e.g., R7230 023 or similar)
                # Can also be: XX-XXX-XX-XXX (district-landlot-block-parcel)
                id_pattern = re.compile(r'\b(R?[\d]{4,5}[\s-]?\d{3}[\s-]?\d{0,3})\b')

                # Alternative pattern for more structured IDs
                structured_id_pattern = re.compile(r'\b(\d{2}[-\s]\d{3}[-\s]\d{2}[-\s]\d{3})\b')

                # Money pattern
                money_pattern = re.compile(r'\$?([\d]{1,3}(?:,\d{3})*\.?\d{0,2})')

                # Address pattern (basic)
                address_pattern = re.compile(r'\b\d+\s+[A-Z][A-Za-z\s]+(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|CT|COURT|WAY|BLVD|BOULEVARD|CIR|CIRCLE|PL|PLACE)\b', re.IGNORECASE)

                for page_num, page in enumerate(pdf.pages):
                    text = page.extract_text()
                    if not text:
                        continue

                    self.logger.debug(f"Processing page {page_num + 1}")
                    lines = text.split('\n')

                    # Gwinnett format is:
                    # Line i:   [ADDRESS] [AMOUNT]
                    # Line i+1: [PARCEL_ID] [OWNER_NAME]
                    # So we need to look ahead

                    i = 0
                    while i < len(lines):
                        line = lines[i].strip()

                        # Skip empty lines and headers
                        if not line or any(x in line.upper() for x in ['PIN', 'OWNERNAME', 'SITUS', 'AMOUNT DUE', 'PAGE', 'GWINNETT', 'TAX COMMISSIONER', 'TUESDAY']):
                            i += 1
                            continue

                        # Check if next line has a parcel ID
                        next_line = lines[i + 1].strip() if i + 1 < len(lines) else ""
                        id_match = structured_id_pattern.search(next_line) or id_pattern.search(next_line)

                        if id_match:
                            # This line has address + amount, next line has parcel ID + owner
                            # Extract amount from current line (rightmost number)
                            money_matches = money_pattern.findall(line)

                            # Extract address (everything except the last money amount)
                            addr_match = address_pattern.search(line)

                            # Create property from next line's parcel ID
                            raw_id = id_match.group(1)
                            prop = {
                                'county': 'Gwinnett',
                                'tax_id': raw_id,
                                'source': 'auto_gwinnett_pdf',
                                'raw_text': f"{line} | {next_line}"
                            }

                            # Add tax_due (last money amount on the address line)
                            if money_matches:
                                try:
                                    val_str = money_matches[-1].replace(',', '')  # Take LAST amount (rightmost)
                                    val = float(val_str)
                                    if val > 10:
                                        prop['tax_due'] = val
                                except:
                                    pass

                            # Add address
                            if addr_match:
                                prop['address'] = addr_match.group(0).strip()
                            else:
                                # If no standard address pattern, use the part before the amount
                                if money_matches:
                                    # Split on the last money amount and take the part before it
                                    parts = line.rsplit(money_matches[-1], 1)
                                    if parts[0].strip():
                                        prop['address'] = parts[0].strip()

                            properties.append(prop)
                            i += 2  # Skip the next line since we already processed it
                        else:
                            i += 1

            self.logger.info(f"Parsed {len(properties)} properties from PDF.")

        except Exception as e:
            self.logger.error(f"PDF parsing error: {e}")
            import traceback
            traceback.print_exc()

        return properties
