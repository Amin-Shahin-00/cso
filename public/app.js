'use strict';
(() => {
  const view = document.getElementById('view');
  const dlg = document.getElementById('event-dialog');
  const dlgBody = document.getElementById('dlg-body');

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const svg = (d, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICON = {
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    cal: svg('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    pin: svg('<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
    seats: svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.9.6 3.1 2.4 3.5 5.2"/>'),
    star: svg('<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 30),
  };

  let meta = null;
  let currentView = null;
  let baseHash = '#/';
  let dirty = false;

  // ---------------------------------------------------------------- utils
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const parse = (dt) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(dt || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  };
  const fmtTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const fmtDate = (d) => `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const fmtShort = (d) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
  const credLabel = (c) => plural(c, 'CSO credit');

  // The student's university number is remembered on this device only, so they don't retype it.
  const store = {
    get() { try { return localStorage.getItem('cso-uni') || ''; } catch { return ''; } },
    set(v) { try { localStorage.setItem('cso-uni', v); } catch { /* private mode */ } },
    clear() { try { localStorage.removeItem('cso-uni'); } catch { /* ignore */ } },
  };
  const digitsOnly = (input) => input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 8); });

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (!res.ok) throw new Error((data && data.error) || `Something went wrong (${res.status}). Please try again.`);
    return data;
  }

  const loading = (label = 'Loading') => `<div class="loading">${esc(label)}</div>`;
  const errorBox = (err) => `<div class="error-box">${esc(err.message || err)}</div>`;

  // ---------------------------------------------------------------- event cards
  function sideFor(e, past) {
    const tags = [`<span class="tag">${esc(e.category)}</span>`];
    if (e.credits > 0) tags.push(`<span class="tag credit">+${esc(credLabel(e.credits))}</span>`);
    let status = '';
    let button = `<a class="btn ghost sm" href="#/event/${e.id}">Details</a>`;
    if (past) {
      status = `<span class="seats">${plural(e.attended_count, 'volunteer')} took part</span>`;
    } else if (e.status === 'announced') {
      tags.push('<span class="tag soon">Registration opens soon</span>');
    } else if (e.status === 'closed') {
      tags.push('<span class="tag closed">Registration closed</span>');
    } else {
      if (e.capacity > 0) {
        const pct = Math.min(100, Math.round((e.registered / e.capacity) * 100));
        status = `<span class="seats">${e.seats_left === 0 ? '<strong>Full</strong>' : `<span><strong>${e.seats_left}</strong> of ${e.capacity} places left</span>`}
          <span class="bar ${pct >= 80 ? 'hot' : ''}"><i style="width:${pct}%"></i></span></span>`;
      } else {
        status = '<span class="seats">Open to everyone</span>';
      }
      if (e.seats_left !== 0) button = `<a class="btn sm" href="#/event/${e.id}">Register</a>`;
    }
    return `<div class="tags">${tags.join('')}</div>${status}${button}`;
  }

  function row(e, { past = false } = {}) {
    const d = parse(e.starts_at);
    return `<li class="ev ${past ? 'is-past' : ''}">
      <div class="ev-date" aria-hidden="true">
        <span class="ev-day">${d.getDate()}</span>
        <span class="ev-mon">${MONTHS[d.getMonth()]}</span>
        <span class="ev-wd">${past ? d.getFullYear() : DAYS[d.getDay()]}</span>
      </div>
      <div class="ev-main">
        <h3 class="ev-title"><a href="#/event/${e.id}">${esc(e.title)}</a></h3>
        ${e.summary ? `<p class="ev-sum">${esc(e.summary)}</p>` : ''}
        <p class="ev-meta">
          <span>${ICON.cal}${fmtDate(d)}</span>
          <span>${ICON.clock}${fmtTime(d)}</span>
          ${e.location ? `<span>${ICON.pin}${esc(e.location)}</span>` : ''}
        </p>
      </div>
      <div class="ev-side">${sideFor(e, past)}</div>
    </li>`;
  }

  const listOrEmpty = (events, emptyText, opts) =>
    events.length ? `<ul class="ev-list">${events.map((e) => row(e, opts)).join('')}</ul>` : `<p class="empty">${esc(emptyText)}</p>`;

  // ---------------------------------------------------------------- views
  async function renderHome() {
    view.innerHTML = loading('Loading events');
    const { events } = await api('/api/events?scope=upcoming');
    const open = events.filter((e) => e.status !== 'announced');
    const later = events.filter((e) => e.status === 'announced');
    const cats = [...new Set(open.map((e) => e.category))];
    const saved = store.get();

    view.innerHTML = `
      <section class="hero">
        <div>
          <h1>Volunteer with the CSO, <span>one activity at a time.</span></h1>
          <p class="lede">Pick an activity, register with your university number, and get checked in on the day.
            Each activity you attend adds a heart to your card and CSO credits to your record.</p>
          <ol class="steps">
            <li><b>1</b><span><strong>Choose</strong>an activity below</span></li>
            <li><b>2</b><span><strong>Register</strong>with your uni number</span></li>
            <li><b>3</b><span><strong>Attend</strong>and collect a heart</span></li>
          </ol>
          <form class="quick-card" id="quick-card" novalidate>
            <label for="qc-uni">Check my card</label>
            <input class="input uni-input" id="qc-uni" inputmode="numeric" maxlength="8" placeholder="University no." value="${esc(saved)}" autocomplete="off">
            <button class="btn" type="submit">Open</button>
          </form>
        </div>
        <div class="hero-logo"><img src="/brand/logo" alt="PSUT Community Service Office logo"></div>
      </section>

      <section class="listing" id="open-events">
        <header class="section-head">
          <h2>Open for registration</h2>
          <span class="count">${open.length}</span>
          ${cats.length > 1 ? `<div class="filters" role="group" aria-label="Filter by type">
            <button class="chip" type="button" data-cat="" aria-pressed="true">All</button>
            ${cats.map((c) => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('')}
          </div>` : ''}
        </header>
        <div id="open-list">${listOrEmpty(open, 'No activities are open right now. New ones appear here first.')}</div>
      </section>

      <section class="listing">
        <header class="section-head">
          <h2>Coming up later</h2>
          <span class="count">${later.length}</span>
        </header>
        <p class="section-note">Future CSO activities. Registration opens closer to the date.</p>
        ${listOrEmpty(later, 'No future activities announced yet.')}
      </section>

      <section class="teaser">
        <div>
          <h2>Ten activities fill your card</h2>
          <p>Your card works with your university number, so there's no app to download or account to create. ${esc(meta ? meta.reward : '')}</p>
          <a class="btn light" href="#/card">Open my card</a>
        </div>
        <div class="mini-hearts" aria-hidden="true">${Array.from({ length: 10 }, (_, i) => `<span class="${i < 6 ? 'on' : ''}"></span>`).join('')}</div>
      </section>`;

    const qc = document.getElementById('quick-card');
    const qcInput = document.getElementById('qc-uni');
    digitsOnly(qcInput);
    qc.addEventListener('submit', (ev) => {
      ev.preventDefault();
      location.hash = qcInput.value ? `#/card/${qcInput.value}` : '#/card';
    });
    view.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cat = btn.dataset.cat;
        view.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        const shown = cat ? open.filter((e) => e.category === cat) : open;
        document.getElementById('open-list').innerHTML = listOrEmpty(shown, `No ${cat.toLowerCase()} activities open right now.`);
      });
    });
  }

  async function renderArchive() {
    view.innerHTML = loading('Loading past events');
    const { events } = await api('/api/events?scope=past');
    view.innerHTML = `
      <section class="page-head">
        <span class="kicker">Past events</span>
        <h1>What we've done together</h1>
        <p class="lede">CSO activities that already happened, newest first.</p>
      </section>
      ${listOrEmpty(events, 'Nothing here yet.', { past: true })}`;
  }

  async function renderTeams() {
    view.innerHTML = loading('Loading teams');
    const { teams } = await api('/api/teams');
    const groups = new Map();
    for (const t of teams) {
      if (!groups.has(t.category)) groups.set(t.category, []);
      groups.get(t.category).push(t);
    }
    view.innerHTML = `
      <section class="page-head">
        <span class="kicker">Teams</span>
        <h1>Selected teams</h1>
        <p class="lede">The students running the CSO's teams and committees this season.</p>
      </section>
      ${teams.length ? [...groups].map(([cat, list]) => `
        <section class="team-group">
          <h2>${esc(cat)}</h2>
          <div class="team-grid">${list.map((t) => `
            <article class="team">
              <h3 class="team-name">${esc(t.name)}</h3>
              ${t.season ? `<span class="team-season">${esc(t.season)}</span>` : ''}
              ${t.description ? `<p class="team-desc">${esc(t.description)}</p>` : '<div style="height:12px"></div>'}
              ${t.members.length ? `<ul class="members">${t.members.map((m) => `<li>${esc(m.name)}${m.role && m.role !== 'Member' ? ` <em>${esc(m.role)}</em>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Members will be announced soon.</p>'}
            </article>`).join('')}</div>
        </section>`).join('') : '<p class="empty">Teams will be announced soon.</p>'}`;
  }

  async function renderCard(uniArg) {
    const uni = uniArg || store.get();
    view.innerHTML = `
      <section class="page-head">
        <span class="kicker">My card</span>
        <h1>Your volunteer card</h1>
        <p class="lede">${meta.card_size} hearts fill a card. ${esc(meta.reward)}</p>
      </section>
      <div class="card-grid">
        <div>
          <div class="lookup-box">
            <form class="lookup" id="card-form" novalidate>
              <label class="field"><span>Your university number</span>
                <input class="uni-input" name="uni" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="e.g. 20231234" value="${esc(uni)}">
              </label>
              <button class="btn" type="submit">Show my card</button>
            </form>
            <p class="msg error" id="card-msg" role="alert" style="margin:12px 0 0"></p>
            <div class="tiers-legend" id="tiers" aria-label="Levels">
              ${meta.tiers.map((t) => `<div data-tier="${esc(t.name)}"><b>${esc(t.name)}</b><span>${t.min === 0 ? 'Starting level' : `${t.min}+ activities`}</span></div>`).join('')}
            </div>
          </div>
        </div>
        <div id="card-out">${emptyCard()}</div>
      </div>
      <div id="card-ledger"></div>`;

    const form = document.getElementById('card-form');
    const input = form.elements.uni;
    digitsOnly(input);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      loadCard(input.value);
    });
    if (uni) loadCard(uni);
    else input.focus();
  }

  function cardShell({ tier, name, uni, cardLabel, slots }) {
    return `<div class="lcard">
      <div class="lcard-top">
        <span class="seal"><img src="/brand/mark" alt=""></span>
        <span class="t">Community Service<small>Volunteer card</small></span>
        <span class="lcard-tier">${esc(tier)}</span>
      </div>
      <div class="hearts">${slots}</div>
      <div class="lcard-bottom">
        <div><span class="lbl">Name</span><span class="val">${esc(name)}</span></div>
        <div><span class="lbl">University no.</span><span class="val mono">${esc(uni)}</span></div>
        <div class="push"><span class="lbl">Card</span><span class="val">${esc(cardLabel)}</span></div>
      </div>
    </div>`;
  }

  function emptyCard() {
    const slots = Array.from({ length: meta.card_size }, (_, i) => `<div class="slot">${i + 1}</div>`).join('');
    return cardShell({ tier: 'Newcomer', name: 'Your name', uni: '—', cardLabel: `0 / ${meta.card_size}`, slots });
  }

  async function loadCard(uni) {
    const msg = document.getElementById('card-msg');
    const out = document.getElementById('card-out');
    const ledger = document.getElementById('card-ledger');
    msg.textContent = '';
    if (!/^\d{8}$/.test(uni)) {
      msg.textContent = 'University numbers have 8 digits.';
      return;
    }
    out.innerHTML = loading('Finding your card');
    ledger.innerHTML = '';
    let data;
    try {
      data = await api(`/api/card/${uni}`);
    } catch (err) {
      out.innerHTML = emptyCard();
      msg.textContent = err.message;
      return;
    }
    store.set(uni);
    history.replaceState(null, '', `#/card/${uni}`);
    baseHash = `#/card/${uni}`;
    currentView = `card/${uni}`;

    const L = data.loyalty;
    document.querySelectorAll('#tiers [data-tier]').forEach((el) => el.classList.toggle('on', el.dataset.tier === L.tier));
    const onCard = data.stamps.slice((L.card_no - 1) * L.card_size, L.card_no * L.card_size);
    const slots = Array.from({ length: L.card_size }, (_, i) => {
      const s = onCard[i];
      if (!s) return `<div class="slot">${i + 1}</div>`;
      const d = parse(s.starts_at);
      return `<div class="slot stamped" style="--d:${(i * 0.06).toFixed(2)}s" title="${esc(s.title)}">
        <img src="/brand/mark" alt="${esc(s.title)}"><small>${d.getDate()} ${MONTHS[d.getMonth()]}</small></div>`;
    }).join('');

    out.innerHTML = `
      ${cardShell({ tier: L.tier, name: data.student.display_name, uni: data.student.uni_no, cardLabel: `${L.card_no > 1 ? `#${L.card_no} · ` : ''}${L.on_card} / ${L.card_size}`, slots })}
      ${L.card_complete ? '<div class="complete-ribbon">Your card is full! Visit the Community Service Office to collect your certificate.</div>' : ''}
      <div class="statline">
        <div><b>${L.stamps}</b><span>Activities attended</span></div>
        <div><b>${data.credits_total}</b><span>CSO credits</span></div>
        <div><b>${L.completed_cards}</b><span>Full cards</span></div>
      </div>
      <div class="progress">
        ${L.next_tier ? `<strong>${plural(L.to_next, 'more activity', 'more activities')}</strong> to reach <strong>${esc(L.next_tier)}</strong>.` : 'You reached the top level: <strong>Champion</strong>. Thank you!'}
        <div class="bar"><i style="width:${Math.round((L.on_card / L.card_size) * 100)}%"></i></div>
      </div>`;

    const when = (s) => { const d = parse(s); return d ? fmtShort(d) : ''; };
    ledger.innerHTML = `
      <div class="ledger">
        <section>
          <h3>Activities attended</h3>
          <ul>${data.stamps.length ? data.stamps.slice().reverse().map((s) => `
            <li><a href="#/event/${s.id}">${esc(s.title)}</a><span class="when">${when(s.starts_at)}</span></li>`).join('')
            : '<li class="none">None yet. Register for an activity and get checked in on the day.</li>'}</ul>
          ${data.upcoming.length ? `<h3 style="margin-top:22px">You're registered for</h3><ul>${data.upcoming.map((u) => `
            <li><a href="#/event/${u.id}">${esc(u.title)}</a><span class="when">${when(u.starts_at)}</span></li>`).join('')}</ul>` : ''}
        </section>
        <section>
          <h3>CSO credits</h3>
          <ul>${data.credits.length ? data.credits.map((c) => `
            <li><span>${esc(c.reason)}<br><span class="when">${when(c.created_at)}</span></span>
              <span class="amt ${c.amount < 0 ? 'neg' : ''}">${c.amount > 0 ? '+' : ''}${c.amount}</span></li>`).join('')
            : '<li class="none">No credits yet.</li>'}</ul>
        </section>
      </div>`;
  }

  // ---------------------------------------------------------------- event drawer
  const paragraphs = (text) => esc(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

  async function openEvent(id) {
    dlgBody.innerHTML = loading();
    if (!dlg.open) dlg.showModal();
    let data;
    try {
      data = await api(`/api/events/${encodeURIComponent(id)}`);
    } catch (err) {
      dlgBody.innerHTML = `<div class="drawer-top"><span></span><button class="icon-btn" type="button" data-close aria-label="Close">${ICON.close}</button></div>${errorBox(err)}`;
      return;
    }
    const e = data.event;
    const s = parse(e.starts_at);
    const en = parse(e.ends_at);
    const sameDay = en && en.toDateString() === s.toDateString();
    const seats = e.capacity > 0 ? `${e.seats_left} of ${e.capacity} places left` : 'Open to everyone';

    dlgBody.innerHTML = `
      <div class="drawer-top">
        <span class="tags"><span class="tag">${esc(e.category)}</span>${e.credits > 0 ? `<span class="tag credit">+${esc(credLabel(e.credits))}</span>` : ''}</span>
        <button class="icon-btn" type="button" data-close aria-label="Close">${ICON.close}</button>
      </div>
      <h2 class="drawer-title" id="dlg-title">${esc(e.title)}</h2>
      <dl class="facts">
        <div><dt aria-label="Date">${ICON.cal}</dt><dd>${fmtDate(s)}</dd></div>
        <div><dt aria-label="Time">${ICON.clock}</dt><dd>${fmtTime(s)}${en ? ` – ${sameDay ? fmtTime(en) : `${fmtDate(en)}, ${fmtTime(en)}`}` : ''}</dd></div>
        <div><dt aria-label="Place">${ICON.pin}</dt><dd>${esc(e.location || 'Place to be announced')}</dd></div>
        ${e.status === 'done'
          ? `<div><dt aria-label="Volunteers">${ICON.seats}</dt><dd>${plural(e.attended_count, 'volunteer')} took part</dd></div>`
          : `<div><dt aria-label="Places">${ICON.seats}</dt><dd>${seats}</dd></div>`}
        ${e.credits > 0 ? `<div><dt aria-label="Credits">${ICON.star}</dt><dd>${esc(credLabel(e.credits))}<small>Added when you're checked in on the day</small></dd></div>` : ''}
      </dl>
      ${e.summary ? `<div class="prose"><p><strong>${esc(e.summary)}</strong></p></div>` : ''}
      ${e.description ? `<div class="prose">${paragraphs(e.description)}</div>` : ''}
      <section class="reg" id="reg">${data.can_register ? regForm() : `<div class="notice">${esc(data.reason)}</div>`}</section>`;

    if (data.can_register) wireRegister(e);
  }

  function regForm() {
    return `
      <h3 class="reg-title">Register</h3>
      <form id="reg-form" novalidate>
        <label class="field"><span>Your university number</span>
          <input class="uni-input" name="uni_no" inputmode="numeric" autocomplete="off" maxlength="8" placeholder="e.g. 20231234">
        </label>
        <p class="hint" id="who" aria-live="polite"></p>
        <div id="new-fields" hidden>
          <label class="field"><span>Full name</span><input name="name" maxlength="80" autocomplete="name"></label>
          <div class="row2">
            <label class="field"><span>Email <i>(optional)</i></span><input name="email" type="email" maxlength="120" autocomplete="email" placeholder="you@std.psut.edu.jo"></label>
            <label class="field"><span>Major <i>(optional)</i></span>
              <select name="major"><option value="">Choose…</option>${meta.majors.map((m) => `<option>${esc(m)}</option>`).join('')}</select>
            </label>
          </div>
        </div>
        <p class="msg error" id="reg-msg" role="alert"></p>
        <button class="btn block" type="submit">Confirm registration</button>
      </form>`;
  }

  function wireRegister(e) {
    const form = document.getElementById('reg-form');
    const uni = form.elements.uni_no;
    const who = document.getElementById('who');
    const fields = document.getElementById('new-fields');
    const msg = document.getElementById('reg-msg');
    let known = null;
    let seq = 0;

    async function lookup() {
      msg.textContent = '';
      known = null;
      if (uni.value.length < 8) {
        who.textContent = '';
        who.className = 'hint';
        fields.hidden = true;
        return;
      }
      const mine = ++seq;
      try {
        const r = await api(`/api/students/${uni.value}`);
        if (mine !== seq) return;
        known = r.known;
        if (r.known) {
          who.textContent = `Welcome back, ${r.first_name}! Just press Confirm.`;
          who.className = 'hint ok';
          fields.hidden = true;
        } else {
          who.textContent = "First time with us? Add your name and we'll create your card.";
          who.className = 'hint';
          fields.hidden = false;
        }
      } catch { /* the submit will report problems */ }
    }

    digitsOnly(uni);
    uni.addEventListener('input', lookup);
    const saved = store.get();
    if (saved) {
      uni.value = saved;
      lookup();
    }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      msg.textContent = '';
      if (!/^\d{8}$/.test(uni.value)) {
        msg.textContent = 'Please enter your 8-digit university number.';
        uni.focus();
        return;
      }
      const body = { uni_no: uni.value };
      if (known === false) {
        body.name = form.elements.name.value.trim();
        body.email = form.elements.email.value.trim();
        body.major = form.elements.major.value;
        if (body.name.length < 2) {
          msg.textContent = 'Please add your full name.';
          form.elements.name.focus();
          return;
        }
      }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Registering…';
      try {
        const r = await api(`/api/events/${e.id}/register`, { method: 'POST', body });
        store.set(body.uni_no);
        dirty = true;
        const s = parse(e.starts_at);
        document.getElementById('reg').innerHTML = `
          <div class="success">
            <div class="success-icon">${ICON.check}</div>
            <h3>You're registered, ${esc(r.first_name)}!</h3>
            <p>${esc(e.title)}<br>${fmtDate(s)} at ${fmtTime(s)}${e.location ? ` · ${esc(e.location)}` : ''}</p>
            <div class="code-box"><small>Your registration code</small><b>${esc(r.code)}</b></div>
            <p>Bring your university ID on the day. Once you're checked in, a heart is added to your card${e.credits > 0 ? ` along with ${esc(credLabel(e.credits))}` : ''}.</p>
            <a class="btn ghost" href="#/card/${esc(body.uni_no)}">View my card</a>
          </div>`;
      } catch (err) {
        msg.textContent = err.message;
        if (/full name/i.test(err.message)) {
          known = false;
          fields.hidden = false;
        }
        btn.disabled = false;
        btn.textContent = 'Confirm registration';
      }
    });

    setTimeout(() => (saved && known !== false ? form.querySelector('button[type=submit]') : uni).focus(), 60);
  }

  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg || ev.target.closest('[data-close]')) dlg.close();
  });
  dlg.addEventListener('close', () => {
    if (location.hash.startsWith('#/event/')) history.replaceState(null, '', baseHash);
    if (dirty) {
      dirty = false;
      currentView = null;
      router();
    }
  });

  // ---------------------------------------------------------------- router
  async function router() {
    if (!meta) {
      try { meta = await api('/api/meta'); } catch (err) { view.innerHTML = errorBox(err); return; }
    }
    const [name = '', arg] = location.hash.replace(/^#\/?/, '').split('/');
    if (name === 'event') {
      if (!currentView) await show('', undefined);
      openEvent(arg);
      return;
    }
    if (dlg.open) dlg.close();
    baseHash = location.hash || '#/';
    await show(name, arg);
  }

  async function show(name, arg) {
    const views = { '': renderHome, card: renderCard, teams: renderTeams, archive: renderArchive };
    const fn = views[name] || renderHome;
    const key = `${name}/${arg || ''}`;
    if (key === currentView) return;
    currentView = key;
    document.querySelectorAll('[data-nav]').forEach((a) => {
      const active = a.dataset.nav === (views[name] ? name || 'home' : 'home');
      if (active) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    try {
      await fn(arg);
    } catch (err) {
      view.innerHTML = errorBox(err);
    }
  }

  window.addEventListener('hashchange', router);
  router();
})();
