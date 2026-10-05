/**
 * Rule-based VoiceCommandParser / ActivityExtractionService.
 * No external AI/API calls - pure pattern matching on the transcript text,
 * so it works fully offline with zero installs. Swappable later for an
 * LLM-based implementation behind the same parseVoiceTranscript(...) contract.
 */

const CATEGORY_KEYWORDS = [
  { category: 'Cooking', words: ['cook', 'cooking', 'lunch', 'dinner', 'breakfast', 'meal', 'prepare food', 'prepared food'] },
  { category: 'Cleaning', words: ['clean', 'cleaning', 'tidy', 'tidying', 'dishes', 'vacuum', 'mop', 'dust'] },
  { category: 'Laundry', words: ['laundry', 'wash clothes', 'washed clothes', 'folding clothes', 'fold laundry'] },
  { category: 'Homework', words: ['homework', 'study', 'studying', 'assignment'] },
  { category: 'School', words: ['school', 'bus stop', 'class', 'teacher'] },
  { category: 'Transportation', words: ['bus stop', 'dropped', 'drop off', 'drop-off', 'picked up', 'pick up', 'drove', 'driving', 'commute'] },
  { category: 'Grocery', words: ['grocery', 'groceries'] },
  { category: 'Shopping', words: ['shopping', 'shop', 'store', 'mall'] },
  { category: 'Yard/Garden', words: ['yard', 'garden', 'lawn', 'mowing'] },
  { category: 'Household Maintenance', words: ['fix', 'repair', 'maintenance'] },
  { category: 'Childcare', words: ['kids', 'child', 'children', 'baby', 'homework with'] },
  { category: 'Family Activities', words: ['played with', 'family time', 'game night', 'reading with'] },
  { category: 'Personal', words: ['reading', 'read a book', 'exercise', 'workout', 'personal'] },
  { category: 'Work', words: ['office', 'meeting', 'work call', 'went to work'] },
];

const FILLER_PREFIXES = [
  /^(today\s+)?i\s+(just\s+)?(finished|did|completed)\s+/i,
  /^(today\s+)?i\s+/i,
  /^we\s+/i,
];

const FILLER_SUFFIXES = [
  / for (about )?\d+\s*(hours?|hrs?|minutes?|mins?)\s*$/i,
  / from .+$/i,
  / at \d{1,2}(:\d{2})?\s*(am|pm)?\s*$/i,
];

