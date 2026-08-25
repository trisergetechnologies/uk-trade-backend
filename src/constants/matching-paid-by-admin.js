/**
 * Frozen list of matching already paid via admin_credit (workaround before matching
 * was part of Eligible). Used as a fallback until wallets.matchingPaidByAdmin is stamped.
 *
 * Do NOT infer this from leftover admin bonus — unused package deposits must stay Eligible.
 * Amounts are gross matching already compensated; they are subtracted when matching is added.
 */
const MATCHING_PAID_BY_ADMIN_BY_USER_CODE = Object.freeze({
  '99547': 6640, // Naresh kumar verma
  '88531': 8760, // RAMESH VERMA
  '73351': 4900, // Jaya Gambhir
  '95353': 5200, // Deepti Verma
  '08407': 1680, // SUNIL RANA
  '82998': 2550, // Jaya Gambhir (overpaid vs matching 1200; Eligible stays 0, no clawback)
  '84822': 4000, // REETA
  '56939': 4200, // Nirmala Prajapati (amarnathprajapati565@gmail.com)
});

function matchingPaidByAdminForUserCode(userCode) {
  const code = String(userCode || '').trim().toUpperCase();
  const amount = MATCHING_PAID_BY_ADMIN_BY_USER_CODE[code];
  return Number.isFinite(Number(amount)) ? Number(amount) : 0;
}

module.exports = {
  MATCHING_PAID_BY_ADMIN_BY_USER_CODE,
  matchingPaidByAdminForUserCode,
};
