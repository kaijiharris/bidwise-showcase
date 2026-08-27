"""
Tax Lien School Knowledge Vault Scraper

Scrapes market intelligence from vault.taxlienschool.com including:
- State-specific tax sale rules and procedures
- County-specific auction information
- Redemption periods and interest rates
- Bidding strategies and best practices
- Auction calendar events (limited to current month with free membership)
"""
import requests
from bs4 import BeautifulSoup
from typing import Dict, List, Optional
from pathlib import Path
from loguru import logger
import json
import re
from datetime import datetime


class TaxLienSchoolScraper:
    """
    Scraper for Tax Lien School Knowledge Vault educational content.

    Requires membership credentials stored in .env:
    - TAXLIEN_SCHOOL_USERNAME
    - TAXLIEN_SCHOOL_PASSWORD
    """

    BASE_URL = "https://vault.taxlienschool.com"
    LOGIN_URL = f"{BASE_URL}/login/"

    def __init__(self, username: Optional[str] = None, password: Optional[str] = None):
        """
        Initialize scraper with authentication.

        Args:
            username: Tax Lien School username (or use env var)
            password: Tax Lien School password (or use env var)
        """
        import os
        from dotenv import load_dotenv

        load_dotenv()

        self.username = username or os.getenv('TAXLIEN_SCHOOL_USERNAME')
        self.password = password or os.getenv('TAXLIEN_SCHOOL_PASSWORD')

        if not self.username or not self.password:
            raise ValueError("Tax Lien School credentials not found. Set TAXLIEN_SCHOOL_USERNAME and TAXLIEN_SCHOOL_PASSWORD in .env")

        self.session = requests.Session()
        self.logger = logger.bind(scraper='TaxLienSchool')
        self.cache_dir = Path(".tmp/taxlien_cache")
        self.cache_dir.mkdir(parents=True, exist_ok=True)

        # Login on initialization
        self._login()

    def _login(self) -> bool:
        """
        Authenticate with Tax Lien School.

        Returns:
            True if login successful
        """
        try:
            self.logger.info("Authenticating with Tax Lien School...")

            # Get login page to extract nonce/csrf token
            login_page = self.session.get(self.LOGIN_URL, timeout=10)
            soup = BeautifulSoup(login_page.content, 'html.parser')

            # Find WordPress nonce or CSRF token
            nonce = None
            nonce_input = soup.find('input', {'name': '_wpnonce'})
            if nonce_input:
                nonce = nonce_input.get('value')

            # Build login payload
            payload = {
                'log': self.username,
                'pwd': self.password,
                'wp-submit': 'Log In',
                'redirect_to': self.BASE_URL,
                'testcookie': '1'
            }

            if nonce:
                payload['_wpnonce'] = nonce

            # Submit login
            response = self.session.post(
                self.LOGIN_URL,
                data=payload,
                timeout=10,
                allow_redirects=True
            )

            # Check if logged in (look for logout link or member content)
            if 'log-out' in response.text.lower() or 'logout' in response.text.lower():
                self.logger.info("[OK] Successfully logged in")
                return True
            else:
                self.logger.warning("[WARN] Login may have failed - check credentials")
                return False

        except Exception as e:
            self.logger.error(f"Login error: {e}")
            return False

    def get_state_guide(self, state: str) -> Optional[Dict]:
        """
        Fetch comprehensive state guide with tax sale rules.

        Args:
            state: State name (e.g., "Georgia", "Florida")

        Returns:
            Dict with state-specific tax sale information
        """
        try:
            state_slug = state.lower().replace(' ', '-')
            url = f"{self.BASE_URL}/{state_slug}/"

            self.logger.info(f"Fetching state guide for {state}...")

            response = self.session.get(url, timeout=15)
            if response.status_code != 200:
                self.logger.warning(f"State guide not found: {url}")
                return None

            soup = BeautifulSoup(response.content, 'html.parser')

            # Extract main content
            article = soup.find('article') or soup.find('div', class_='entry-content')
            if not article:
                return None

            # Parse guide data
            guide_data = {
                'state': state,
                'url': url,
                'tax_sale_type': None,
                'redemption_period': None,
                'interest_rate': None,
                'bidding_process': None,
                'key_facts': [],
                'full_content': article.get_text(strip=True)[:5000]  # First 5000 chars
            }

            # Extract tax sale type from title or content
            title = soup.find('h1')
            if title:
                title_text = title.get_text()
                if 'tax deed' in title_text.lower():
                    guide_data['tax_sale_type'] = 'Tax Deed'
                elif 'tax lien' in title_text.lower():
                    guide_data['tax_sale_type'] = 'Tax Lien'
                elif 'redeemable' in title_text.lower():
                    guide_data['tax_sale_type'] = 'Redeemable Tax Deed'
                elif 'hybrid' in title_text.lower():
                    guide_data['tax_sale_type'] = 'Hybrid'

            # Extract redemption period
            redemption_patterns = [
                r'redemption period[:\s]+(\d+)\s*(month|year|day)s?',
                r'(\d+)[\s-]*(month|year|day)\s+redemption'
            ]

            text = article.get_text().lower()
            for pattern in redemption_patterns:
                match = re.search(pattern, text)
                if match:
                    guide_data['redemption_period'] = f"{match.group(1)} {match.group(2)}s"
                    break

            # Extract interest rate
            interest_patterns = [
                r'interest rate[:\s]+(\d+)%',
                r'(\d+)%\s+interest',
                r'earn up to (\d+)%'
            ]

            for pattern in interest_patterns:
                match = re.search(pattern, text)
                if match:
                    guide_data['interest_rate'] = f"{match.group(1)}%"
                    break

            # Extract key facts from lists
            lists = article.find_all(['ul', 'ol'])
            for lst in lists[:3]:  # First 3 lists
                items = lst.find_all('li')
                for item in items[:5]:  # First 5 items per list
                    fact = item.get_text(strip=True)
                    if len(fact) < 200:  # Skip overly long items
                        guide_data['key_facts'].append(fact)

            self.logger.info(f"[OK] Extracted {state} guide - Type: {guide_data['tax_sale_type']}")

            # Cache results
            cache_file = self.cache_dir / f"{state_slug}_guide.json"
            with open(cache_file, 'w') as f:
                json.dump(guide_data, f, indent=2)

            return guide_data

        except Exception as e:
            self.logger.error(f"Error fetching state guide: {e}")
            return None

    def get_county_info(self, state: str, county: str) -> Optional[Dict]:
        """
        Fetch county-specific auction information.

        Args:
            state: State name
            county: County name

        Returns:
            Dict with county-specific details
        """
        try:
            # Try direct county page
            state_slug = state.lower().replace(' ', '-')
            county_slug = county.lower().replace(' ', '-')

            possible_urls = [
                f"{self.BASE_URL}/{state_slug}/{county_slug}-county/",
                f"{self.BASE_URL}/{state_slug}/{county_slug}/",
                f"{self.BASE_URL}/county/{state_slug}/{county_slug}/"
            ]

            for url in possible_urls:
                self.logger.debug(f"Trying county URL: {url}")
                response = self.session.get(url, timeout=10)

                if response.status_code == 200:
                    soup = BeautifulSoup(response.content, 'html.parser')
                    article = soup.find('article') or soup.find('div', class_='entry-content')

                    if article:
                        return {
                            'county': county,
                            'state': state,
                            'url': url,
                            'content': article.get_text(strip=True)[:3000]
                        }

            self.logger.info(f"No specific county page found for {county}, {state}")
            return None

        except Exception as e:
            self.logger.error(f"Error fetching county info: {e}")
            return None

    def search_content(self, query: str, max_results: int = 10) -> List[Dict]:
        """
        Search Tax Lien School content for specific topics.

        Args:
            query: Search query (e.g., "Fulton County Georgia")
            max_results: Maximum results to return

        Returns:
            List of search result dicts
        """
        try:
            search_url = f"{self.BASE_URL}/?s={query.replace(' ', '+')}"

            self.logger.info(f"Searching for: {query}")
            response = self.session.get(search_url, timeout=15)

            soup = BeautifulSoup(response.content, 'html.parser')

            results = []
            articles = soup.find_all('article', limit=max_results)

            for article in articles:
                title_elem = article.find(['h2', 'h3'])
                link_elem = article.find('a', href=True)
                excerpt_elem = article.find('div', class_='entry-excerpt') or article.find('p')

                if title_elem and link_elem:
                    results.append({
                        'title': title_elem.get_text(strip=True),
                        'url': link_elem['href'],
                        'excerpt': excerpt_elem.get_text(strip=True)[:300] if excerpt_elem else ""
                    })

            self.logger.info(f"[OK] Found {len(results)} search results")
            return results

        except Exception as e:
            self.logger.error(f"Search error: {e}")
            return []

    def get_comprehensive_state_data(self, state: str) -> Dict:
        """
        Get all available data for a state (guide + search results).

        Args:
            state: State name (e.g., "Georgia")

        Returns:
            Comprehensive dict with all state data
        """
        data = {
            'state': state,
            'fetched_at': datetime.now().isoformat(),
            'state_guide': None,
            'search_results': []
        }

        # Get state guide
        guide = self.get_state_guide(state)
        if guide:
            data['state_guide'] = guide

        # Search for additional content
        search_results = self.search_content(f"{state} tax sale auction")
        data['search_results'] = search_results

        return data