function splitClauses(transcript) {
  return transcript
    .split(/,?\s*(?:and then|then|,\s*and)\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function inferCategory(text) {
  const lower = text.toLowerCase();
  for (const entry of CATEGORY_KEYWORDS) {
    if (entry.words.some((w) => lower.includes(w))) return entry.category;
  }
  return 'Other';
}

function extractDurationMinutes(text) {
  const hourMatch = text.match(/(\d+)\s*(hours?|hrs?)\b/i);
  const minMatch = text.match(/(\d+)\s*(minutes?|mins?)\b/i);
  let minutes = 0;
  let found = false;
  if (hourMatch) { minutes += parseInt(hourMatch[1], 10) * 60; found = true; }
  if (minMatch) { minutes += parseInt(minMatch[1], 10); found = true; }
  return found ? minutes : null;
}

function to24Hour(hour, meridiem) {
  let h = hour % 12;
  if (meridiem === 'pm') h += 12;
  return h;
}

function guessMeridiem(hour) {
  // Heuristic default when speech omits am/pm.
  if (hour >= 7 && hour <= 11) return 'am';
  if (hour === 12) return 'pm';
  if (hour >= 1 && hour <= 6) return 'pm';
  return 'am';
}

function parseTimeToken(token, fallbackMeridiem) {
  const m = token.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = (m[3] || fallbackMeridiem || guessMeridiem(hour)).toLowerCase();
  return { hour24: to24Hour(hour, meridiem), minute };
}

function timeToIso(dateStr, hour24, minute) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setHours(hour24, minute, 0, 0);
  return d.toISOString();
}

function extractTimeRange(text, dateStr) {
  const rangeMatch = text.match(/from\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-|–|until)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (rangeMatch) {
    const [, startTok, endTok] = rangeMatch;
    const endMeridiemMatch = endTok.match(/am|pm/i);
    const endParsed = parseTimeToken(endTok, null);
    const startParsed = parseTimeToken(startTok, endMeridiemMatch ? endMeridiemMatch[0].toLowerCase() : null);
    if (startParsed && endParsed) {
      return {
        startAt: timeToIso(dateStr, startParsed.hour24, startParsed.minute),
        endAt: timeToIso(dateStr, endParsed.hour24, endParsed.minute),
      };
    }
  }

  const atMatch = text.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (atMatch) {
    const parsed = parseTimeToken(atMatch[1], null);
    if (parsed) {
      return { startAt: timeToIso(dateStr, parsed.hour24, parsed.minute), endAt: null };
    }
  }

  return null;
}

function cleanActivityName(text) {
  let name = text.trim();
  for (const re of FILLER_SUFFIXES) name = name.replace(re, '');
  for (const re of FILLER_PREFIXES) name = name.replace(re, '');
  name = name.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function parseClause(clause, { date, nowIso }) {
  const durationMinutes = extractDurationMinutes(clause);
  const timeRange = extractTimeRange(clause, date);
  const category = inferCategory(clause);
  const name = cleanActivityName(clause);

  let startAt = null;
  let endAt = null;
  let approximate = false;

  if (timeRange && timeRange.startAt && timeRange.endAt) {
    startAt = timeRange.startAt;
    endAt = timeRange.endAt;
  } else if (timeRange && timeRange.startAt && durationMinutes) {
    startAt = timeRange.startAt;
    endAt = new Date(new Date(startAt).getTime() + durationMinutes * 60000).toISOString();
  } else if (timeRange && timeRange.startAt) {
    // Only a point-in-time was mentioned (e.g. "at 7:30") - assume a short default duration.
    startAt = timeRange.startAt;
    endAt = new Date(new Date(startAt).getTime() + 15 * 60000).toISOString();
    approximate = true;
  } else if (durationMinutes) {
    endAt = nowIso;
    startAt = new Date(new Date(endAt).getTime() - durationMinutes * 60000).toISOString();
  }

  if (!name) return { ok: false, reason: 'missing_name' };
  if (!startAt || !endAt) return { ok: false, reason: 'missing_time', name, category };

  return {
    ok: true,
    draft: {
      name,
      category,
      date,
      startAt,
      endAt,
      durationMinutes: Math.max(1, Math.round((new Date(endAt) - new Date(startAt)) / 60000)),
      notes: approximate ? 'Duration estimated from voice input' : '',
      inputMethod: 'VOICE',
    },
  };
}

function parseVoiceTranscript(transcript, { date, nowIso }) {
  const clauses = splitClauses(transcript);
  const activities = [];
  const issues = [];

  clauses.forEach((clause) => {
    const result = parseClause(clause, { date, nowIso });
    if (result.ok) {
      activities.push(result.draft);
    } else {
      issues.push({ clause, reason: result.reason, name: result.name, category: result.category });
    }
  });

  let clarification = null;
  if (!activities.length && issues.length) {
    const issue = issues[0];
    if (issue.reason === 'missing_time') {
      clarification = `Got "${issue.name}" - about how long did that take, or what time was it?`;
    } else {
      clarification = "I didn't catch a clear activity. Could you say what you did, and roughly how long it took?";
    }
  } else if (issues.length) {
    clarification = `I understood ${activities.length} activity${activities.length > 1 ? 'ies' : ''}, but didn't catch the time/duration for "${issues[0].clause}".`;
  }

  return { activities, clarification, rawTranscript: transcript };
}

module.exports = { parseVoiceTranscript };
