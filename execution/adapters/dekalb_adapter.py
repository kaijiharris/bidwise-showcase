import requests
import re
import pdfplumber
import pandas as pd
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime
from .base_adapter import CountyAdapter
from execution.utils.http_client import http_get

class DeKalbAdapter(CountyAdapter):
    """
    Adapter for DeKalb County, GA.
    Source: https://dekalbtax.org/wp-content/uploads/delinquent-property-tax-list.pdf
    """
    
    # Direct link found during research
    PDF_URL = "https://dekalbtax.org/wp-content/uploads/delinquent-property-tax-list.pdf"

    def __init__(self, cache_dir: str = ".tmp/dekalb_pdfs"):
        super().__init__("DeKalb", cache_dir)
        Path(cache_dir).mkdir(parents=True, exist_ok=True)

    def fetch_data(self) -> List[Dict]:
        """
        Downloads and parses the DeKalb tax sale PDF.
        """
        self.logger.info("Starting fetch_data for DeKalb County...")
        
        # 1. Download
        pdf_path = self._download_pdf(self.PDF_URL)
        if not pdf_path:
            return []

        # 2. Parse
        return self._parse_pdf(pdf_path)

    def _download_pdf(self, url: str) -> Optional[Path]:
        try:
            filename = "dekalb_tax_list.pdf"
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
            
            return save_path
        except Exception as e:
            self.logger.error(f"Download failed: {e}")
            return None

    def _parse_pdf(self, pdf_path: Path) -> List[Dict]:
        properties = []
        try:
            with pdfplumber.open(pdf_path) as pdf:
                self.logger.info(f"Opened PDF with {len(pdf.pages)} pages.")
                
                # Regex for DeKalb
                # Looking for Parcel ID (e.g. 15 250 02 006 or 18-032-...)
                # And Money ($...)
                
                # DeKalb ID often: 15 123 45 678 (space separated) or with dashes
                # Pattern: \d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{3}
                id_pattern = re.compile(r'\b(\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{3})\b')
                money_pattern = re.compile(r'\$(\d{1,3}(?:,\d{3})*\.\d{2})')
                
                for i, page in enumerate(pdf.pages):
                    text = page.extract_text()
                    if not text: continue
                    
                    lines = text.split('\n')
                    for line in lines:
                        # Skip headers/footers often containing "Page", "Date"
                        if "PAGE" in line.upper() or "RUN DATE" in line.upper():
                            continue
                            
                        # Find ID
                        id_match = id_pattern.search(line)
                        if id_match:
                            raw_id = id_match.group(1)
                            # Normalize ID
                            norm_id = re.sub(r'[\s-]', '', raw_id) 
                            # DeKalb often formatted as 15-123-45-678 (11-12 digits? No 10 digits usually)
                            # Wait, 2 nums, 3 nums, 2 nums, 3 nums = 10 digits?
                            # 15 123 45 678 -> 10 digits.
                            # Standard format: District-LandLot-Block-Lot
                            
                            prop = {
                                'county': 'DeKalb',
                                'tax_id': raw_id,
                                'source': 'auto_dekalb_pdf',
                                'raw_text': line.strip()
                            }
                            
                            # Find Price in same line
                            money_match = money_pattern.search(line)
                            if money_match:
                                val = float(money_match.group(1).replace(',', ''))
                                prop['tax_due'] = val
                            
                            # Find Address candidates
                            # Remove known parts (ID, Money) and see what's left
                            # This is heuristic.
                            # Often address is between Name and Price.
                            # For now, rely on Gemini to parse 'raw_text' or extract simple address.
                            
                            properties.append(prop)
                            
            self.logger.info(f"Parsed {len(properties)} properties using pdfplumber.")
            
        except Exception as e:
            self.logger.error(f"pdfplumber parsing error: {e}")

        return properties
