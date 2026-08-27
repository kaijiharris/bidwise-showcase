import os
import re
import time
import requests
from pathlib import Path
from typing import List, Dict, Optional
from datetime import datetime
import pypdf
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options

# Logger
import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("CobbScraper")

class CobbScraper:
    """
    Scraper for Cobb County Tax Commissioner tax sale lists.
    Navigates to the tax sale page, finds the latest PDF, downloads it, and parses it.
    """
    BASE_URL = "https://www.cobbtax.gov"
    TAX_SALE_PAGE = "https://www.cobbtax.gov/property-tax/tax-sales"

    def __init__(self, cache_dir: str = ".tmp/cobb_pdfs"):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def setup_driver(self):
        """Setup Chrome driver with headless mode."""
        chrome_options = Options()
        chrome_options.add_argument('--headless')
        chrome_options.add_argument('--no-sandbox')
        chrome_options.add_argument('--disable-dev-shm-usage')
        chrome_options.add_argument('--disable-gpu')
        chrome_options.add_argument('user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        
        # Assume driver is in PATH or handled by selenium manager
        driver = webdriver.Chrome(options=chrome_options)
        return driver

    def find_latest_pdf_url(self) -> Optional[str]:
        """Finds the URL of the latest tax sale PDF."""
        driver = None
        try:
            logger.info(f"Navigating to {self.TAX_SALE_PAGE}...")
            driver = self.setup_driver()
            driver.get(self.TAX_SALE_PAGE)
            time.sleep(3) # Wait for load

            # Look for PDF links
            # Links often contain text "Tax Sale List" or "Excess Funds" or "Levy"
            links = driver.find_elements(By.TAG_NAME, 'a')
            
            pdf_links = []
            for link in links:
                href = link.get_attribute('href')
                text = link.text.lower()
                if href and (href.lower().endswith('.pdf') or 'viewer' in href):
                    if 'tax sale' in text or 'list' in text or 'levy' in text:
                        pdf_links.append(href)
                        logger.info(f"Found candidate PDF: {text} -> {href}")

            # Prioritize "current" or month names
            current_month = datetime.now().strftime("%B").lower()
            next_month = datetime.now().replace(month=datetime.now().month % 12 + 1).strftime("%B").lower()
            
            for link in pdf_links:
                if current_month in link.lower() or next_month in link.lower():
                    return link
            
            # Fallback to first likely link
            if pdf_links:
                return pdf_links[0]
                
            return None

        except Exception as e:
            logger.error(f"Error finding PDF URL: {e}")
            return None
        finally:
            if driver:
                driver.quit()

    def download_pdf(self, url: str) -> Optional[Path]:
        """Downloads the PDF from the URL."""
        if not url:
            return None
        
        try:
            filename = url.split('/')[-1]
            if not filename.endswith('.pdf'):
                 filename = f"cobb_tax_sale_{datetime.now().strftime('%Y%m%d')}.pdf"
            
            save_path = self.cache_dir / filename
            logger.info(f"Downloading {url} to {save_path}...")

            # Proper TLS verification (was verify=False).
            response = requests.get(url, stream=True, timeout=120)
            response.raise_for_status()
            
            with open(save_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            
            return save_path
        except Exception as e:
            logger.error(f"Failed to download PDF: {e}")
            return None

    def parse_pdf(self, pdf_path: Path) -> List[Dict]:
        """Parses the PDF text into property dictionaries."""
        properties = []
        try:
            logger.info(f"Parsing PDF {pdf_path}...")
            reader = pypdf.PdfReader(pdf_path)
            text = ""
            for page in reader.pages:
                text += page.extract_text() + "\n"
            
            # Parse logic (Adapted for Cobb - typically "Parcel ID" ... "Address" ... "Opening Bid")
            # This uses a regex heuristic. Adjust based on actual PDF content.
            
            # Common pattern: 
            # 17-0252-0008-048-0  (Parcel ID)
            # 2030 MAIN ST (Address)
            # $33,358.55 (Price)
            
            lines = text.split('\n')
            current_prop = {}
            
            # Regex for Parcel ID (Cobb format: 12-3456-7890 or similar)
            parcel_regex = r'\b(\d{2}[-\s]?\d{4}[-\s]?\d{3,}[-\s]?\d+)\b'
            money_regex = r'\$(\d{1,3}(?:,\d{3})*\.\d{2})'
            address_regex = r'(\d+\s+[A-Z\s]+(?:ST|RD|AVE|DR|LN|CT|PL|BLVD|HWY)[A-Z\s]*)'

            for line in lines:
                line = line.strip()
                if not line: continue
                
                # Check for new property start (Parcel ID)
                parcel_match = re.search(parcel_regex, line)
                if parcel_match:
                    # Save previous
                    if current_prop.get('tax_id'):
                        properties.append(current_prop)
                    
                    current_prop = {
                        'county': 'Cobb',
                        'tax_id': parcel_match.group(1),
                        'source_type': 'scraped_pdf'
                    }
                
                # If inside property, look for other fields
                if current_prop:
                    # Address
                    if not current_prop.get('street_name'):
                        addr_match = re.search(address_regex, line)
                        if addr_match:
                             # Parse crude address
                             full_addr = addr_match.group(1)
                             # Split number and street
                             parts = full_addr.split(' ', 1)
                             if len(parts) == 2:
                                 current_prop['house_number'] = parts[0]
                                 current_prop['street_name'] = parts[1] # Crude, refine later
                    
                    # Opening Bid / Tax Due
                    if not current_prop.get('tax_due'):
                        money_match = re.search(money_regex, line)
                        if money_match:
                            val = float(money_match.group(1).replace(',', ''))
                            current_prop['tax_due'] = val

            # Append last
            if current_prop.get('tax_id'):
                properties.append(current_prop)

        except Exception as e:
            logger.error(f"Error parsing PDF: {e}")
        
        return properties

    def scrape(self) -> List[Dict]:
        """Main execution method."""
        url = self.find_latest_pdf_url()
        if not url:
            logger.error("Could not find PDF URL.")
            return []
        
        pdf_path = self.download_pdf(url)
        if not pdf_path:
            return []
        
        data = self.parse_pdf(pdf_path)
        logger.info(f"Scraped {len(data)} properties.")
        return data

if __name__ == "__main__":
    scraper = CobbScraper()
    data = scraper.scrape()
    import json
    print(json.dumps(data, indent=2))
