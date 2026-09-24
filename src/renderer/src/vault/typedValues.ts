// Display helpers for Sekure entry type values (dates, countries, expiry).

// ISO 3166-1 alpha-2, for the country pickers.
export const COUNTRY_CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ ' +
  'BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM ' +
  'DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS ' +
  'GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN ' +
  'KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ ' +
  'MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM ' +
  'PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV ' +
  'SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI ' +
  'VN VU WF WS YE YT ZA ZM ZW'
).split(' ')

let regionNames: Intl.DisplayNames | undefined
/** `DE` → `Germany`; unknown or 3-letter codes come back as given. */
export function countryName(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code
  try {
    regionNames ??= new Intl.DisplayNames(undefined, { type: 'region' })
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

/** `DE` → 🇩🇪 */
export const flag = (code: string): string =>
  /^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
    : ''

/** `2031-02-28` → `28 Feb 2031` in the user's locale. */
export function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

/** Last day a `YYYY-MM-DD` date or an `MM/YY` card expiry is valid. */
export function expiryDate(value: string): Date | undefined {
  const card = value.match(/^(\d{2})\/(\d{2})$/)
  if (card) return new Date(2000 + Number(card[2]), Number(card[1]), 0)
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export type ExpiryStatus = { tone: 'ok' | 'soon' | 'expired'; label: string }

/** `expired`, or `soon` when within six months. */
export function expiryStatus(value: string, now = new Date()): ExpiryStatus | undefined {
  const end = expiryDate(value)
  if (!end) return undefined
  const days = Math.floor((end.getTime() - now.getTime()) / 86_400_000)
  if (days < 0) return { tone: 'expired', label: 'Expired' }
  if (days <= 183) {
    const months = Math.floor(days / 30)
    return {
      tone: 'soon',
      label:
        months >= 1
          ? `Expires in ${months} month${months > 1 ? 's' : ''}`
          : `Expires in ${days} days`
    }
  }
  return { tone: 'ok', label: 'Valid' }
}
