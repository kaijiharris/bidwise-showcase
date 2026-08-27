import { describe, it, expect } from 'vitest'
import { csvCell, csvRow } from '@/lib/csv'

describe('csvCell — CSV-injection guard', () => {
  it('prefixes a formula-leader string with a single quote so it is not executed', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('+1+1')).toBe("'+1+1")
    expect(csvCell('-1+1')).toBe("'-1+1")
    expect(csvCell('@cmd')).toBe("'@cmd")
    expect(csvCell('\tTAB')).toBe("'\tTAB")
  })

  it('does NOT mangle a real negative number (numbers are never injection vectors)', () => {
    expect(csvCell(-15)).toBe('-15')
    expect(csvCell(0)).toBe('0')
    expect(csvCell(300000)).toBe('300000')
  })

  it('neutralizes injection AND preserves a comma in the same cell', () => {
    // leading '=' guarded, then wrapped because of the comma
    expect(csvCell('=A1,B2')).toBe('"\'=A1,B2"')
  })
})

describe('csvCell — RFC-4180 quoting', () => {
  it('doubles internal quotes and wraps', () => {
    expect(csvCell('12 "Main" St')).toBe('"12 ""Main"" St"')
  })
  it('wraps cells containing a comma or newline', () => {
    expect(csvCell('Smith, John')).toBe('"Smith, John"')
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"')
  })
  it('leaves a plain cell untouched', () => {
    expect(csvCell('123 Peachtree St')).toBe('123 Peachtree St')
  })
})

describe('csvCell — empties', () => {
  it('returns empty string for null/undefined/non-finite', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(NaN)).toBe('')
    expect(csvCell(Infinity)).toBe('')
  })
})

describe('csvRow', () => {
  it('joins sanitized cells, guarding injection and quoting commas', () => {
    expect(csvRow(['a', '=x', 'b,c', 5, null])).toBe('a,\'=x,"b,c",5,')
  })
})
