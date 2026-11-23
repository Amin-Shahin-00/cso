# PSUT Community Service Office (CSO)

Website for the Community Service Office at Princess Sumaya University for Technology. The design is built around the CSO logo: its teal and grey colours, Montserrat headings that match the logo lettering, and loyalty-card stamps that use the heart from the logo.

Student-friendly details: each activity has a visible Register button, the home page explains the process in 3 steps, and the site remembers the student's university number on their device so they don't have to retype it.

- **Events.** Admins post events and students register with their university number. Events can be *open*, *announced* ("Coming up later", registration not open yet), *closed*, *done* (moves to the archive), or *hidden* (draft).
- **Loyalty card.** Each student's card is keyed on their university number. Every attended event adds a stamp, and 10 stamps fill a card. Tiers: Newcomer, Regular (3+), Core (6+), Legend (10+).
- **CSO credits.** Events can award credits automatically on check-in. Admins can also add or remove credits by hand, and every change goes into a ledger.
- **Selected teams.** A database of committees and competition teams with their members and roles. The public Teams page shows names only, never university numbers.
- **Admin panel** at `/admin`, with five sections: events, check-in (including walk-ins), registration CSV export, credits, teams, and students.

It has no dependencies. It runs on Node 22.13+ using the built-in `node:sqlite`.

## Run it

```
npm run demo     # wipe + load demo data, then start
npm start        # start with the existing data (http://localhost:3500)
npm test         # 10 tests
```

Admin password: set `CSO_ADMIN_PASSWORD` before starting. If it is not set, the password is `cso-admin`.

```powershell
$env:CSO_ADMIN_PASSWORD = "something-long"; npm start
```

Other settings: `PORT` (default 3500) and `CSO_DB` (default `data/cso.db`).

Demo university numbers for the card: `20220114` (Volunteer level, 6 hearts), `20230017`, `20240147`.

## Logo

- `public/assets/logo.png` is the full logo, shown large on the home page.
- `public/assets/logo-mark.png` is the heart mark alone, used in the top-left corner (next to the "PSUT Community / Service Office" wording), on the card, as the stamps, and as the tab icon.

To change the logo, replace these two files.

## Where things are

| File | What |
|---|---|
| `server.js` | HTTP server and every API route |
| `db.js` | SQLite schema |
| `lib/rules.js` | Validation, tiers, card size, the reward text, event categories, majors |
| `seed.js` | Demo data |
| `public/index.html`, `app.js` | Public site |
| `public/admin.html`, `admin.js` | Admin panel |
| `public/styles.css` | All styling. Colours are the variables at the top. |
