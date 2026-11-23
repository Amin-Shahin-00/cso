'use strict';
// Wipes the database and fills it with demo data. Dates are relative to today so the demo always looks current.
// Usage: node seed.js            -> data/cso.db
//        CSO_DB=path node seed.js
const fs = require('node:fs');
const path = require('node:path');
const { openDb, tx } = require('./db');
const R = require('./lib/rules');

const file = process.env.CSO_DB || path.join(__dirname, 'data', 'cso.db');
for (const f of [file, `${file}-wal`, `${file}-shm`]) fs.rmSync(f, { force: true });
const db = openDb(file);

const at = (dayOffset, hh, mm = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return R.localStamp(d);
};

const students = [
  ['20220114', 'Lina Haddad', 'Computer Science'],
  ['20220391', 'Omar Khalil', 'Cybersecurity'],
  ['20230017', 'Sara Mansour', 'Software Engineering'],
  ['20230258', 'Yazan Abu-Odeh', 'Data Science'],
  ['20230442', 'Dana Qasem', 'Business'],
  ['20230671', 'Hamza Nasser', 'Electrical Engineering'],
  ['20230809', 'Rania Saleh', 'Computer Engineering'],
  ['20240033', 'Zaid Hourani', 'Software Engineering'],
  ['20240147', 'Tala Barakat', 'Computer Science'],
  ['20240290', 'Kareem Odeh', 'Business'],
  ['20240512', 'Noor Jaber', 'Data Science'],
  ['20240768', 'Faris Tamimi', 'Artificial Intelligence'],
];

// [title, summary, description, category, location, start, hours, capacity, credits, status]
const events = [
  ['Volunteer orientation', 'How the CSO works, how credits are counted, and the semester plan.',
    'A short introduction for new volunteers. We explain the activities planned for this semester, how CSO credits are recorded, and how to join a team.\n\nNew and returning volunteers are welcome.',
    'Training', 'Main campus hall', at(-46, 11), 1.5, 0, 1, 'done'],
  ['Campus clean-up morning', 'Gloves and bags provided. Meet at the main gate.',
    'We split into groups and clean the campus gardens and parking areas. Wear comfortable shoes. Water and breakfast are provided.',
    'Volunteering', 'Main gate', at(-39, 9), 3, 50, 3, 'done'],
  ['Winter clothes collection', 'Sorting and packing donated winter clothes.',
    'Help us sort the donated clothes by size and type and pack them for delivery to families in need.',
    'Donation drive', 'Student activities building', at(-31, 12), 3, 40, 3, 'done'],
  ['Visit to an elderly care home', 'An afternoon of conversation, tea and games with residents.',
    'We travel together by bus from campus. Please be on time. The visit lasts about three hours including travel.',
    'Visit', 'Departure: Main gate', at(-22, 14), 4, 25, 4, 'done'],
  ['First aid basics', 'A certified trainer covers CPR and basic first aid.',
    'Practical session with mannequins. Useful for every volunteer, especially those joining field activities.',
    'Workshop', 'Seminar room 2', at(-12, 12), 2, 30, 2, 'done'],
  ['Reading corner for kids', 'Read stories with children at a community centre.',
    'Volunteers read and play with children aged 6–10. Books are provided by the CSO.',
    'Visit', 'Community centre (bus from campus)', at(-5, 10), 4, 20, 3, 'done'],
  ['Campus blood donation drive', 'Donate blood or help run the registration desk.',
    'Organised with a hospital blood bank team. Donors need to be 18+ and in good health. Eat breakfast before donating.\n\nNot donating? You can still volunteer at the desk.',
    'Donation drive', 'Main campus hall', at(3, 9), 6, 60, 2, 'open'],
  ['Food parcel packing', 'Pack food parcels for families before the winter break.',
    'We pack basic food items into parcels for distribution through a partner charity. Expect to be on your feet for most of the session.',
    'Volunteering', 'Student activities building', at(6, 13), 3, 40, 3, 'open'],
  ['Tree planting day', 'Plant trees around the new campus garden.',
    'Tools and seedlings are provided. Bring a hat and water. Transport is not needed; the planting is on campus.',
    'Volunteering', 'Campus garden', at(10, 9), 4, 80, 3, 'open'],
  ['Awareness talk: digital safety for families', 'Prepare a short talk for parents on online safety.',
    'Volunteers help prepare and deliver a simple talk on safe internet use for families at a local school.',
    'Campaign', 'Seminar room 1', at(13, 15), 2, 0, 2, 'open'],
  ['Beach clean-up trip', 'A full-day trip to clean a public beach.',
    'Bus leaves campus early in the morning and returns in the evening. Limited places. Volunteers with a Helper level or above get priority.',
    'Volunteering', 'Departure: Main gate', at(24, 6, 30), 14, 30, 6, 'announced'],
  ['Ramadan iftar packing', 'Prepare iftar meals for distribution.',
    'Details and time will be announced closer to the date.',
    'Donation drive', 'Student activities building', at(38, 15), 3, 60, 3, 'announced'],
];

