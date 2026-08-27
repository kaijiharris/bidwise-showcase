// Vendor application domain: fixed category enum (mirrors the CHECK constraint
// in migration 016) + server-authoritative validation. Pure module — safe to
// import from both the client form and the API route.

// Vendor src-attribution cookie set by /v/[code]. Non-httpOnly BY DESIGN: the
// client form reads it as a fallback when ?src is lost. No PII, low stakes.
export const VENDOR_SRC_COOKIE_NAME = 'bw_vendor_src'
export const VENDOR_SRC_COOKIE_MAX_AGE_DAYS = 7

export const VENDOR_CATEGORIES = [
  'general_contractor',
  'roofing',
  'plumbing',
  'electrical',
  'hvac',
  'landscaping',
  'cleaning_hauling',
  'inspection',
  'title_closing',
  'lending',
  'insurance',
  'property_management',
  'other',
] as const

export type VendorCategory = (typeof VENDOR_CATEGORIES)[number]

export const VENDOR_CATEGORY_LABELS: Record<VendorCategory, string> = {
  general_contractor: 'General contractor',
  roofing: 'Roofing',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'HVAC',
  landscaping: 'Landscaping',
  cleaning_hauling: 'Cleaning & hauling',
  inspection: 'Inspection',
  title_closing: 'Title & closing',
  lending: 'Lending',
  insurance: 'Insurance',
  property_management: 'Property management',
  other: 'Other',
}

export interface VendorApplicationValues {
  business_name: string
  category: VendorCategory
  service_counties: string[]
  license_number: string | null
  is_insured: boolean
  years_in_business: number
  website: string | null
  phone: string
  email: string
  referral_source: string | null
  src_code: string | null
}

export type VendorValidationResult =
  | { ok: true; values: VendorApplicationValues }
  | { ok: false; errors: Record<string, string> }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_ALLOWED_RE = /^[0-9+()\-.\s]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function validPhone(raw: string): boolean {
  if (!raw || !PHONE_ALLOWED_RE.test(raw)) return false
  const digits = raw.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 15
}

function validHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validCounties(value: unknown, allowed: readonly string[]): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(c => typeof c === 'string' && allowed.includes(c))
  )
}

/**
 * Validate an application body (client + server run this; the SERVER call is
 * authoritative). Returns cleaned, normalized values or field-keyed errors.
 * `allowedCounties` is injected so this module stays free of server-only deps.
 */
export function validateVendorApplication(
  body: unknown,
  allowedCounties: readonly string[],
): VendorValidationResult {
  if (!isRecord(body)) return { ok: false, errors: { body: 'Invalid request body' } }

  const errors: Record<string, string> = {}
  const businessName = asTrimmedString(body.business_name)
  const category = asTrimmedString(body.category)
  const license = asTrimmedString(body.license_number)
  const website = asTrimmedString(body.website)
  const phone = asTrimmedString(body.phone)
  const email = asTrimmedString(body.email).toLowerCase()
  const referral = asTrimmedString(body.referral_source)
  const years = body.years_in_business

  if (businessName.length < 2 || businessName.length > 120)
    errors.business_name = 'Business name must be 2-120 characters'
  if (!(VENDOR_CATEGORIES as readonly string[]).includes(category))
    errors.category = 'Choose a category from the list'
  if (!validCounties(body.service_counties, allowedCounties))
    errors.service_counties = 'Select at least one service county'
  if (license.length > 60) errors.license_number = 'License number is too long'
  if (typeof body.is_insured !== 'boolean')
    errors.is_insured = 'Tell us whether you are insured'
  if (typeof years !== 'number' || !Number.isInteger(years) || years < 0 || years > 99)
    errors.years_in_business = 'Years in business must be a whole number 0-99'
  if (website && !validHttpUrl(website))
    errors.website = 'Website must be a valid http(s) URL'
  if (!validPhone(phone)) errors.phone = 'Enter a valid phone number'
  if (!EMAIL_RE.test(email) || email.length > 254)
    errors.email = 'Enter a valid email address'
  if (referral.length > 300)
    errors.referral_source = 'Keep "how did you hear about us" under 300 characters'

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    values: {
      business_name: businessName,
      category: category as VendorCategory,
      service_counties: body.service_counties as string[],
      license_number: license || null,
      is_insured: body.is_insured as boolean,
      years_in_business: years as number,
      website: website || null,
      phone,
      email,
      referral_source: referral || null,
      src_code: null, // set by the route from the validated ?src / cookie value
    },
  }
}
