'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/rules');

test('university numbers are 8 digits after trimming spaces and dashes', () => {
  assert.equal(R.normalizeUni(' 2023-0017 '), '20230017');
  assert.ok(R.isUni('20230017'));
  assert.ok(!R.isUni('2023001'));
  assert.ok(!R.isUni('2023001a'));
});

test('loyalty: tiers and card filling', () => {
  assert.deepEqual(
    [0, 2, 3, 6, 10].map((n) => R.loyalty(n).tier),
    ['Newcomer', 'Newcomer', 'Helper', 'Volunteer', 'Champion'],
  );
  const l4 = R.loyalty(4);
  assert.equal(l4.card_no, 1);
  assert.equal(l4.on_card, 4);
  assert.equal(l4.next_tier, 'Volunteer');
  assert.equal(l4.to_next, 2);

  const l10 = R.loyalty(10);
  assert.equal(l10.card_no, 1);
  assert.equal(l10.on_card, 10);
  assert.ok(l10.card_complete);
  assert.equal(l10.completed_cards, 1);
  assert.equal(l10.next_tier, null);

  const l11 = R.loyalty(11);
  assert.equal(l11.card_no, 2);
  assert.equal(l11.on_card, 1);
  assert.ok(!l11.card_complete);
});

test('validateEvent: defaults end to +2h and rejects bad input', () => {
  const ok = R.validateEvent({ title: 'Docker', starts_at: '2026-12-01T13:00', capacity: '40', credits: '2' });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value.ends_at, '2026-12-01T15:00');
  assert.equal(ok.value.capacity, 40);
  assert.equal(ok.value.status, 'open');

  assert.match(R.validateEvent({ starts_at: '2026-12-01T13:00' }).errors[0], /Title/);
  assert.match(R.validateEvent({ title: 'x', starts_at: '2026-02-30T13:00' }).errors[0], /Start/);
  assert.match(R.validateEvent({ title: 'x', starts_at: '2026-12-01T13:00', ends_at: '2026-12-01T12:00' }).errors[0], /end after/);
  assert.match(R.validateEvent({ title: 'x', starts_at: '2026-12-01T13:00', capacity: -1 }).errors[0], /Capacity/);
  assert.match(R.validateEvent({ title: 'x', starts_at: '2026-12-01T13:00', status: 'nope' }).errors[0], /status/);
});

test('registrationBlock covers every status, the past and capacity', () => {
  const base = { status: 'open', starts_at: '2026-12-01T13:00', ends_at: '2026-12-01T15:00', capacity: 2 };
  const now = '2026-11-20T10:00';
  assert.equal(R.registrationBlock(base, 1, now), null);
  assert.match(R.registrationBlock(base, 2, now), /full/);
  assert.match(R.registrationBlock({ ...base, status: 'announced' }, 0, now), /not opened/);
  assert.match(R.registrationBlock({ ...base, status: 'closed' }, 0, now), /closed/);
  assert.match(R.registrationBlock({ ...base, status: 'done' }, 0, now), /not taking/);
  assert.match(R.registrationBlock(base, 0, '2026-12-02T10:00'), /already happened/);
  assert.equal(R.registrationBlock({ ...base, capacity: 0 }, 500, now), null);
});

test('names, codes and CSV cells', () => {
  assert.equal(R.shortName('Yazan Abu-Odeh'), 'Yazan A.');
  assert.equal(R.shortName('Lina'), 'Lina');
  assert.equal(R.ticketCode(7, 45), 'CSO-007-0045');
  assert.equal(R.csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(R.csvCell('a,b'), '"a,b"');
  assert.equal(R.csvCell(-2), '-2');
});
