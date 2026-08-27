// Tight crops of the two refined sections for QA review (not committed as the
// deliverable set — those are the full-page before/after). Captures the county
// map module and the procedure/deal-card figure at 1440.
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import path from 'path'

const baseUrl = process.argv[2] || 'http://localhost:3311'
const OUT = path.join(process.cwd(), 'docs', 'sections-refine-screenshots', '_qa-crops')
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })
const page = await context.newPage()
await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60000 })
await page.evaluate(async () => {
  const step = window.innerHeight * 0.8
  for (let y = 0; y <= document.body.scrollHeight; y += step) {
    window.scrollTo(0, y); await new Promise(r => setTimeout(r, 220))
  }
  window.scrollTo(0, 0)
})
await page.waitForTimeout(1400)

// County map module (first TitleBlock in the platform grid)
const map = page.locator('svg[aria-label*="Georgia counties"]').first()
await map.scrollIntoViewIfNeeded()
await page.waitForTimeout(600)
await map.screenshot({ path: path.join(OUT, 'countymap.png') })
console.log('captured countymap.png')

// Procedure figure (deal card as delivered)
const fig = page.locator('figure').filter({ hasText: 'DEAL CARD AS DELIVERED' }).first()
await fig.scrollIntoViewIfNeeded()
await page.waitForTimeout(800)
await fig.screenshot({ path: path.join(OUT, 'dealcard-figure.png') })
console.log('captured dealcard-figure.png')

// Step rule row
const steps = page.locator('ol').filter({ hasText: 'Monthly auction lists drop' }).first()
await steps.scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
await steps.screenshot({ path: path.join(OUT, 'steprule.png') })
console.log('captured steprule.png')

await browser.close()
