/**
 * All activity times are saved and interpreted in Atlantic Daylight Time
 * (ADT = UTC-3), regardless of the host machine's own OS timezone. This
 * keeps voice/manual/timer entries consistent no matter where the server
 * or browser happens to run.
 */

const ADT_OFFSET_HOURS = -3;
const OFFSET_MS = ADT_OFFSET_HOURS * 3600000;

function isoToAdtParts(iso) {
  const shifted = new Date(new Date(iso).getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

function isoToAdtDateStr(iso) {
  const p = isoToAdtParts(iso);
  const mm = String(p.month + 1).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

function adtToIso(dateStr, hour24, minute) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const asUtcMs = Date.UTC(y, m - 1, d, hour24, minute, 0);
  return new Date(asUtcMs - OFFSET_MS).toISOString();
}

function nowAdtDateStr() {
  return isoToAdtDateStr(new Date().toISOString());
}

module.exports = {
  ADT_OFFSET_HOURS,
  isoToAdtParts,
  isoToAdtDateStr,
  adtToIso,
  nowAdtDateStr,
};
