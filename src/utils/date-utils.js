function toIstDateParts(date = new Date(), tz = 'Asia/Kolkata') {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = dtf.formatToParts(date).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return {
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: parts.weekday,
  };
}

function addIstDays(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  return utcDate.toISOString().slice(0, 10);
}

function isWeekendFromIstIso(isoDate) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** Lexicographic compare for YYYY-MM-DD IST calendar strings. */
function istDateCompare(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

module.exports = { toIstDateParts, addIstDays, isWeekendFromIstIso, istDateCompare };
