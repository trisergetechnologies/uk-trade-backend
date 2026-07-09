const TDS_PERCENT = 5;
const HANDLING_PERCENT = 5;

function round2(value) {
  return Number(Number(value || 0).toFixed(2));
}

/** Gross wallet debit → TDS, handling, and net bank payout. */
function computeWithdrawalDeductions(grossAmount) {
  const gross = round2(Math.max(0, Number(grossAmount) || 0));
  const tdsAmount = round2((gross * TDS_PERCENT) / 100);
  const handlingAmount = round2((gross * HANDLING_PERCENT) / 100);
  const netPayable = round2(gross - tdsAmount - handlingAmount);
  return {
    tdsPercent: TDS_PERCENT,
    handlingPercent: HANDLING_PERCENT,
    tdsAmount,
    handlingAmount,
    netPayable,
  };
}

/** Backfill deduction fields for legacy withdrawal rows. */
function resolveWithdrawalDeductions(row) {
  const gross = round2(Number(row?.amount) || 0);
  const hasStored =
    Number(row?.netPayable) > 0 &&
    (Number(row?.tdsAmount) > 0 || Number(row?.handlingAmount) > 0);
  if (hasStored) {
    return {
      amount: gross,
      tdsPercent: Number(row.tdsPercent) || TDS_PERCENT,
      handlingPercent: Number(row.handlingPercent) || HANDLING_PERCENT,
      tdsAmount: round2(row.tdsAmount),
      handlingAmount: round2(row.handlingAmount),
      netPayable: round2(row.netPayable),
    };
  }
  return { amount: gross, ...computeWithdrawalDeductions(gross) };
}

module.exports = {
  TDS_PERCENT,
  HANDLING_PERCENT,
  computeWithdrawalDeductions,
  resolveWithdrawalDeductions,
};
