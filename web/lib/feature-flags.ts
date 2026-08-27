import { createClient } from '@/lib/supabase/server'

export interface FeatureFlags {
  useSupabaseProperties: boolean
}

const ENV_FLAGS: FeatureFlags = {
  useSupabaseProperties: process.env.NEXT_PUBLIC_USE_SUPABASE_PROPERTIES === 'true',
}

export async function getFeatureFlags(): Promise<FeatureFlags> {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('app_config')
      .select('use_supabase_properties_override')
      .eq('id', 1)
      .maybeSingle()

    if (error) {
      console.error('[feature-flags] app_config read failed:', error.message)
      return ENV_FLAGS
    }

    const override = data?.use_supabase_properties_override
    return {
      useSupabaseProperties:
        override === true || override === false
          ? override
          : ENV_FLAGS.useSupabaseProperties,
    }
  } catch (err) {
    console.error('[feature-flags] unexpected error:', err)
    return ENV_FLAGS
  }
}
