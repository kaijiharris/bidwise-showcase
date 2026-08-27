// Composite real device screenshots into App Store Connect's exact required
// pixel sizes, with an optional caption band.
//
// WHY THIS EXISTS
// App Store screenshots must depict the actual app (Guideline 2.3.3), so these
// are NOT generated mockups — you capture the real screens on your iPhone and
// this script only reframes them. It also removes the Mac dependency: the
// operator is on Windows, and Apple requires exact pixel dimensions that a
// random iPhone capture will not match.
//
// USAGE
//   1. On your iPhone, open the TestFlight build and capture the screens listed
//      in SHOTS below (side button + volume up). AirDrop/email them to the PC.
//   2. Drop them in scripts/store-screenshots/input/ named 01.png, 02.png, ...
//      (any iPhone resolution — they are scaled to fit, never stretched).
//   3. From mobile/:
//        PLAYWRIGHT_REQUIRE_BASE=../web/node_modules/.package-lock.json \
//        node scripts/store-screenshots/build.mjs
//   4. Upload scripts/store-screenshots/output/6.9/*.png to App Store Connect.
//
// Apple currently requires ONE set: 6.9" (1320x2868) OR 6.5" (1242x2688), and
// scales the rest. We emit 6.9" and 6.5" so either is accepted.

import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, extname } from 'node:path'
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const templateUrl = pathToFileURL(join(__dirname, 'frame.html')).href

// Playwright is resolved from web/node_modules (it is not installed under
// mobile/) — same trick asset-gen/generate.mjs uses.
const requireBase = process.env.PLAYWRIGHT_REQUIRE_BASE || join(__dirname, 'noop.cjs')
const require = createRequire(pathToFileURL(requireBase))
const { chromium } = require('playwright')

const inDir = process.env.SHOT_IN_DIR || join(__dirname, 'input')
const outRoot = process.env.SHOT_OUT_DIR || join(__dirname, 'output')

// Apple's accepted iPhone sizes. Portrait only — app.json pins orientation.
const SIZES = [
  { key: '6.9', width: 1320, height: 2868 },
  { key: '6.5', width: 1242, height: 2688 },
]

// Captions, in upload order. Keep each SHORT — Apple crops long lines on the
// store card, and a caption that over-claims is the same 2.3.3 risk as the
// screenshot itself. Every line here must be true of the shipped build.
// Order matters: slot 1 is the only one most browsers ever see.
const SHOTS = [
  { file: '01', caption: 'Every parcel on the list, scored' },
  { file: '02', caption: 'Comps, ARV, and a recommended max bid' },
  { file: '03', caption: 'See the math behind every number' },
  { file: '04', caption: 'Sort by ROI, profit, or deal score' },
  { file: '05', caption: 'Track parcels to auction day' },
  { file: '06', caption: 'DeKalb, Gwinnett, Cobb, Clayton' },
]

function findInput(stem) {
  if (!existsSync(inDir)) return null
  const match = readdirSync(inDir).find(
    (f) => f.toLowerCase().startsWith(stem.toLowerCase()) && /\.(png|jpe?g)$/i.test(f),
  )
  return match ? join(inDir, match) : null
}

function toDataUri(path) {
  const ext = extname(path).toLowerCase()
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg'
  return `data:${mime};base64,${readFileSync(path).toString('base64')}`
}

const browser = await chromium.launch()
let written = 0
let skipped = 0

try {
  for (const size of SIZES) {
    const outDir = join(outRoot, size.key)
    mkdirSync(outDir, { recursive: true })

    for (const [i, shot] of SHOTS.entries()) {
      const src = findInput(shot.file)
      if (!src) {
        if (size.key === SIZES[0].key) {
          console.warn(`  SKIP ${shot.file}: no input file matching "${shot.file}*" in ${inDir}`)
          skipped++
        }
        continue
      }

      const page = await browser.newPage({
        viewport: { width: size.width, height: size.height },
        deviceScaleFactor: 1,
      })
      const params = new URLSearchParams({
        w: String(size.width),
        h: String(size.height),
        caption: shot.caption,
      })
      await page.goto(`${templateUrl}?${params.toString()}`)
      await page.evaluate((uri) => window.__setShot(uri), toDataUri(src))
      await page.waitForFunction('window.__ready === true', { timeout: 15000 })

      const name = `${String(i + 1).padStart(2, '0')}-${shot.caption
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)}.png`
      await page.screenshot({ path: join(outDir, name), clip: { x: 0, y: 0, ...size } })
      await page.close()
      written++
      console.log(`  wrote ${size.key}/${name} (${size.width}x${size.height})`)
    }
  }
} finally {
  await browser.close()
}

console.log(`\nDONE — ${written} images written, ${skipped} shots missing input.`)
if (skipped) {
  console.log(`Capture the missing screens on device and drop them in ${inDir}.`)
}
console.log(`Upload ${join(outRoot, '6.9')}/*.png to App Store Connect.`)