// Attendance for past events: index into students list
const attendance = {
  0: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  1: [0, 2, 3, 5, 7, 8, 11],
  2: [0, 1, 2, 5, 6, 8, 9, 10],
  3: [0, 1, 4, 5, 9],
  4: [0, 2, 3, 4, 7, 8, 10, 11],
  5: [0, 2, 8, 11],
};
const noShows = { 1: [1, 9], 3: [2, 8], 5: [5] };
const upcomingRegs = { 6: [0, 2, 3, 8, 10], 7: [1, 2, 4, 7], 8: [0, 1, 2, 4, 5, 6, 8, 9, 11], 9: [3, 6] };

const teams = [
  ['Field team', 'Volunteer team', '2026/27', 'Leads groups on visits and outdoor activities, and handles check-in on the day.', [[0, 'Leader'], [5, 'Member'], [9, 'Member'], [11, 'Member']]],
  ['Donation drives team', 'Volunteer team', '2026/27', 'Runs the clothes, food and blood donation drives from collection to delivery.', [[2, 'Leader'], [7, 'Member'], [10, 'Member']]],
  ['Events committee', 'Committee', '2026/27', 'Plans the semester calendar, books rooms and transport, and coordinates with partners.', [[2, 'Head'], [8, 'Member'], [3, 'Member']]],
  ['Media committee', 'Committee', '2026/27', 'Posters, photos and the CSO social media accounts.', [[4, 'Head'], [6, 'Member']]],
];

tx(db, () => {
  const insS = db.prepare('INSERT INTO students (uni_no, name, email, major, created_at) VALUES (?, ?, ?, ?, ?)');
  students.forEach(([uni, name, major], i) => {
    const email = `${name.split(' ')[0].toLowerCase()}${uni}@std.psut.edu.jo`;
    insS.run(uni, name, email, major, at(-60 + i, 10));
  });

  const insE = db.prepare(`INSERT INTO events (title, summary, description, category, location, starts_at, ends_at, capacity, credits, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insR = db.prepare('INSERT INTO registrations (event_id, uni_no, source, attended, attended_at, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  const insC = db.prepare('INSERT INTO credits (uni_no, amount, reason, event_id, auto, created_at) VALUES (?, ?, ?, ?, ?, ?)');

  events.forEach((e, idx) => {
    const [title, summary, description, category, location, start, hours, capacity, credits, status] = e;
    const id = Number(insE.run(title, summary, description, category, location, start, R.addHours(start, hours), capacity, credits, status).lastInsertRowid);
    const regAt = R.addHours(start, -72);
    for (const si of attendance[idx] || []) {
      const uni = students[si][0];
      insR.run(id, uni, si % 5 === 4 ? 'walk-in' : 'online', 1, R.addHours(start, 0.25), regAt);
      if (credits > 0) insC.run(uni, credits, `Attended: ${title}`, id, 1, R.addHours(start, 0.25));
    }
    for (const si of noShows[idx] || []) insR.run(id, students[si][0], 'online', 0, null, regAt);
    for (const si of upcomingRegs[idx] || []) insR.run(id, students[si][0], 'online', 0, null, at(-1, 18));
  });

  // A few manual credits given by the office
  insC.run('20230017', 3, 'Organised the clothes collection desk', null, 0, at(-30, 15));
  insC.run('20220391', 4, 'Drove the donation boxes to the partner charity', null, 0, at(-29, 12));
  insC.run('20230442', 2, 'Designed the semester poster series', null, 0, at(-35, 12));
  insC.run('20240147', 1, 'Helped with check-in at the first aid workshop', null, 0, at(-12, 14));

  const insT = db.prepare('INSERT INTO teams (name, category, season, description) VALUES (?, ?, ?, ?)');
  const insM = db.prepare('INSERT INTO team_members (team_id, uni_no, role) VALUES (?, ?, ?)');
  for (const [name, category, season, description, members] of teams) {
    const id = Number(insT.run(name, category, season, description).lastInsertRowid);
    for (const [si, role] of members) insM.run(id, students[si][0], role);
  }
});

db.close();
console.log(`Seeded ${students.length} students, ${events.length} events, ${teams.length} teams into ${file}`);
console.log('Try the card with 20220114 (Volunteer level, 6 hearts), 20230017 (Helper) or 20240147.');
