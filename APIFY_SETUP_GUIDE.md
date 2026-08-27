# Apify + Crawlee Setup Complete! 🎉

Your local IDE is now configured with Apify + Crawlee for web scraping, following your 3-layer architecture.

## What Was Created

### Layer 1: Directive (What to do)
- **[directives/scrape_website.md](directives/scrape_website.md)** - Complete instructions for web scraping tasks

### Layer 2: Orchestration (Decision making)
- **[execution/run_apify_scraper.py](execution/run_apify_scraper.py)** - Main orchestration script
- **[execution/setup_apify.py](execution/setup_apify.py)** - One-time setup helper
- **[execution/test_scraper.py](execution/test_scraper.py)** - Test both scrapers

### Layer 3: Execution (Doing the work)
- **[apify_scrapers/static-scraper/](apify_scrapers/static-scraper/)** - Fast Cheerio-based scraper
- **[apify_scrapers/dynamic-scraper/](apify_scrapers/dynamic-scraper/)** - Full browser Playwright scraper

## Quick Start

### 1. Test Your Setup
```bash
python execution/test_scraper.py
```

This will scrape example.com with both scrapers and verify everything works.

### 2. Your First Real Scrape

```python
from execution.run_apify_scraper import ApifyScraper

# For static HTML sites (fast!)
scraper = ApifyScraper(scraper_type="static")

result = scraper.scrape(
    start_urls=["https://news.ycombinator.com"],
    selectors={
        "title": ".titleline > a",
        "points": ".score",
        "author": ".hnuser"
    },
    max_pages=1,
    follow_links=False
)

print(f"Scraped {result['results']['records_count']} records")
print(f"Output: {result['results']['output_path']}")
```

### 3. For JavaScript-Heavy Sites

```python
# For sites that need JavaScript execution
scraper = ApifyScraper(scraper_type="dynamic")

result = scraper.scrape(
    start_urls=["https://spa-website.com"],
    selectors={
        "content": ".dynamic-content",
        "items": ".product-card"
    },
    max_pages=5,
    waitForSelector=".dynamic-content",  # Wait for this element
    waitTime=3000  # Or wait 3 seconds
)
```

## Decision Tree: Which Scraper?

```
Does the site load content with JavaScript?
├─ NO → Use "static" scraper (10-50x faster)
└─ YES → Try "static" first anyway
    └─ If data is missing → Use "dynamic" scraper
```

**Always try static first!** It's much faster and cheaper. Only use dynamic if you get empty results.

## File Organization

- **Deliverables**: Scraped data goes to `.tmp/scraped_data/[timestamp]/`
- **Intermediates**: Apify storage in `apify_scrapers/*/apify_storage/` (auto-cleaned)
- **Everything in `.tmp/` can be deleted and regenerated**

## Selector Examples

```python
# Text content
"h1"              # First heading text
"p"               # All paragraphs (array)
".intro"          # Elements with class "intro"
"#main"           # Element with id "main"

# Attributes (use @)
"a@href"          # All link URLs
"img@src"         # All image sources
"button@data-id"  # Custom attributes
```

## Common Use Cases

### Scrape Product Listings
```python
scraper.scrape(
    start_urls=["https://store.example.com/products"],
    selectors={
        "name": ".product-name",
        "price": ".product-price",
        "image": "img.product-image@src",
        "url": "a.product-link@href"
    },
    max_pages=20,
    follow_links=False
)
```

### Scrape Documentation Sites
```python
scraper.scrape(
    start_urls=["https://docs.example.com/guide"],
    selectors={
        "title": "h1",
        "content": "article",
        "code_snippets": "pre code"
    },
    max_pages=100,
    follow_links=True  # Follow links to crawl entire docs
)
```

### Scrape Social Media (Dynamic)
```python
scraper = ApifyScraper(scraper_type="dynamic")
scraper.scrape(
    start_urls=["https://social-site.com/feed"],
    selectors={
        "posts": ".post-content",
        "author": ".post-author",
        "likes": ".like-count"
    },
    max_pages=10,
    waitForSelector=".post-content",  # Wait for posts to load
    maxConcurrency=2  # Go easy on their servers
)
```

## Troubleshooting

### Empty Results
- **Check selectors**: Inspect the site with browser DevTools
- **Try dynamic scraper**: Site might use JavaScript
- **Check errors**: Look in metadata.json

### Rate Limiting
- **Reduce speed**: Lower maxConcurrency in scraper code
- **Add delays**: Edit main.js to add random delays
- **Use proxies**: See directive for proxy setup

### Memory Issues
- **Reduce concurrent requests**: Edit maxConcurrency in main.js
- **Process in batches**: Scrape fewer pages per run
- **Use static scraper**: Much more memory-efficient

## Integration with Your System

This follows your architecture principles:

1. **Read the directive** ([directives/scrape_website.md](directives/scrape_website.md)) to understand the SOP
2. **Use the orchestration layer** ([execution/run_apify_scraper.py](execution/run_apify_scraper.py)) to call scrapers
3. **Trust the execution layer** (apify_scrapers/) to do its job deterministically
4. **Self-anneal**: Update the directive when you learn new patterns

## Next Steps

1. **Test it**: Run `python execution/test_scraper.py`
2. **Try a real site**: Pick a site you want to scrape
3. **Inspect selectors**: Use browser DevTools to find the right CSS selectors
4. **Start scraping**: Use the examples above as templates
5. **Update directive**: Document any edge cases you discover

## Cost & Performance

| Scraper | Pages/sec | Memory | Best For |
|---------|-----------|--------|----------|
| Static  | 10-50     | ~50MB  | Blogs, news, docs |
| Dynamic | 1-5       | ~500MB | SPAs, JS-heavy sites |

**Recommendation**: Always start with static. Only use dynamic when necessary.

## Resources

- **Directive**: [directives/scrape_website.md](directives/scrape_website.md)
- **Scraper README**: [apify_scrapers/README.md](apify_scrapers/README.md)
- **Crawlee Docs**: https://crawlee.dev
- **Apify Docs**: https://docs.apify.com

---

**Setup Status**: ✅ Complete and tested

**Dependencies**:
- ✅ Node.js v24.10.0
- ✅ npm v11.6.1
- ✅ Apify + Crawlee packages
- ✅ Playwright browsers

You're ready to scrape! 🚀
