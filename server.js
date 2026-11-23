'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb, tx } = require('./db');
const R = require('./lib/rules');

const PUBLIC_DIR = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};
const LOGO_CANDIDATES = ['logo.png', 'logo.svg', 'logo.webp', 'logo.jpg', 'logo.jpeg'].map((f) => path.join(PUBLIC_DIR, 'assets', f));
const SESSION_MS = 12 * 3600 * 1000;
const COOKIE = 'cso_admin';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src https://fonts.gstatic.com; " +
      "img-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request is too large.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch { /* ignore malformed cookie */ }
  }
  return out;
}

function createApp(opts = {}) {
  const db = openDb(opts.dbPath || path.join(__dirname, 'data', 'cso.db'));
  const adminHash = sha256(opts.adminPassword || 'cso-admin');
  const now = opts.now || (() => R.localStamp());
  const loginFailures = new Map(); // ip -> { count, until }

  const routes = [];
  const add = (method, pattern, handler, { admin = false } = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
    routes.push({ method, re, keys, handler, admin });
  };

  // ---------------------------------------------------------------- helpers
  const EVENT_SELECT = `SELECT e.*,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered,
      (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id AND r.attended = 1) AS attended_count
    FROM events e`;

  const shapeEvent = (e) => ({
    id: e.id,
    title: e.title,
    summary: e.summary,
    description: e.description,
    category: e.category,
    location: e.location,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    capacity: e.capacity,
    credits: e.credits,
    status: e.status,
    registered: e.registered,
    attended_count: e.attended_count,
    seats_left: e.capacity > 0 ? Math.max(0, e.capacity - e.registered) : null,
  });

  const getEvent = (id) => {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) return null;
    return db.prepare(`${EVENT_SELECT} WHERE e.id = ?`).get(n) || null;
  };
  const getEventOr404 = (id) => getEvent(id) || fail(404, 'Event not found.');
  const getStudent = (uni) => db.prepare('SELECT * FROM students WHERE uni_no = ?').get(uni) || null;

  const requireUni = (raw) => {
    const uni = R.normalizeUni(raw);
    if (!R.isUni(uni)) fail(400, 'University number must be exactly 8 digits.');
    return uni;
  };

  // Find a student or create one from body.name/email/major.
  const ensureStudent = (uni, body, missingMessage) => {
    const existing = getStudent(uni);
    if (existing) return existing;
    const { errors, value } = R.validateStudent(body, { requireName: false });
    if (!value.name) fail(400, missingMessage || `${uni} is not in the database yet. Add the student's full name to create them.`);
    if (errors.length) fail(400, errors[0]);
    db.prepare('INSERT INTO students (uni_no, name, email, major) VALUES (?, ?, ?, ?)')
      .run(uni, value.name, value.email || null, value.major || null);
    return getStudent(uni);
  };

  const cardData = (uni) => {
    const st = getStudent(uni);
    if (!st) fail(404, "We couldn't find that university number. Register for any CSO event to start your card.");
    const stamps = db.prepare(`SELECT e.id, e.title, e.category, e.starts_at, r.attended_at
        FROM registrations r JOIN events e ON e.id = r.event_id
        WHERE r.uni_no = ? AND r.attended = 1 ORDER BY e.starts_at, e.id`).all(uni);
    const credits = db.prepare(`SELECT amount, reason, created_at FROM credits
        WHERE uni_no = ? ORDER BY created_at DESC, id DESC`).all(uni);
    const upcoming = db.prepare(`SELECT e.id, e.title, e.starts_at, e.location
        FROM registrations r JOIN events e ON e.id = r.event_id
        WHERE r.uni_no = ? AND r.attended = 0 AND e.ends_at >= ? AND e.status IN ('announced','open','closed')
        ORDER BY e.starts_at`).all(uni, now());
    const total = credits.reduce((s, c) => s + c.amount, 0);
    return {
      student: { display_name: R.shortName(st.name), uni_no: st.uni_no, member_since: st.created_at },
      loyalty: R.loyalty(stamps.length),
      stamps,
      credits_total: Math.round(total * 100) / 100,
      credits,
      upcoming,
    };
  };

  const resyncAutoCredits = (ev) => {
    db.prepare('DELETE FROM credits WHERE event_id = ? AND auto = 1').run(ev.id);
    if (ev.credits > 0) {
      db.prepare(`INSERT INTO credits (uni_no, amount, reason, event_id, auto, created_at)
          SELECT uni_no, ?, ?, ?, 1, COALESCE(attended_at, strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'))
          FROM registrations WHERE event_id = ? AND attended = 1`)
        .run(ev.credits, `Attended: ${ev.title}`, ev.id, ev.id);
    }
  };

  // ---------------------------------------------------------------- public API
  add('GET', '/api/meta', () => ({
    categories: R.CATEGORIES,
    majors: R.MAJORS,
    statuses: R.STATUSES,
    card_size: R.CARD_SIZE,
    tiers: R.TIERS,
    reward: R.REWARD,
    now: now(),
  }));

  add('GET', '/api/events', ({ url }) => {
    const scope = url.searchParams.get('scope') || 'upcoming';
    const t = now();
    let rows;
    if (scope === 'past') {
      rows = db.prepare(`${EVENT_SELECT}
          WHERE e.status = 'done' OR (e.status IN ('open','closed') AND e.ends_at < ?)
          ORDER BY e.starts_at DESC LIMIT 100`).all(t);
    } else {
      rows = db.prepare(`${EVENT_SELECT}
          WHERE e.status IN ('announced','open','closed') AND e.ends_at >= ?
          ORDER BY e.starts_at, e.id`).all(t);
    }
    return { events: rows.map(shapeEvent), now: t };
  });

  add('GET', '/api/events/:id', ({ params }) => {
    const e = getEvent(params.id);
    if (!e || e.status === 'hidden') fail(404, 'Event not found.');
    const block = R.registrationBlock(e, e.registered, now());
    return { event: shapeEvent(e), can_register: !block, reason: block };
  });

  add('GET', '/api/students/:uni', ({ params }) => {
    const uni = requireUni(params.uni);
    const st = getStudent(uni);
    return st ? { known: true, first_name: R.firstName(st.name) } : { known: false };
  });

  add('POST', '/api/events/:id/register', ({ params, body }) => {
    const e = getEvent(params.id);
    if (!e || e.status === 'hidden') fail(404, 'Event not found.');
    const uni = requireUni(body.uni_no);
    return tx(db, () => {
      const block = R.registrationBlock(e, e.registered, now());
      if (block) fail(409, block);
      const st = ensureStudent(uni, body, 'First time here? Add your full name so we can start your card.');
      const dupe = db.prepare('SELECT id FROM registrations WHERE event_id = ? AND uni_no = ?').get(e.id, uni);
      if (dupe) fail(409, `You're already registered for this event. Your code is ${R.ticketCode(e.id, dupe.id)}.`);
      const r = db.prepare("INSERT INTO registrations (event_id, uni_no, source) VALUES (?, ?, 'online')").run(e.id, uni);
      const regId = Number(r.lastInsertRowid);
      return { ok: true, code: R.ticketCode(e.id, regId), first_name: R.firstName(st.name) };
    });
  });

  add('GET', '/api/card/:uni', ({ params }) => cardData(requireUni(params.uni)));

  add('GET', '/api/teams', () => {
    const teams = db.prepare('SELECT * FROM teams ORDER BY category, name').all();
    const members = db.prepare(`SELECT m.team_id, m.role, s.name FROM team_members m
        JOIN students s ON s.uni_no = m.uni_no
        ORDER BY CASE WHEN m.role = 'Member' THEN 1 ELSE 0 END, s.name`).all();
    return {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        season: t.season,
        description: t.description,
        members: members.filter((m) => m.team_id === t.id).map((m) => ({ name: R.shortName(m.name), role: m.role })),
      })),
    };
  });

  // ---------------------------------------------------------------- admin auth
  const sessionFrom = (req) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(sha256(token).toString('hex'));
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  };

  add('POST', '/api/admin/login', ({ body, req, res }) => {
    const ip = req.socket.remoteAddress || '?';
    const f = loginFailures.get(ip);
    if (f && f.count >= 8 && f.until > Date.now()) fail(429, 'Too many attempts. Try again in a few minutes.');
    const ok = crypto.timingSafeEqual(sha256(body.password ?? ''), adminHash);
    if (!ok) {
      const next = f && f.until > Date.now() ? f.count + 1 : 1;
      loginFailures.set(ip, { count: next, until: Date.now() + 10 * 60 * 1000 });
      fail(401, 'Wrong password.');
    }
    loginFailures.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(sha256(token).toString('hex'), Date.now() + SESSION_MS);
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}`);
    return { ok: true };
  });

  add('POST', '/api/admin/logout', ({ req, res }) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(sha256(token).toString('hex'));
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return { ok: true };
  });

  add('GET', '/api/admin/me', ({ req }) => ({ admin: Boolean(sessionFrom(req)) }));

  // ---------------------------------------------------------------- admin: events
  add('GET', '/api/admin/stats', () => {
    const one = (sql, ...a) => Object.values(db.prepare(sql).get(...a))[0] ?? 0;
    return {
      stats: {
        students: one('SELECT COUNT(*) FROM students'),
        upcoming: one("SELECT COUNT(*) FROM events WHERE status IN ('announced','open','closed') AND ends_at >= ?", now()),
        registrations: one('SELECT COUNT(*) FROM registrations'),
        attended: one('SELECT COUNT(*) FROM registrations WHERE attended = 1'),
        credits: Math.round(one('SELECT COALESCE(SUM(amount), 0) FROM credits') * 100) / 100,
        teams: one('SELECT COUNT(*) FROM teams'),
      },
    };
  }, { admin: true });

  add('GET', '/api/admin/events', () => ({
    events: db.prepare(`${EVENT_SELECT} ORDER BY e.starts_at DESC, e.id DESC`).all().map(shapeEvent),
    now: now(),
  }), { admin: true });

  add('POST', '/api/admin/events', ({ body }) => {
    const { errors, value: v } = R.validateEvent(body);
    if (errors.length) fail(400, errors[0]);
    const r = db.prepare(`INSERT INTO events (title, summary, description, category, location, starts_at, ends_at, capacity, credits, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(v.title, v.summary, v.description, v.category, v.location, v.starts_at, v.ends_at, v.capacity, v.credits, v.status);
    return { event: shapeEvent(getEvent(Number(r.lastInsertRowid))) };
  }, { admin: true });

  add('PUT', '/api/admin/events/:id', ({ params, body }) => {
    const e = getEventOr404(params.id);
    const { errors, value: v } = R.validateEvent(body);
    if (errors.length) fail(400, errors[0]);
    return tx(db, () => {
      db.prepare(`UPDATE events SET title = ?, summary = ?, description = ?, category = ?, location = ?,
          starts_at = ?, ends_at = ?, capacity = ?, credits = ?, status = ? WHERE id = ?`)
        .run(v.title, v.summary, v.description, v.category, v.location, v.starts_at, v.ends_at, v.capacity, v.credits, v.status, e.id);
      const updated = getEvent(e.id);
      if (updated.credits !== e.credits || updated.title !== e.title) resyncAutoCredits(updated);
      return { event: shapeEvent(updated) };
    });
  }, { admin: true });

  add('DELETE', '/api/admin/events/:id', ({ params }) => {
    const e = getEventOr404(params.id);
    if (e.attended_count > 0) {
      fail(409, 'This event has attendance on record, so deleting it would remove stamps from loyalty cards. Set its status to Done or Hidden instead.');
    }
    db.prepare('DELETE FROM events WHERE id = ?').run(e.id);
    return { ok: true };
  }, { admin: true });

  const registrationsFor = (eventId) => db.prepare(`SELECT r.id, r.uni_no, r.source, r.attended, r.attended_at, r.created_at,
        s.name, s.email, s.major
      FROM registrations r JOIN students s ON s.uni_no = r.uni_no
      WHERE r.event_id = ? ORDER BY r.created_at, r.id`).all(eventId);

  add('GET', '/api/admin/events/:id/registrations', ({ params }) => {
    const e = getEventOr404(params.id);
    return {
      event: shapeEvent(e),
      registrations: registrationsFor(e.id).map((r) => ({ ...r, code: R.ticketCode(e.id, r.id) })),
    };
  }, { admin: true });

  add('GET', '/api/admin/events/:id/registrations.csv', ({ params, res }) => {
    const e = getEventOr404(params.id);
    const head = ['code', 'university_number', 'name', 'email', 'major', 'source', 'registered_at', 'attended', 'attended_at'];
    const lines = [head.join(',')];
    for (const r of registrationsFor(e.id)) {
      lines.push([R.ticketCode(e.id, r.id), r.uni_no, r.name, r.email, r.major, r.source, r.created_at, r.attended ? 'yes' : 'no', r.attended_at]
        .map(R.csvCell).join(','));
    }
    const slug = e.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cso-${e.id}-${slug}.csv"`,
      'Cache-Control': 'no-store',
    });
    res.end(`﻿${lines.join('\r\n')}\r\n`);
  }, { admin: true });

  add('POST', '/api/admin/events/:id/attendance', ({ params, body }) => {
    const e = getEventOr404(params.id);
    const uni = requireUni(body.uni_no);
    const attended = body.attended !== false;
    return tx(db, () => {
      const st = ensureStudent(uni, body);
      let reg = db.prepare('SELECT * FROM registrations WHERE event_id = ? AND uni_no = ?').get(e.id, uni);
      let walkIn = false;
      if (!reg) {
        if (!attended) fail(404, 'That student is not registered for this event.');
        const r = db.prepare("INSERT INTO registrations (event_id, uni_no, source) VALUES (?, ?, 'walk-in')").run(e.id, uni);
        reg = { id: Number(r.lastInsertRowid), attended: 0 };
        walkIn = true;
      }
      const already = Boolean(reg.attended) === attended;
      if (!already) {
        db.prepare('UPDATE registrations SET attended = ?, attended_at = ? WHERE id = ?')
          .run(attended ? 1 : 0, attended ? now() : null, reg.id);
      }
      if (attended && e.credits > 0) {
        db.prepare(`INSERT OR IGNORE INTO credits (uni_no, amount, reason, event_id, auto, created_at)
            VALUES (?, ?, ?, ?, 1, ?)`).run(uni, e.credits, `Attended: ${e.title}`, e.id, now());
      }
      if (!attended) db.prepare('DELETE FROM credits WHERE event_id = ? AND uni_no = ? AND auto = 1').run(e.id, uni);
      const stamps = db.prepare('SELECT COUNT(*) AS n FROM registrations WHERE uni_no = ? AND attended = 1').get(uni).n;
      return { ok: true, walk_in: walkIn, already, attended, student: { uni_no: uni, name: st.name }, stamps };
    });
  }, { admin: true });

  // ---------------------------------------------------------------- admin: credits
  add('GET', '/api/admin/credits', ({ url }) => {
    const q = R.str(url.searchParams.get('q'));
    const like = `%${q}%`;
    const ledger = db.prepare(`SELECT c.id, c.uni_no, c.amount, c.reason, c.auto, c.event_id, c.created_at, s.name
        FROM credits c JOIN students s ON s.uni_no = c.uni_no
        WHERE ? = '' OR c.uni_no LIKE ? OR s.name LIKE ? OR c.reason LIKE ?
        ORDER BY c.created_at DESC, c.id DESC LIMIT 300`).all(q, like, like, like);
    const leaders = db.prepare(`SELECT s.uni_no, s.name, ROUND(SUM(c.amount), 2) AS total, COUNT(*) AS entries
        FROM credits c JOIN students s ON s.uni_no = c.uni_no
        GROUP BY s.uni_no ORDER BY total DESC, s.name LIMIT 15`).all();
    return { ledger, leaders };
  }, { admin: true });

  add('POST', '/api/admin/credits', ({ body }) => {
    const uni = requireUni(body.uni_no);
    const { errors, value } = R.validateCredit(body);
    if (errors.length) fail(400, errors[0]);
    return tx(db, () => {
      const st = ensureStudent(uni, body);
      const r = db.prepare('INSERT INTO credits (uni_no, amount, reason, auto, created_at) VALUES (?, ?, ?, 0, ?)')
        .run(uni, value.amount, value.reason, now());
      const total = db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM credits WHERE uni_no = ?').get(uni).t;
      return { ok: true, id: Number(r.lastInsertRowid), student: { uni_no: uni, name: st.name }, total: Math.round(total * 100) / 100 };
    });
  }, { admin: true });

  add('DELETE', '/api/admin/credits/:id', ({ params }) => {
    const row = db.prepare('SELECT * FROM credits WHERE id = ?').get(Number(params.id));
    if (!row) fail(404, 'Credit entry not found.');
    if (row.auto) fail(409, 'This entry comes from event attendance. Un-mark the attendance to remove it.');
    db.prepare('DELETE FROM credits WHERE id = ?').run(row.id);
    return { ok: true };
  }, { admin: true });

  // ---------------------------------------------------------------- admin: teams
  const teamOr404 = (id) => db.prepare('SELECT * FROM teams WHERE id = ?').get(Number(id)) || fail(404, 'Team not found.');

  add('GET', '/api/admin/teams', () => {
    const teams = db.prepare('SELECT * FROM teams ORDER BY category, name').all();
    const members = db.prepare(`SELECT m.team_id, m.uni_no, m.role, s.name, s.email, s.major
        FROM team_members m JOIN students s ON s.uni_no = m.uni_no ORDER BY s.name`).all();
    return { teams: teams.map((t) => ({ ...t, members: members.filter((m) => m.team_id === t.id) })) };
  }, { admin: true });

  add('POST', '/api/admin/teams', ({ body }) => {
    const { errors, value: v } = R.validateTeam(body);
    if (errors.length) fail(400, errors[0]);
    const r = db.prepare('INSERT INTO teams (name, category, season, description) VALUES (?, ?, ?, ?)')
      .run(v.name, v.category, v.season, v.description);
    return { team: teamOr404(Number(r.lastInsertRowid)) };
  }, { admin: true });

  add('PUT', '/api/admin/teams/:id', ({ params, body }) => {
    const t = teamOr404(params.id);
    const { errors, value: v } = R.validateTeam(body);
    if (errors.length) fail(400, errors[0]);
    db.prepare('UPDATE teams SET name = ?, category = ?, season = ?, description = ? WHERE id = ?')
      .run(v.name, v.category, v.season, v.description, t.id);
    return { team: teamOr404(t.id) };
  }, { admin: true });

  add('DELETE', '/api/admin/teams/:id', ({ params }) => {
    const t = teamOr404(params.id);
    db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
    return { ok: true };
  }, { admin: true });

  add('POST', '/api/admin/teams/:id/members', ({ params, body }) => {
    const t = teamOr404(params.id);
    const uni = requireUni(body.uni_no);
    const role = R.str(body.role) || 'Member';
    if (role.length > 40) fail(400, 'Role is too long (40 characters max).');
    return tx(db, () => {
      const st = ensureStudent(uni, body);
      db.prepare(`INSERT INTO team_members (team_id, uni_no, role) VALUES (?, ?, ?)
          ON CONFLICT (team_id, uni_no) DO UPDATE SET role = excluded.role`).run(t.id, uni, role);
      return { ok: true, member: { uni_no: uni, name: st.name, role } };
    });
  }, { admin: true });

  add('DELETE', '/api/admin/teams/:id/members/:uni', ({ params }) => {
    const t = teamOr404(params.id);
    const uni = requireUni(params.uni);
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND uni_no = ?').run(t.id, uni);
    return { ok: true };
  }, { admin: true });

  // ---------------------------------------------------------------- admin: students
  add('GET', '/api/admin/students', ({ url }) => {
    const q = R.str(url.searchParams.get('q'));
    const like = `%${q}%`;
    const rows = db.prepare(`SELECT s.*,
          (SELECT COUNT(*) FROM registrations r WHERE r.uni_no = s.uni_no AND r.attended = 1) AS stamps,
          (SELECT COUNT(*) FROM registrations r WHERE r.uni_no = s.uni_no) AS registrations,
          (SELECT ROUND(COALESCE(SUM(c.amount), 0), 2) FROM credits c WHERE c.uni_no = s.uni_no) AS credits,
          (SELECT GROUP_CONCAT(t.name, ', ') FROM team_members m JOIN teams t ON t.id = m.team_id WHERE m.uni_no = s.uni_no) AS teams
        FROM students s
        WHERE ? = '' OR s.uni_no LIKE ? OR s.name LIKE ? OR s.email LIKE ?
        ORDER BY s.name LIMIT 300`).all(q, like, like, like);
    return { students: rows.map((s) => ({ ...s, tier: R.tierFor(s.stamps).name })) };
  }, { admin: true });

  add('GET', '/api/admin/students/:uni', ({ params }) => {
    const uni = requireUni(params.uni);
    const st = getStudent(uni) || fail(404, 'Student not found.');
    return { student: st, card: cardData(uni) };
  }, { admin: true });

  add('PUT', '/api/admin/students/:uni', ({ params, body }) => {
    const uni = requireUni(params.uni);
    if (!getStudent(uni)) fail(404, 'Student not found.');
    const { errors, value } = R.validateStudent(body);
    if (errors.length) fail(400, errors[0]);
    db.prepare('UPDATE students SET name = ?, email = ?, major = ? WHERE uni_no = ?')
      .run(value.name, value.email || null, value.major || null, uni);
    return { student: getStudent(uni) };
  }, { admin: true });

  // ---------------------------------------------------------------- dispatch
  async function handleApi(req, res, url) {
    const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
    if (!match) {
      const exists = routes.some((r) => r.re.test(url.pathname));
      fail(exists ? 405 : 404, exists ? 'Method not allowed.' : 'Not found.');
    }
    if (match.admin && !sessionFrom(req)) fail(401, 'Please sign in as an admin.');

    const params = {};
    const m = match.re.exec(url.pathname);
    match.keys.forEach((k, i) => {
      try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = ''; }
    });

    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      const raw = await readBody(req);
      if (raw) {
        if (!String(req.headers['content-type'] || '').includes('application/json')) fail(415, 'Send JSON.');
        try { body = JSON.parse(raw); } catch { fail(400, 'Invalid JSON.'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid JSON body.');
      }
    }

    const out = await match.handler({ req, res, url, params, body });
    if (!res.headersSent) sendJson(res, 200, out ?? { ok: true });
  }

  function serveFile(req, res, file, cache = 'no-cache') {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': cache,
      });
      if (req.method === 'HEAD') res.end();
      else fs.createReadStream(file).pipe(res);
    });
  }

  function serveStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      res.end();
      return;
    }
    let p = url.pathname;
    if (p === '/brand/logo') {
      const logo = LOGO_CANDIDATES.find((f) => fs.existsSync(f)) || path.join(PUBLIC_DIR, 'assets', 'logo-placeholder.svg');
      serveFile(req, res, logo);
      return;
    }
    if (p === '/brand/mark') {
      const mark = path.join(PUBLIC_DIR, 'assets', 'logo-mark.png');
      serveFile(req, res, fs.existsSync(mark) ? mark : LOGO_CANDIDATES.find((f) => fs.existsSync(f)) || path.join(PUBLIC_DIR, 'assets', 'logo-placeholder.svg'));
      return;
    }
    if (p === '/') p = '/index.html';
    else if (p === '/admin' || p === '/admin/') p = '/admin.html';
    let decoded;
    try { decoded = decodeURIComponent(p); } catch { decoded = '/__invalid__'; }
    const file = path.normalize(path.join(PUBLIC_DIR, decoded));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    serveFile(req, res, file);
  }

  const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Something went wrong on our side.' : err.message });
      else res.end();
    }
  });

  return { server, db };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3500;
  const password = process.env.CSO_ADMIN_PASSWORD || 'cso-admin';
  if (!process.env.CSO_ADMIN_PASSWORD) {
    console.warn('! CSO_ADMIN_PASSWORD is not set, so the admin password is "cso-admin". Set it before going live.');
  }
  const { server } = createApp({ dbPath: process.env.CSO_DB || path.join(__dirname, 'data', 'cso.db'), adminPassword: password });
  server.listen(port, () => {
    console.log(`CSO PSUT is running:  http://localhost:${port}`);
    console.log(`Admin panel:          http://localhost:${port}/admin`);
  });
}

module.exports = { createApp };