def test_scraper():
    """Test the Tax Lien School scraper."""
    print("Testing Tax Lien School Scraper...")
    print("=" * 60)

    scraper = TaxLienSchoolScraper()

    print("\nTest 1: Fetching Georgia state guide...")
    ga_guide = scraper.get_state_guide("Georgia")

    if ga_guide:
        print(f"  [OK] Tax Sale Type: {ga_guide.get('tax_sale_type')}")
        print(f"  [OK] Redemption Period: {ga_guide.get('redemption_period')}")
        print(f"  [OK] Interest Rate: {ga_guide.get('interest_rate')}")
        print(f"  [OK] Key Facts: {len(ga_guide.get('key_facts', []))} items")
    else:
        print("  [WARN] Could not fetch Georgia guide")

    print("\nTest 2: Searching for Fulton County...")
    results = scraper.search_content("Fulton County Georgia")
    print(f"  [OK] Found {len(results)} search results")
    for i, result in enumerate(results[:3], 1):
        print(f"    {i}. {result['title']}")

    print("\nTest 3: Getting comprehensive Georgia data...")
    ga_data = scraper.get_comprehensive_state_data("Georgia")
    print(f"  [OK] State guide: {'Yes' if ga_data['state_guide'] else 'No'}")
    print(f"  [OK] Search results: {len(ga_data['search_results'])}")

    # Save to cache
    cache_file = Path(".tmp/taxlien_cache/georgia_comprehensive.json")
    with open(cache_file, 'w') as f:
        json.dump(ga_data, f, indent=2)
    print(f"\n[OK] Saved comprehensive data to: {cache_file}")

    print("\n" + "=" * 60)
    print("Test complete!")


if __name__ == '__main__':
    test_scraper()
