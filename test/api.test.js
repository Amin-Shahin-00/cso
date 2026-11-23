'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');

const NOW = '2026-11-20T10:00';

async function boot() {
  const app = createApp({ dbPath: ':memory:', adminPassword: 'pw', now: () => NOW });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  const call = async (method, path, body, { auth = true } = {}) => {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (auth && cookie) headers.Cookie = cookie;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
  return { app, call, close: () => new Promise((r) => app.server.close(r)) };
}

const event = (over = {}) => ({
  title: 'Campus blood drive', category: 'Donation drive', location: 'Main hall',
  starts_at: '2026-11-25T13:00', capacity: 2, credits: 2, status: 'open', ...over,
});

test('admin endpoints need a session; wrong password is rejected', async () => {
  const t = await boot();
  try {
    assert.equal((await t.call('GET', '/api/admin/events')).status, 401);
    assert.equal((await t.call('POST', '/api/admin/login', { password: 'nope' })).status, 401);
    assert.equal((await t.call('POST', '/api/admin/login', { password: 'pw' })).status, 200);
    assert.equal((await t.call('GET', '/api/admin/events')).status, 200);
    await t.call('POST', '/api/admin/logout');
    assert.equal((await t.call('GET', '/api/admin/events')).status, 401);
  } finally { await t.close(); }
});

test('full flow: create event, register, capacity, attendance, credits, card', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/admin/login', { password: 'pw' });
    const { data: { event: ev } } = await t.call('POST', '/api/admin/events', event());
    await t.call('POST', '/api/admin/events', event({ title: 'Future contest', status: 'announced', starts_at: '2026-12-20T10:00' }));

    // Public listing shows both, in date order
    const up = await t.call('GET', '/api/events?scope=upcoming');
    assert.deepEqual(up.data.events.map((e) => e.status), ['open', 'announced']);

    // New student must give a name
    const noName = await t.call('POST', `/api/events/${ev.id}/register`, { uni_no: '20240147' });
    assert.equal(noName.status, 400);
    assert.match(noName.data.error, /full name/);

    const reg = await t.call('POST', `/api/events/${ev.id}/register`, { uni_no: '2024 0147', name: 'Tala Barakat' });
    assert.equal(reg.status, 200);
    assert.match(reg.data.code, /^CSO-\d{3}-\d{4}$/);

    // Known student now; duplicate blocked
    assert.deepEqual((await t.call('GET', '/api/students/20240147')).data, { known: true, first_name: 'Tala' });
    assert.equal((await t.call('POST', `/api/events/${ev.id}/register`, { uni_no: '20240147' })).status, 409);

    // Capacity 2
    assert.equal((await t.call('POST', `/api/events/${ev.id}/register`, { uni_no: '20230017', name: 'Sara Mansour' })).status, 200);
    const full = await t.call('POST', `/api/events/${ev.id}/register`, { uni_no: '20220114', name: 'Lina Haddad' });
    assert.equal(full.status, 409);
    assert.match(full.data.error, /full/);

    // Attendance: registered student + a walk-in
    const a1 = await t.call('POST', `/api/admin/events/${ev.id}/attendance`, { uni_no: '20240147' });
    assert.equal(a1.data.stamps, 1);
    // Lina's failed registration created nothing, so a walk-in check-in needs her name
    const noNameWalk = await t.call('POST', `/api/admin/events/${ev.id}/attendance`, { uni_no: '20220114' });
    assert.equal(noNameWalk.status, 400);
    const walk = await t.call('POST', `/api/admin/events/${ev.id}/attendance`, { uni_no: '20220114', name: 'Lina Haddad' });
    assert.equal(walk.status, 200);
    assert.ok(walk.data.walk_in);

    // Checking in twice doesn't double the credits
    await t.call('POST', `/api/admin/events/${ev.id}/attendance`, { uni_no: '20240147' });
    let card = await t.call('GET', '/api/card/20240147');
    assert.equal(card.data.loyalty.stamps, 1);
    assert.equal(card.data.credits_total, 2);
    assert.equal(card.data.student.display_name, 'Tala B.');

    // Manual credits add up; auto credits can't be deleted directly
    await t.call('POST', '/api/admin/credits', { uni_no: '20240147', amount: 1.5, reason: 'Helped at check-in' });
    card = await t.call('GET', '/api/card/20240147');
    assert.equal(card.data.credits_total, 3.5);
    const ledger = await t.call('GET', '/api/admin/credits?q=20240147');
    const auto = ledger.data.ledger.find((c) => c.auto);
    assert.equal((await t.call('DELETE', `/api/admin/credits/${auto.id}`)).status, 409);

    // Changing event credits re-syncs the auto entries
    await t.call('PUT', `/api/admin/events/${ev.id}`, event({ credits: 3 }));
    card = await t.call('GET', '/api/card/20240147');
    assert.equal(card.data.credits_total, 4.5);

    // Un-marking attendance removes the stamp and the credits
    await t.call('POST', `/api/admin/events/${ev.id}/attendance`, { uni_no: '20240147', attended: false });
    card = await t.call('GET', '/api/card/20240147');
    assert.equal(card.data.loyalty.stamps, 0);
    assert.equal(card.data.credits_total, 1.5);

    // Events with attendance can't be deleted
    assert.equal((await t.call('DELETE', `/api/admin/events/${ev.id}`)).status, 409);

    // CSV export
    const csv = await t.call('GET', `/api/admin/events/${ev.id}/registrations.csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.data, /university_number/);
    assert.match(csv.data, /20220114/);
  } finally { await t.close(); }
});

test('announced and hidden events refuse registration; unknown card is 404', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/admin/login', { password: 'pw' });
    const ann = (await t.call('POST', '/api/admin/events', event({ status: 'announced' }))).data.event;
    const hid = (await t.call('POST', '/api/admin/events', event({ status: 'hidden' }))).data.event;
    assert.equal((await t.call('POST', `/api/events/${ann.id}/register`, { uni_no: '20240147', name: 'Tala B' })).status, 409);
    assert.equal((await t.call('GET', `/api/events/${hid.id}`)).status, 404);
    assert.equal((await t.call('GET', '/api/card/99999999')).status, 404);
    assert.equal((await t.call('GET', '/api/card/123')).status, 400);
  } finally { await t.close(); }
});

test('teams: create, add members (creating students), public view hides numbers', async () => {
  const t = await boot();
  try {
    await t.call('POST', '/api/admin/login', { password: 'pw' });
    const team = (await t.call('POST', '/api/admin/teams', { name: 'Null Pointers', category: 'Competition team', season: '2026/27' })).data.team;
    assert.equal((await t.call('POST', `/api/admin/teams/${team.id}/members`, { uni_no: '20220114' })).status, 400);
    assert.equal((await t.call('POST', `/api/admin/teams/${team.id}/members`, { uni_no: '20220114', name: 'Lina Haddad', role: 'Captain' })).status, 200);
    const pub = await t.call('GET', '/api/teams', null, { auth: false });
    assert.deepEqual(pub.data.teams[0].members, [{ name: 'Lina H.', role: 'Captain' }]);
    assert.ok(!JSON.stringify(pub.data).includes('20220114'));
    await t.call('DELETE', `/api/admin/teams/${team.id}/members/20220114`);
    assert.equal((await t.call('GET', '/api/teams')).data.teams[0].members.length, 0);
  } finally { await t.close(); }
});

test('static files: logo fallback and no path traversal', async () => {
  const t = await boot();
  try {
    const port = t.app.server.address().port;
    const logo = await fetch(`http://127.0.0.1:${port}/brand/logo`);
    assert.equal(logo.status, 200);
    const trav = await fetch(`http://127.0.0.1:${port}/..%2fserver.js`);
    assert.equal(trav.status, 404);
  } finally { await t.close(); }
});
