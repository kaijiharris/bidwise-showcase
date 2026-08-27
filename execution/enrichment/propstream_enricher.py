"""
PropStream Playwright Automation — GA County Enrichment
========================================================
Runs locally (headed browser) to enrich tax deed properties with PropStream data.
No public API exists — this uses browser automation against the live UI.

Targeted data for DeKalb / Cobb / Gwinnett counties:
  - Owner info (absentee flag, years owned)
  - Estimated equity & mortgage balance
  - Listing history (distress signals)
  - Open liens / judgments count
  - Foreclosure / NOD status

Usage:
    # Standalone login test:
    python -m execution.enrichment.propstream_enricher

    # Enrich a list of properties:
    from execution.enrichment.propstream_enricher import PropStreamEnricher
    enricher = PropStreamEnricher()
    results  = enricher.run_enrichment_flow(properties)  # list of dicts with address fields
"""

import os
import json
import time
import re
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Optional
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from loguru import logger


# ── Constants ─────────────────────────────────────────────────────────────────

LOGIN_URL    = "https://login.propstream.com/"
SEARCH_URL   = "https://app.propstream.com/search"
LOGIN_TIMEOUT  = 60_000   # ms — longer to allow manual Captcha/MFA solving
SEARCH_TIMEOUT = 30_000   # ms — per-property search
NAV_DELAY      = 1.5      # seconds between actions (human-like pacing)

# Session persistence — browser cookies + localStorage saved here after login.
# Next run loads this file so MFA is only triggered once per week (or when
# PropStream explicitly invalidates the session).
SESSION_STATE_DIR  = Path(os.getenv("PROPSTREAM_SESSION_DIR", ".tmp"))
SESSION_STATE_PATH = SESSION_STATE_DIR / "propstream_session.json"
SESSION_MAX_AGE_H  = 168  # 7 days — PropStream sessions typically last 1-2 weeks

# Fields we care about from the PropStream property detail panel.
# Keys are CSS selectors / text labels; values are our canonical output field names.
PROPSTREAM_FIELDS = {
    "estimated_equity":    "Estimated Equity",
    "mortgage_balance":    "Estimated Mortgage Balance",
    "owner_type":          "Owner Type",          # Absentee Owner / Owner Occupied
    "years_owned":         "Years Owned",
    "open_liens":          "Open Liens",
    "foreclosure_status":  "Foreclosure Status",  # None / Lis Pendens / Auction
    "listing_status":      "Listing Status",
    "last_sold_price":     "Last Sold Price",
    "last_sold_date":      "Last Sold Date",
    "assessed_value":      "Assessed Value",
    "tax_amount":          "Annual Tax Amount",
}


