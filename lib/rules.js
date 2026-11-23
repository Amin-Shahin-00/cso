'use strict';
// Pure rules shared by the server and the tests. No I/O in here.

const UNI_RE = /^\d{8}$/;
const DT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const CATEGORIES = ['Volunteering', 'Donation drive', 'Campaign', 'Visit', 'Workshop', 'Training', 'Other'];
// hidden    = draft, only admins see it
// announced = shown under "Coming up later", registration not open yet
// open      = students can register
// closed    = still listed, registration closed
// done      = moved to the archive
const STATUSES = ['hidden', 'announced', 'open', 'closed', 'done'];
const MAJORS = [
  'Computer Science', 'Software Engineering', 'Cybersecurity', 'Data Science',
  'Artificial Intelligence', 'Computer Engineering', 'Electrical Engineering',
  'Business', 'Other',
];

const CARD_SIZE = 10;
const TIERS = [
  { name: 'Newcomer', min: 0 },
  { name: 'Helper', min: 3 },
  { name: 'Volunteer', min: 6 },
  { name: 'Champion', min: 10 },
];
const REWARD = 'Every full card earns a certificate of appreciation from the Community Service Office.';

const pad = (n) => String(n).padStart(2, '0');

function str(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

function normalizeUni(v) {
  return str(v).replace(/[\s-]/g, '');
}

function isUni(v) {
  return UNI_RE.test(v);
}

function isEmail(v) {
  return v.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function localStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isDateTime(v) {
  if (!DT_RE.test(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && localStamp(d) === v;
}

function addHours(stamp, hours) {
  const d = new Date(stamp);
  d.setTime(d.getTime() + hours * 3600 * 1000);
  return localStamp(d);
}

function validateEvent(input = {}) {
  const errors = [];
  const v = {};

  v.title = str(input.title);
  if (!v.title) errors.push('Title is required.');
  else if (v.title.length > 120) errors.push('Title is too long (120 characters max).');

  v.summary = str(input.summary);
  if (v.summary.length > 240) errors.push('Summary is too long (240 characters max).');

  v.description = str(input.description);
  if (v.description.length > 4000) errors.push('Description is too long (4000 characters max).');

  v.category = CATEGORIES.includes(input.category) ? input.category : 'Other';

  v.location = str(input.location);
  if (v.location.length > 120) errors.push('Location is too long (120 characters max).');

  v.starts_at = str(input.starts_at);
  if (!isDateTime(v.starts_at)) errors.push('Start date and time are required.');

  v.ends_at = str(input.ends_at);
  if (!v.ends_at) {
    if (isDateTime(v.starts_at)) v.ends_at = addHours(v.starts_at, 2);
  } else if (!isDateTime(v.ends_at)) {
    errors.push('End date/time is not valid.');
  } else if (isDateTime(v.starts_at) && v.ends_at <= v.starts_at) {
    errors.push('The event must end after it starts.');
  }

  const cap = input.capacity === '' || input.capacity === undefined || input.capacity === null ? 0 : Number(input.capacity);
  if (!Number.isInteger(cap) || cap < 0 || cap > 5000) errors.push('Capacity must be a whole number between 0 and 5000 (0 = unlimited).');
  v.capacity = cap;

  const cr = input.credits === '' || input.credits === undefined || input.credits === null ? 0 : Number(input.credits);
  if (!Number.isFinite(cr) || cr < 0 || cr > 20) errors.push('Credits must be between 0 and 20.');
  v.credits = Math.round(cr * 100) / 100;

  v.status = input.status === undefined ? 'open' : input.status;
  if (!STATUSES.includes(v.status)) errors.push('Unknown status.');

  return { errors, value: v };
}

function validateStudent(input = {}, { requireName = true } = {}) {
  const errors = [];
  const v = { name: str(input.name), email: str(input.email).toLowerCase(), major: str(input.major) };
  if (!v.name) {
    if (requireName) errors.push('Full name is required.');
  } else if (v.name.length < 2 || v.name.length > 80) {
    errors.push('Name must be between 2 and 80 characters.');
  }
  if (v.email && !isEmail(v.email)) errors.push('That email address does not look right.');
  if (v.major && !MAJORS.includes(v.major)) v.major = 'Other';
  return { errors, value: v };
}

function validateTeam(input = {}) {
  const errors = [];
  const v = {
    name: str(input.name),
    category: str(input.category) || 'Committee',
    season: str(input.season),
    description: str(input.description),
  };
  if (!v.name) errors.push('Team name is required.');
  else if (v.name.length > 80) errors.push('Team name is too long (80 characters max).');
  if (v.category.length > 40) errors.push('Category is too long (40 characters max).');
  if (v.season.length > 40) errors.push('Season is too long (40 characters max).');
  if (v.description.length > 600) errors.push('Description is too long (600 characters max).');
  return { errors, value: v };
}

function validateCredit(input = {}) {
  const errors = [];
  const amount = Number(input.amount);
  const reason = str(input.reason);
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 50) {
    errors.push('Amount must be a non-zero number between -50 and 50.');
  }
  if (reason.length < 2) errors.push('Give a reason for the credits.');
  else if (reason.length > 160) errors.push('Reason is too long (160 characters max).');
  return { errors, value: { amount: Math.round(amount * 100) / 100, reason } };
}

// Why a student can't register right now, or null if they can.
function registrationBlock(ev, registered, now) {
  if (ev.status === 'announced') return 'Registration for this event has not opened yet.';
  if (ev.status === 'closed') return 'Registration for this event is closed.';
  if (ev.status !== 'open') return 'This event is not taking registrations.';
  if ((ev.ends_at || ev.starts_at) < now) return 'This event has already happened.';
  if (ev.capacity > 0 && registered >= ev.capacity) return 'This event is full.';
  return null;
}

function tierFor(stamps) {
  let tier = TIERS[0];
  for (const t of TIERS) if (stamps >= t.min) tier = t;
  return tier;
}

function loyalty(stamps) {
  const n = Math.max(0, Math.floor(stamps));
  const tier = tierFor(n);
  const next = TIERS.find((t) => t.min > n) || null;
  // A card that has just been filled stays on screen as "complete" until the next stamp.
  const cardNo = n === 0 ? 1 : Math.ceil(n / CARD_SIZE);
  const onCard = n - (cardNo - 1) * CARD_SIZE;
  return {
    stamps: n,
    card_size: CARD_SIZE,
    card_no: cardNo,
    on_card: onCard,
    card_complete: onCard === CARD_SIZE,
    completed_cards: Math.floor(n / CARD_SIZE),
    tier: tier.name,
    next_tier: next ? next.name : null,
    to_next: next ? next.min - n : 0,
    tiers: TIERS,
    reward: REWARD,
  };
}

function shortName(full) {
  const parts = str(full).split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

function firstName(full) {
  return str(full).split(/\s+/)[0] || '';
}

function ticketCode(eventId, regId) {
  return `CSO-${String(eventId).padStart(3, '0')}-${String(regId).padStart(4, '0')}`;
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

module.exports = {
  CATEGORIES, STATUSES, MAJORS, CARD_SIZE, TIERS, REWARD,
  str, normalizeUni, isUni, isEmail, isDateTime, localStamp, addHours,
  validateEvent, validateStudent, validateTeam, validateCredit,
  registrationBlock, loyalty, tierFor, shortName, firstName, ticketCode, csvCell,
};
