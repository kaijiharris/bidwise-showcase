/**
 * Authentic Georgia-metro county geometry for CountyMap.
 *
 * Source: US Census cartographic boundary file, delivered as the `us-atlas@3`
 * `counties-10m` TopoJSON (https://github.com/topojson/us-atlas — Census 2017
 * 1:10,000,000 cartographic boundaries). The four covered counties + a ring of
 * surrounding context counties were decoded from their quantized arcs, projected
 * (equirectangular, latitude-corrected) to this component's 620×560 viewBox, and
 * simplified (Douglas–Peucker) to clean SVG path data. Generation script + raw
 * TopoJSON archived in the section-refine PR notes; regenerate rather than
 * hand-editing these coordinates.
 *
 * FIPS: DeKalb 13089 · Gwinnett 13135 · Cobb 13067 · Clayton 13063.
 */

export const MAP_VIEWBOX = '0 0 620 560'

export type CountyGeometry = {
  /** Real, simplified county outline (SVG path, absolute coords, closed). */
  outline: string
  /** Bounding box [minX, minY, maxX, maxY] — used to seed parcel infill. */
  bbox: [number, number, number, number]
  /** Label anchor (polygon centroid). */
  labelX: number
  labelY: number
}

export const COVERED_GEOMETRY: Record<
  'dekalb' | 'gwinnett' | 'cobb' | 'clayton',
  CountyGeometry
> = {
  cobb: {
    outline:
      'M218.2 216.5L311 218.7L316.3 239.4L323.6 249L315.2 264.1L302.7 276.1L304.8 283L296.4 305L265.2 334.1L251.6 312.8L222.4 312.2L222.4 262.9L218.2 262.9L218.2 216.5Z',
    bbox: [218, 217, 324, 334],
    labelX: 258,
    labelY: 268,
  },
  gwinnett: {
    outline:
      'M351.7 259.3L355.9 249L370.5 243L379.9 244.8L384 234.6L403.9 226.8L398.6 221.4L403.9 201.5L414.3 185.6L470.6 209.9L485.2 199.7L470.6 243L480 249.9L491.5 268.9L425.8 330.8L411.2 322.4L387.2 295.9L373.6 289L356.9 272.8L351.7 259.3Z',
    bbox: [352, 186, 492, 331],
    labelX: 430,
    labelY: 250,
  },
  dekalb: {
    outline:
      'M351.7 259.3L356.9 272.8L373.6 289L387.2 295.9L411.2 322.4L425.8 330.8L416.4 340.1L398.6 379.2L378.8 368.4L361.1 373.8L350.7 367.8L330.9 367.8L331.9 258L351.7 259.3Z',
    bbox: [331, 258, 426, 379],
    labelX: 368,
    labelY: 322,
  },
  clayton: {
    outline:
      'M330.9 367.8L350.7 367.8L362.1 388L350.7 402.4L347.5 442.1L329.8 441.8L329.8 471L320.4 471.3L321.5 453.5L316.3 445.7L321.5 432.5L311 421.6L304.8 401.8L299.6 401.5L299.6 367.5L330.9 367.8Z',
    bbox: [300, 368, 362, 471],
    labelX: 326,
    labelY: 410,
  },
}

