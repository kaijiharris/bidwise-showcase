from datetime import datetime
import re
import requests
import pypdf
import pandas as pd
from pathlib import Path
from typing import List, Dict, Optional
from bs4 import BeautifulSoup
from .base_adapter import CountyAdapter
from execution.utils.http_client import http_get

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
import time

class CobbAdapter(CountyAdapter):
    """
    Adapter for Cobb County, GA.
    Source: https://www.cobbtax.gov/property-tax/tax-sales
    Format: PDF (Downloadable from site)
    """
    
    BASE_URL = "https://www.cobbtax.gov"
    TAX_SALE_PAGE = "https://www.cobbtax.gov/property-tax/tax-sales"

    def __init__(self, cache_dir: str = ".tmp/cobb_pdfs"):
        super().__init__("Cobb", cache_dir)
        Path(cache_dir).mkdir(parents=True, exist_ok=True)

    def fetch_data(self) -> List[Dict]:
        """
        Orchestrates finding the PDF, downloading it, and parsing it.
        """
        self.logger.info("Starting fetch_data for Cobb County...")
        
        # 1. Find PDF URL
        # Try static request first (faster/robust)
        pdf_url = self._find_pdf_url_static()
        
        if not pdf_url:
            self.logger.info("Static search failed, trying Selenium...")
            pdf_url = self._find_pdf_url_selenium()
            
        if not pdf_url:
             self.logger.warning("Could not find PDF URL via Static or Selenium methods.")
             return []

        # 2. Download
        pdf_path = self._download_pdf(pdf_url)
        if not pdf_path:
            return []

        # 3. Parse
        return self._parse_pdf(pdf_path)

    def _setup_driver(self):
        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        # Use a real user agent
        chrome_options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
        return webdriver.Chrome(options=chrome_options)

    def _find_pdf_url_static(self) -> Optional[str]:
        """
        Tries to find the PDF URL using simple requests + BS4.
        """
        try:
            self.logger.info(f"Navigating to {self.TAX_SALE_PAGE} (Static)...")
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
            # Retry/backoff + proper TLS verification (was verify=False, no retry).
            resp = http_get(self.TAX_SALE_PAGE, headers=headers, timeout=30)
            if resp.status_code != 200:
                self.logger.warning(f"Static request failed with code {resp.status_code}")
                return None
            
            soup = BeautifulSoup(resp.text, 'html.parser')
            links = soup.find_all('a')
            
            candidates = []
            for link in links:
                href = link.get('href')
                text = link.get_text().strip().lower()
                
                if not href: continue
                
                # Normalize href
                if href.startswith('/'):
                    href = self.BASE_URL + href
                
                is_pdf = href.lower().endswith('.pdf') or 'viewer' in href.lower()
                is_tax_list = 'tax sale' in text or 'levy' in text or 'list' in text
                
                if is_pdf and is_tax_list:
                    candidates.append((text, href))
            
            self.logger.info(f"Found {len(candidates)} static candidates: {candidates}")
            
            # Filter logic (same as Selenium)
            current_month = datetime.now().strftime("%B").lower()
            next_month = datetime.now().replace(month=datetime.now().month % 12 + 1).strftime("%B").lower()
            
            for text, href in candidates:
                if current_month in text or next_month in text:
                    self.logger.info(f"Matched current/next month PDF (Static): {href}")
                    return href
            
            if candidates:
                return candidates[0][1]
                
            return None

        except Exception as e:
            self.logger.error(f"Static scrape error: {e}")
            return None

    def _find_pdf_url_selenium(self) -> Optional[str]:
        self.logger.info(f"Navigating to {self.TAX_SALE_PAGE}...")
        driver = None
        try:
            driver = self._setup_driver()
            driver.get(self.TAX_SALE_PAGE)
            time.sleep(5) # Valid wait for JS rendering
            
            # Strategy 1: Find all links and filter
            links = driver.find_elements(By.TAG_NAME, 'a')
            candidates = []
            
            for link in links:
                try:
                    href = link.get_attribute('href')
                    text = link.text.strip().lower()
                    
                    if not href: continue
                    
                    # Heuristics
                    is_pdf = href.lower().endswith('.pdf') or 'viewer' in href.lower()
                    is_tax_list = 'tax sale' in text or 'levy' in text or 'list' in text or 'excess' not in text # Avoid excess funds list
                    
                    if is_pdf:
                         candidates.append((text, href))
                except:
                    continue

            self.logger.info(f"Found {len(candidates)} candidate PDF links: {candidates}")
            
            # Filter for current/upcoming month
            current_month = datetime.now().strftime("%B").lower()
            next_month = datetime.now().replace(month=datetime.now().month % 12 + 1).strftime("%B").lower()
            
            for text, href in candidates:
                if current_month in text or next_month in text:
                    self.logger.info(f"Matched current/next month PDF: {href}")
                    return href
            
            # Return first finding if no date match
            if candidates:
                return candidates[0][1]

            return None
            
        except Exception as e:
            self.logger.error(f"Selenium error: {e}")
            return None
        finally:
            if driver: driver.quit()

    def _download_pdf(self, url: str) -> Optional[Path]:
        try:
            filename = url.split('/')[-1].split('?')[0] 
            if not filename.lower().endswith('.pdf'):
                filename = f"cobb_{datetime.now().strftime('%Y%m%d')}.pdf"
                
            save_path = Path(self.cache_dir) / filename
            self.logger.info(f"Downloading {url} to {save_path}...")
            
            # Retry/backoff + proper TLS verification (was verify=False, no retry).
            response = http_get(url, stream=True, timeout=120)
            response.raise_for_status()
            
            with open(save_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            return save_path
        except Exception as e:
            self.logger.error(f"Download failed: {e}")
            return None

    def _parse_pdf(self, pdf_path: Path) -> List[Dict]:
        """
        Parses the Cobb County PDF.
        Implments specific regex logic for Cobb's format.
        """
        properties = []
        try:
            import pypdf
            reader = pypdf.PdfReader(pdf_path)
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
            
            # Cobb Regex Pattern
            # Format often: 
            # 1. Parcel ID: 12-3456-7890
            # 2. Address: 123 MAIN ST
            # 3. Price: $10,000.00
            
            lines = text.split('\n')
            current_prop = {}
            
            parcel_regex = r'\b(\d{2}[-\s]?\d{4}[-\s]?\d{3,}[-\s]?\d+)\b'
            money_regex = r'\$(\d{1,3}(?:,\d{3})*\.\d{2})'
            
            # Simple line-by-line state machine
            for line in lines:
                line = line.strip()
                if not line: continue
                
                # Parcel ID start
                parcel_match = re.search(parcel_regex, line)
                if parcel_match:
                    if current_prop.get('tax_id'):
                        properties.append(current_prop)
                    
                    current_prop = {
                        'county': 'Cobb',
                        'tax_id': parcel_match.group(1),
                        'source': 'auto_pdf',
                        'raw_text': line # Store raw line for debugging
                    }
                
                # If we have a current property, try to fill holes
                if current_prop:
                    # Opening Bid
                    if not current_prop.get('tax_due'):
                         money_match = re.search(money_regex, line)
                         if money_match:
                             val = float(money_match.group(1).replace(',', ''))
                             current_prop['tax_due'] = val
                    
                    # Address - Heuristic: Line contains street suffix but no numbers (sometimes address is on line after Parcel)
                    # This is tricky without strict layout PDF parsing. 
                    # For now, we capture the lines immediately following Parcel ID as candidates.
                    pass 

            if current_prop.get('tax_id'):
                properties.append(current_prop)
                
        except Exception as e:
            self.logger.error(f"PDF parsing error: {e}")
            
        self.logger.info(f"Parsed {len(properties)} properties from PDF.")
        return properties
