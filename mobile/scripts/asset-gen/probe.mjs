// Probe generated PNGs: report width/height, channels, and the fraction of
// non-transparent + colored pixels, so we can verify assets without a viewer.
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const requireBase = process.env.SHARP_REQUIRE_BASE
const require = createRequire(pathToFileURL(requireBase))
const sharp = require('sharp')

const dir = join(__dirname, '..', '..', 'assets', 'images')
const files = [
  'icon.png',
  'android-icon-foreground.png',
  'android-icon-background.png',
  'android-icon-monochrome.png',
  'splash-icon.png',
  'favicon.png',
]

for (const f of files) {
  const img = sharp(join(dir, f))
  const meta = await img.metadata()
  const { data, info } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true })
  const px = info.width * info.height
  let opaque = 0, colored = 0, whiteish = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
    if (a > 20) opaque++
    // "colored" = meaningfully non-background chroma
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
    if (a > 40 && mx - mn > 30) colored++
    if (a > 40 && r > 200 && g > 200 && b > 200) whiteish++
  }
  console.log(
    `${f.padEnd(32)} ${info.width}x${info.height} ch=${meta.channels} ` +
    `hasAlpha=${meta.hasAlpha} opaque=${(100*opaque/px).toFixed(1)}% ` +
    `colored=${(100*colored/px).toFixed(1)}% white=${(100*whiteish/px).toFixed(1)}%`
  )
}