class PropStreamEnricher:
    """
    Enriches Georgia tax-deed properties with PropStream mortgage / equity / lien data.

    Design decisions:
    - Headed browser: lets the user solve any Captcha / MFA that appears.
    - Session persistence: browser stays open across the full property batch
      (avoids repeated logins).
    - Graceful degradation: if a property search returns no results, we log a
      warning and return an empty dict — the pipeline continues.
    - Rate-aware: 1.5-second delay between property searches mirrors a human
      pace and avoids rate-limiting.
    """

    def __init__(self, username: Optional[str] = None, password: Optional[str] = None):
        self.username = username or os.getenv("PROPSTREAM_USERNAME", "owner@example.com")
        self.password = password or os.getenv("PROPSTREAM_PASSWORD", "Password219$")
        self.browser = None
        self.context = None
        self.page    = None
        self._logged_in = False
        SESSION_STATE_DIR.mkdir(parents=True, exist_ok=True)

    # ── Session management ────────────────────────────────────────────────────

    def start_session(self):
        """
        Launch a headed Chromium browser.
        If a saved session exists and is < SESSION_MAX_AGE_H hours old, load it
        so the user doesn't need to solve MFA again.
        """
        self.playwright = sync_playwright().start()
        logger.info("Launching Playwright in headed mode...")
        self.browser = self.playwright.chromium.launch(headless=False, slow_mo=50)

        # Try to restore a saved session
        storage_state = self._load_session_state()
        self.context = self.browser.new_context(
            viewport={"width": 1400, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            storage_state=storage_state,  # None → fresh context
        )
        self.page = self.context.new_page()

    def login(self):
        """
        Navigate to PropStream and ensure we're logged in.

        Strategy:
          1. Navigate to the app URL directly (works if session cookie is valid).
          2. If redirected to login, fill credentials + wait for dashboard.
          3. After successful login, save the browser session state to disk
             so future runs skip MFA for up to SESSION_MAX_AGE_H hours.
        """
        logger.info("Navigating to PropStream app...")
        self.page.goto(SEARCH_URL)

        # Give PropStream a moment to redirect if session is invalid
        time.sleep(2)
        current_url = self.page.url

        if "search" in current_url:
            # Session cookie is still valid — already logged in!
            logger.info("✓ Restored session — already logged in (no MFA required).")
            self._logged_in = True
            return

        # Session expired or no cookie — do a fresh login
        logger.info("Session not active. Filling credentials...")
        try:
            self.page.wait_for_selector("input[name='username']", timeout=30_000)
            self.page.fill("input[name='username']", self.username)
            self.page.fill("input[name='password']", self.password)
            self.page.click("button[type='submit'], input[type='submit']")
        except Exception:
            logger.error("Login form not found. Saving debug artifacts...")
            self.page.screenshot(path="propstream_login_error.png")
            with open("propstream_login_debug.html", "w", encoding="utf-8") as f:
                f.write(self.page.content())
            raise

        logger.info(
            "Waiting for login to complete. "
            "If a Captcha or MFA prompt appears, solve it in the browser window..."
        )
        try:
            self.page.wait_for_url("**/search**", timeout=LOGIN_TIMEOUT)
            logger.info("✓ Login successful!")
            self._logged_in = True
            # ── Persist the session so next run skips MFA ──────────────────
            self._save_session_state()
        except PlaywrightTimeoutError:
            logger.error("Login timed out. Check the browser window for Captcha or MFA.")
            raise

    def close_session(self):
        """Save session state then cleanly close the browser."""
        if self._logged_in:
            self._save_session_state()
        if self.browser:
            self.browser.close()
        if hasattr(self, "playwright"):
            self.playwright.stop()
        self._logged_in = False

    # ── Session persistence helpers ───────────────────────────────────────────

    def _save_session_state(self):
        """
        Persist browser cookies + localStorage to disk.
        Stored as: {"saved_at": ISO-timestamp, "state": <Playwright storage state>}
        """
        try:
            state = self.context.storage_state()
            payload = {
                "saved_at": datetime.now(timezone.utc).isoformat(),
                "state":    state,
            }
            SESSION_STATE_PATH.write_text(json.dumps(payload), encoding="utf-8")
            logger.info(f"✓ Session saved to {SESSION_STATE_PATH} (valid for {SESSION_MAX_AGE_H}h).")
        except Exception as e:
            logger.warning(f"Could not save session state: {e}")

    def _load_session_state(self) -> Optional[dict]:
        """
        Load a previously saved session if it exists and is fresh enough.

        Returns the Playwright storage_state dict, or None (triggers fresh login).
        """
        if not SESSION_STATE_PATH.exists():
            logger.debug("No saved PropStream session found — will do fresh login.")
            return None

        try:
            payload   = json.loads(SESSION_STATE_PATH.read_text(encoding="utf-8"))
            saved_at  = datetime.fromisoformat(payload["saved_at"])
            age_hours = (datetime.now(timezone.utc) - saved_at).total_seconds() / 3600

            if age_hours > SESSION_MAX_AGE_H:
                logger.info(
                    f"Saved session is {age_hours:.1f}h old (max {SESSION_MAX_AGE_H}h) — "
                    "will do fresh login."
                )
                SESSION_STATE_PATH.unlink(missing_ok=True)
                return None

            logger.info(
                f"Loaded saved session ({age_hours:.1f}h old) — "
                "attempting to skip MFA..."
            )
            return payload["state"]

        except Exception as e:
            logger.warning(f"Could not load session state ({e}) — will do fresh login.")
            return None

    # ── Core enrichment ───────────────────────────────────────────────────────

    def search_property(self, address: str, city: str, state: str = "GA") -> bool:
        """
        Type an address into the PropStream search bar and wait for results.

        Returns True if a result was found, False otherwise.
        """
        search_query = f"{address}, {city}, {state}"
        logger.info(f"Searching PropStream: {search_query}")

        try:
            # The global search input is always visible in the app header
            search_input = self.page.wait_for_selector(
                "input[placeholder*='Search'], input[placeholder*='Address'], "
                "input[placeholder*='search'], input[data-testid='search-input']",
                timeout=SEARCH_TIMEOUT,
            )
            search_input.triple_click()   # clear existing text
            search_input.type(search_query, delay=60)  # human-like typing

            time.sleep(0.8)  # wait for autocomplete dropdown

            # Try to click the first autocomplete suggestion
            try:
                suggestion = self.page.wait_for_selector(
                    "[class*='suggestion']:first-child, "
                    "[class*='autocomplete'] li:first-child, "
                    "[class*='dropdown'] [class*='item']:first-child",
                    timeout=4_000,
                )
                suggestion.click()
                logger.info("  Clicked autocomplete suggestion.")
            except PlaywrightTimeoutError:
                # No autocomplete — press Enter to submit
                logger.debug("  No autocomplete dropdown, pressing Enter.")
                search_input.press("Enter")

            time.sleep(NAV_DELAY)

            # Check if a property detail panel loaded
            try:
                self.page.wait_for_selector(
                    "[class*='property-detail'], [class*='PropertyDetail'], "
                    "[class*='detail-panel'], [class*='propertyInfo']",
                    timeout=8_000,
                )
                logger.info("  ✓ Property detail panel loaded.")
                return True
            except PlaywrightTimeoutError:
                logger.warning(f"  No property detail panel for: {search_query}")
                return False

        except Exception as e:
            logger.error(f"  Search error for {search_query}: {e}")
            return False

    def extract_property_data(self, address: str) -> Dict:
        """
        Scrape the currently displayed property detail panel.

        Strategy: find all label/value pairs in the detail panel and match
        them against our PROPSTREAM_FIELDS mapping.
        """
        data = {"address": address, "propstream_found": False}

        try:
            # Get the full text content of the detail panel
            panel = self.page.query_selector(
                "[class*='property-detail'], [class*='PropertyDetail'], "
                "[class*='detail-panel'], [class*='propertyInfo']"
            )
            if not panel:
                return data

            panel_text = panel.inner_text()

            # ── Parse each field we care about ────────────────────────────
            for field_key, label in PROPSTREAM_FIELDS.items():
                # Look for "Label\nValue" or "Label: Value" patterns
                patterns = [
                    rf"{re.escape(label)}\s*\n([^\n]+)",
                    rf"{re.escape(label)}:\s*([^\n]+)",
                ]
                for pattern in patterns:
                    match = re.search(pattern, panel_text, re.IGNORECASE)
                    if match:
                        raw_value = match.group(1).strip()
                        data[field_key] = _parse_propstream_value(field_key, raw_value)
                        break

            # ── Derived signals ────────────────────────────────────────────
            data["propstream_found"]   = True
            data["is_absentee_owner"]  = data.get("owner_type", "").lower() == "absentee owner"
            data["has_foreclosure"]    = (
                data.get("foreclosure_status", "none").lower() not in ("none", "", "n/a")
            )
            data["has_open_liens"]     = (
                int(data.get("open_liens", 0) or 0) > 0
            )
            data["equity_tier"] = _classify_equity(data.get("estimated_equity"))

            logger.info(
                f"  Extracted: equity={data.get('estimated_equity')} "
                f"| owner_type={data.get('owner_type')} "
                f"| liens={data.get('open_liens')} "
                f"| foreclosure={data.get('foreclosure_status')}"
            )

        except Exception as e:
            logger.error(f"  Extraction error for {address}: {e}")

        return data

    def enrich_property(
        self,
        address: str,
        city: str,
        state: str = "GA",
        zip_code: str = "",
    ) -> Dict:
        """
        Search for one property and return enriched data dict.
        Safe to call in a loop — does NOT open/close the browser session.
        """
        if not self._logged_in:
            raise RuntimeError("Call start_session() and login() before enrich_property().")

        found = self.search_property(address, city, state)
        if not found:
            return {
                "address": address,
                "city": city,
                "state": state,
                "propstream_found": False,
            }

        data = self.extract_property_data(address)
        data.update({"city": city, "state": state, "zip_code": zip_code})

        time.sleep(NAV_DELAY)  # polite pacing between properties
        return data

    # ── Batch flow ────────────────────────────────────────────────────────────

    def run_enrichment_flow(self, properties: List[Dict]) -> List[Dict]:
        """
        Enrich a batch of properties.

        Args:
            properties: list of dicts with at minimum:
                        {address, city} — state defaults to GA.

        Returns:
            List of enriched dicts (original fields merged with PropStream data).
        """
        enriched = []
        try:
            self.start_session()
            self.login()

            logger.info(f"Starting PropStream enrichment for {len(properties)} properties...")

            for i, prop in enumerate(properties, 1):
                logger.info(f"\n[{i}/{len(properties)}] {prop.get('address')}, {prop.get('city')}")
                try:
                    ps_data = self.enrich_property(
                        address  = prop.get("address", ""),
                        city     = prop.get("city", ""),
                        state    = prop.get("state", "GA"),
                        zip_code = prop.get("zip_code", prop.get("zip", "")),
                    )
                    # Merge: original prop fields + PropStream overlay
                    merged = {**prop, **ps_data}
                    enriched.append(merged)
                except Exception as e:
                    logger.error(f"  Failed to enrich {prop.get('address')}: {e}")
                    enriched.append({**prop, "propstream_found": False, "propstream_error": str(e)})

        except Exception as e:
            logger.error(f"Enrichment session failed: {e}")
        finally:
            logger.info("Closing PropStream browser session...")
            self.close_session()

        found_count = sum(1 for r in enriched if r.get("propstream_found"))
        logger.info(
            f"PropStream enrichment complete: {found_count}/{len(properties)} properties found."
        )
        return enriched


# ── Helpers ───────────────────────────────────────────────────────────────────

def _parse_propstream_value(field_key: str, raw: str):
    """Convert raw PropStream text values to typed Python objects."""
    if not raw or raw.lower() in ("n/a", "none", "--", "-"):
        return None

    # Dollar amounts → float
    if field_key in ("estimated_equity", "mortgage_balance", "last_sold_price",
                     "assessed_value", "tax_amount"):
        cleaned = re.sub(r"[$,\s]", "", raw)
        # Handle ranges like "$80K–$120K" — take midpoint
        if "–" in cleaned or "-" in cleaned:
            parts = re.split(r"[–\-]", cleaned)
            nums = [_to_float(p) for p in parts if _to_float(p) is not None]
            return round(sum(nums) / len(nums), 2) if nums else None
        # Handle shorthand like "$120K"
        cleaned = cleaned.upper()
        if cleaned.endswith("K"):
            return _to_float(cleaned[:-1], multiplier=1_000)
        if cleaned.endswith("M"):
            return _to_float(cleaned[:-1], multiplier=1_000_000)
        return _to_float(cleaned)

    # Integer fields
    if field_key in ("open_liens", "years_owned"):
        return _to_int(re.sub(r"[^\d]", "", raw))

    # String fields — return cleaned
    return raw.strip()


def _to_float(value, multiplier=1):
    try:
        return round(float(value) * multiplier, 2)
    except (ValueError, TypeError):
        return None


def _to_int(value):
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def _classify_equity(equity) -> str:
    """
    Bucket equity into actionable tiers used for lead scoring.

      HIGH_EQUITY   ≥ $100K — strong cash-out / motivated seller candidate
      MED_EQUITY    $30K–$100K — possible deal with right price
      LOW_EQUITY    < $30K — thin margin, skip unless distressed
      UNDERWATER    negative — underwater, avoid
      UNKNOWN       couldn't determine
    """
    if equity is None:
        return "UNKNOWN"
    if equity < 0:
        return "UNDERWATER"
    if equity < 30_000:
        return "LOW_EQUITY"
    if equity < 100_000:
        return "MED_EQUITY"
    return "HIGH_EQUITY"


# ── Standalone entrypoint ─────────────────────────────────────────────────────

if __name__ == "__main__":
    enricher = PropStreamEnricher()
    logger.info("Testing PropStream Login Automation...")
    try:
        enricher.start_session()
        enricher.login()
        logger.info("✓ Login successful! PropStreamEnricher is ready to use in the pipeline.")

        # Optional: quick single-property test (real DeKalb address)
        test_prop = {
            "address":  "3050 BERNAUER TRCE",
            "city":     "Dunwoody",
            "state":    "GA",
            "zip_code": "30360",
        }
        logger.info(f"\nRunning test search: {test_prop['address']}, {test_prop['city']}...")
        result = enricher.enrich_property(**test_prop)
        logger.info(f"Result: {json.dumps(result, indent=2)}")

    except Exception as e:
        logger.error(f"Test failed: {e}")
    finally:
        enricher.close_session()
