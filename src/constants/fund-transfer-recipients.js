/** User codes allowed to open the sent-recipients report in the user dashboard. */
const FUND_TRANSFER_RECIPIENT_REPORT_CODES = new Set(['USRIWHLVT']);

function canViewTransferRecipientReport(userCode) {
  return FUND_TRANSFER_RECIPIENT_REPORT_CODES.has(String(userCode || '').trim().toUpperCase());
}

module.exports = {
  FUND_TRANSFER_RECIPIENT_REPORT_CODES,
  canViewTransferRecipientReport,
};
