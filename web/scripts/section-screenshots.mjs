// Full-page homepage screenshots at the ECC breakpoints for the section-refine
// PR. Captures console errors and flags horizontal overflow at 390.
//
// Usage: node scripts/section-screenshots.mjs <before|after> [baseUrl]
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'
import path from 'path'

const phase = process.argv[2] || 'after'
const baseUrl = process.argv[3] || 'http://localhost:3311'
const OUT = path.join(process.cwd(), 'docs', 'sections-refine-screenshots')
mkdirSync(OUT, { recursive: true })

const WIDTHS = [390, 768, 1024, 1440]

const consoleErrors = []
let overflow390 = null

const browser = await chromium.launch()
try {
  for (const width of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 2,
    })
    const page = await context.newPage()
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(`[${width}] ${msg.text()}`)
    })
    page.on('pageerror', err => consoleErrors.push(`[${width}] PAGEERROR ${err.message}`))

    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60000 })

    // The homepage reveals sections via IntersectionObserver (.reveal → .visible).
    // fullPage captures render off-screen without scrolling, so sections below
    // the fold never intersect and stay at opacity:0. Step-scroll the whole page
    // to trip every observer, then return to top before capturing.
    await page.evaluate(async () => {
      const step = window.innerHeight * 0.8
      const total = document.body.scrollHeight
      for (let y = 0; y <= total; y += step) {
        window.scrollTo(0, y)
        await new Promise(r => setTimeout(r, 220))
      }
      window.scrollTo(0, 0)
    })
    // let reveal transitions + line-draw settle after the last observer fires
    await page.waitForTimeout(1600)

    if (width === 390) {
      overflow390 = await page.evaluate(() => {
        const de = document.documentElement
        return { scrollW: de.scrollWidth, clientW: de.clientWidth, overflow: de.scrollWidth > de.clientWidth + 1 }
      })
    }

    await page.screenshot({
      path: path.join(OUT, `${phase}-${width}.png`),
      fullPage: true,
    })
    console.log(`captured ${phase}-${width}.png`)
    await context.close()
  }
} finally {
  await browser.close()
}

console.log('\n=== RESULT (' + phase + ') ===')
console.log('console errors:', consoleErrors.length)
if (consoleErrors.length) consoleErrors.forEach(e => console.log('  ' + e))
console.log('390 overflow:', JSON.stringify(overflow390))
if (consoleErrors.length > 0) process.exitCode = 3
if (overflow390 && overflow390.overflow) process.exitCode = 4
