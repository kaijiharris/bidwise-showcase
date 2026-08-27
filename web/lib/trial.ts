// Single source of truth for the free-trial length.
//
// Referenced by BOTH the Stripe checkout session (subscription_data.
// trial_period_days) and every piece of marketing/UI copy that names the
// trial. Change it HERE and only here — a copy string that hardcodes a day
// count will drift from what Stripe actually charges and becomes a
// chargeback/dispute liability.
//
// Note: the separate 7-day iOS unlock trial (user_trials via
// claim_trial_for_user RPC) is a deliberate mobile product decision and does
// NOT read this constant.
export const TRIAL_DAYS = 14

/** "14-day" — for copy like `${TRIAL_LABEL} free trial`. */
export const TRIAL_LABEL = `${TRIAL_DAYS}-day`
