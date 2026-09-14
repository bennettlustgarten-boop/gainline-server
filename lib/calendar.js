const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// How far ahead to expand a recurring event when no explicit range is given
// — a weekly event with no end date would otherwise generate forever.
const DEFAULT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // ~3 months

// Turns one stored event (which may repeat weekly) into a flat list of
// concrete occurrence timestamps within [rangeStart, rangeStart + windowMs].
// rangeStart isn't necessarily "now" — the month-view calendar passes
// whatever month it's currently showing, past or future.
function expandOccurrences(event, rangeStart = Date.now(), windowMs = DEFAULT_WINDOW_MS) {
  const rangeEnd = rangeStart + windowMs;
  const occurrences = [];

  if (event.recurrence !== "weekly") {
    if (event.startAt >= rangeStart && event.startAt <= rangeEnd) occurrences.push(event.startAt);
    return occurrences;
  }

  const stopAt = Math.min(rangeEnd, event.until || rangeEnd);
  let t = event.startAt;
  // Fast-forward (or rewind) to the first occurrence on/after rangeStart,
  // keeping the same time-of-week alignment as the original startAt.
  if (t < rangeStart) {
    const weeksBehind = Math.ceil((rangeStart - t) / WEEK_MS);
    t += weeksBehind * WEEK_MS;
  }
  while (t <= stopAt) {
    occurrences.push(t);
    t += WEEK_MS;
  }
  return occurrences;
}

module.exports = { expandOccurrences, DEFAULT_WINDOW_MS };
