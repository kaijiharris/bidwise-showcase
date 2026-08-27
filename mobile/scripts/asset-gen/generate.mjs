// Generate branded BidWise mobile assets by rendering template.html with
// Playwright (Chromium) and screenshotting each variant at exact pixel size.
//
// Run from a place where @playwright/test / playwright is resolvable, e.g.:
//   node --experimental-vm-modules scripts/asset-gen/generate.mjs
// We pass an explicit playwright module path via PLAYWRIGHT_MODULE if needed.

import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const templateUrl = pathToFileURL(join(__dirname, 'template.html')).href

// Resolve playwright via CommonJS require against an env-provided base dir
// (web/node_modules) so we don't need it installed under mobile/.
const requireBase = process.env.PLAYWRIGHT_REQUIRE_BASE || join(__dirname, 'noop.cjs')
const require = createRequire(pathToFileURL(requireBase))
const { chromium } = require('playwright')

// Output dir = mobile/assets/images
const outDir = process.env.ASSET_OUT_DIR || join(__dirname, '..', '..', 'assets', 'images')
mkdirSync(outDir, { recursive: true })

// [variant, size, filename, omitBackground]
const jobs = [
  ['icon',        1024, 'icon.png',                     false],
  ['adaptive',    1024, 'android-icon-foreground.png',  true],
  ['adaptive-bg', 1024, 'android-icon-background.png',  false],
  ['monochrome',  1024, 'android-icon-monochrome.png',  true],
  ['splash',      1024, 'splash-icon.png',              true],
  ['favicon',       48, 'favicon.png',                  false],
]

const browser = await chromium.launch()
try {
  for (const [variant, size, filename, omitBackground] of jobs) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    })
    const url = `${templateUrl}?v=${variant}&size=${size}`
    await page.goto(url)
    await page.waitForFunction('window.__ready === true', { timeout: 10000 })
    // Screenshot exactly the stage box.
    const stage = await page.$('#stage')
    await stage.screenshot({
      path: join(outDir, filename),
      omitBackground,
    })
    await page.close()
    console.log(`wrote ${filename} (${size}x${size}, transparent=${omitBackground})`)
  }
} finally {
  await browser.close()
}
console.log('DONE')