/** Surrounding counties — faint dashed context, never lit. */
export const CONTEXT_OUTLINES: string[] = [
  'M485.2 199.7L500.8 221.7L544.6 228L559.2 233.4L567.6 256.2L535.3 277.3L526.9 273.4L501.9 281.2L480 249.9L470.6 243L485.2 199.7Z',
  'M44.1 366L57.6 366.3L101.4 349.5L110.8 351.3L127.5 344.4L127.5 310.1L170.3 321.2L169.2 393.7L197.4 393.7L191.1 403.6L195.3 412.3L185.9 415.3L183.8 421.6L168.2 430.4L159.8 441.5L146.3 434.6L137.9 445.4L56.6 444.8L44.1 366Z',
  'M243.3 99.9L263.1 100.2L263.1 111L358 111L358 179.3L329.8 182.6L327.7 201.2L311 206.3L311 218.7L241.2 217.2L243.3 99.9Z',
  'M185.9 415.3L252.6 415.6L255.8 418.6L250.6 440.9L262 469.2L277.7 477L288.1 504.3L287.1 517L184.9 516.4L181.7 527.5L181.7 516.1L159.8 515.8L137.9 445.4L146.3 434.6L159.8 441.5L168.2 430.4L183.8 421.6L185.9 415.3Z',
  'M331.9 47.5L335 41.2L359 45.4L359 35.2L375.7 28L376.7 54.5L401.8 81.2L438.3 98.1L438.3 119.1L445.6 127.5L358 127.2L358 81.5L340.2 80.6L331.9 47.5Z',
  'M170.3 321.2L177.6 323.3L222.4 318.5L222.4 312.2L251.6 312.8L265.2 334.1L243.3 355.2L242.2 362.4L214.1 373.8L197.4 393.7L169.2 393.7L170.3 321.2Z',
  'M255.8 418.6L267.2 410.8L304.8 401.8L311 421.6L321.5 432.5L316.3 445.7L321.5 453.5L318.3 486.3L306.9 504.6L288.1 504.3L277.7 477L262 469.2L250.6 440.9L255.8 418.6Z',
  'M358 179.3L358 127.2L445.6 127.5L451.8 144.7L447.7 160.6L436.2 176L423.7 176L414.3 185.6L403.9 201.5L398.6 221.4L403.9 226.8L391.3 225L377.8 214.1L358 206L358 179.3Z',
  'M197.4 393.7L214.1 373.8L242.2 362.4L243.3 355.2L296.4 305L304.8 283L302.7 276.1L315.2 264.1L323.6 249L316.3 239.4L311 206.3L327.7 201.2L329.8 182.6L358 179.3L358 206L377.8 214.1L391.3 225L403.9 226.8L384 234.6L379.9 244.8L370.5 243L355.9 249L351.7 259.3L331.9 258L330.9 367.8L299.6 367.5L299.6 401.5L267.2 410.8L255.8 418.6L252.6 415.6L185.9 415.3L195.3 412.3L191.1 403.6L197.4 393.7Z',
  'M445.6 127.5L438.3 119.1L438.3 98.1L477.9 67.4L530 68.3L544.6 93.3L533.2 104.4L529 116.4L534.2 132L542.6 141.1L485.2 199.7L470.6 209.9L414.3 185.6L423.7 176L436.2 176L447.7 160.6L451.8 144.7L445.6 127.5Z',
  'M350.7 367.8L361.1 373.8L378.8 368.4L396.6 397.9L418.5 405.1L423.7 420.1L448.7 425.8L455 439.1L440.4 451.7L443.5 463.1L423.7 467.9L415.3 486L402.8 490.2L389.3 484.8L389.3 477L361.1 477L360.1 471L329.8 471L329.8 441.8L347.5 442.1L350.7 402.4L362.1 388L350.7 367.8Z',
  'M419.5 410.5L452.9 366.6L458.1 345.3L457 334.1L502.9 368.1L510.2 368.4L525.9 385.6L526.9 424L509.2 426.1L498.8 436.1L483.1 441.5L482.1 456.8L472.7 465.5L458.1 448.4L448.7 425.8L423.7 420.1L419.5 410.5Z',
  'M165 215.6L218.2 216.5L218.2 262.9L222.4 262.9L222.4 318.5L177.6 323.3L130.6 310.4L131.7 277.9L127.5 277.9L127.5 261.1L148.4 261.4L165 215.6Z',
  'M378.8 368.4L398.6 379.2L416.4 340.1L438.3 319.4L457 334.1L458.1 345.3L452.9 366.6L419.5 410.5L418.5 405.1L396.6 397.9L378.8 368.4Z',
  'M288.1 504.3L306.9 504.6L318.3 486.3L320.4 471.3L360.1 471L361.1 477L389.3 477L389.3 484.8L407 494.4L396.6 506.1L396.6 532L324.6 528.1L318.3 521.5L301.7 521.5L288.1 530.2L288.1 504.3Z',
  'M438.3 319.4L491.5 268.9L501.9 281.2L526.9 273.4L540.5 283.9L554 285.1L556.1 297.4L575.9 308.3L525.9 385.6L510.2 368.4L502.9 368.1L438.3 319.4Z',
]

/**
 * Deterministic parcel-infill hatch for one county bbox: a set of survey-style
 * lines (diagonal + a couple of orthogonal section lines) spanning the bbox.
 * Rendered clipped to the real county outline so it reads as lot subdivision.
 */
export function parcelHatch([minX, minY, maxX, maxY]: [number, number, number, number]): string {
  const w = maxX - minX
  const h = maxY - minY
  const step = 14 // ~lot spacing in viewBox units
  const lines: string[] = []
  // 45° hatch across the bbox diagonal extent
  const diagStart = -h
  for (let x = diagStart; x <= w; x += step) {
    const x1 = minX + x
    const y1 = minY
    const x2 = minX + x + h
    const y2 = maxY
    lines.push(`M${round(x1)} ${round(y1)}L${round(x2)} ${round(y2)}`)
  }
  // two section lines (survey range/township feel)
  lines.push(`M${round(minX)} ${round(minY + h / 3)}L${round(maxX)} ${round(minY + h / 3)}`)
  lines.push(`M${round(minX)} ${round(minY + (2 * h) / 3)}L${round(maxX)} ${round(minY + (2 * h) / 3)}`)
  lines.push(`M${round(minX + w / 2)} ${round(minY)}L${round(minX + w / 2)} ${round(maxY)}`)
  return lines.join('')
}

function round(n: number): number {
  return Math.round(n * 10) / 10
}
