'use strict';
(() => {
  const main = document.getElementById('admin');
  const tabs = document.getElementById('tabs');
  const modal = document.getElementById('modal');
  const modalBody = document.getElementById('modal-body');
  const CLOSE_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const STATUS_HELP = {
    hidden: 'Draft. Only admins can see it.',
    announced: 'Shown under "Coming up later". Students can\'t register yet.',
    open: 'Students can register with their university number.',
    closed: 'Still listed, but registration is closed.',
    done: 'Finished. Moves to the archive.',
  };

  let meta = null;

  // ---------------------------------------------------------------- utils
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const parse = (dt) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(dt || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
  };
  const fmt = (dt) => {
    const d = parse(dt);
    return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';
  };
  const debounce = (fn, ms = 250) => {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  };

  async function api(path, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const res = await fetch(path, init);
    let data = null;
    try { data = await res.json(); } catch { /* not json */ }
    if (res.status === 401 && !path.endsWith('/login')) {
      renderLogin();
      throw new Error('Please sign in again.');
    }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  const formData = (form) => Object.fromEntries(new FormData(form).entries());
  const flash = (el, text, kind = 'ok') => { el.textContent = text; el.className = `flash ${kind}`; };
  const statusPill = (s) => `<span class="pill ${esc(s)}">${esc(s)}</span>`;

  function openModal(html) {
    modalBody.innerHTML = html;
    if (!modal.open) modal.showModal();
  }
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal || ev.target.closest('[data-close]')) modal.close();
  });
  const modalHead = (title) => `<div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" type="button" data-close aria-label="Close">${CLOSE_SVG}</button></div>`;

  // ---------------------------------------------------------------- auth
  function renderLogin() {
    tabs.hidden = true;
    main.innerHTML = `
      <form class="login" id="login" novalidate>
        <img src="/brand/mark" alt="">
        <h1>Admin sign-in</h1>
        <p>For Community Service Office staff: manage activities, check volunteers in, give CSO credits and keep the teams list.</p>
        <label class="field"><span>Password</span><input type="password" name="password" autocomplete="current-password" required autofocus></label>
        <p class="msg error" id="login-msg" role="alert"></p>
        <button class="btn block" type="submit">Sign in <span class="arrow">→</span></button>
      </form>`;
    const form = document.getElementById('login');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const msg = document.getElementById('login-msg');
      msg.textContent = '';
      try {
        await api('/api/admin/login', { method: 'POST', body: { password: form.elements.password.value } });
        start();
      } catch (err) {
        msg.textContent = err.message;
      }
    });
  }

  document.getElementById('logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    renderLogin();
  });

  async function start() {
    const me = await api('/api/admin/me');
    if (!me.admin) return renderLogin();
    if (!meta) meta = await api('/api/meta');
    tabs.hidden = false;
    route();
  }

  // ---------------------------------------------------------------- router
  const TABS = { events: tabEvents, attendance: tabAttendance, credits: tabCredits, teams: tabTeams, students: tabStudents };
  async function route() {
    if (tabs.hidden) return;
    const [name, arg] = location.hash.replace(/^#/, '').split('/');
    const tab = TABS[name] ? name : 'events';
    tabs.querySelectorAll('[data-tab]').forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    main.innerHTML = '<div class="loading">Loading</div>';
    try {
      await TABS[tab](arg);
    } catch (err) {
      main.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  }
  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------------- events
  async function tabEvents() {
    const [{ stats }, { events, now }] = await Promise.all([api('/api/admin/stats'), api('/api/admin/events')]);
    const stat = (label, n) => `<div><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
    main.innerHTML = `
      <div class="stats">
        ${stat('Students', stats.students)}${stat('Upcoming events', stats.upcoming)}${stat('Registrations', stats.registrations)}
        ${stat('Check-ins', stats.attended)}${stat('Credits given', stats.credits)}${stat('Teams', stats.teams)}
      </div>
      <div class="toolbar">
        <h2>Events</h2>
        <button class="btn" type="button" id="new-ev">New event</button>
      </div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>When</th><th>Event</th><th>Status</th><th>Registered</th><th>Attended</th><th>Credits</th><th></th></tr></thead>
        <tbody>${events.length ? events.map((e) => `
          <tr>
            <td class="num">${esc(fmt(e.starts_at))}${e.ends_at < now && e.status !== 'done' && e.status !== 'hidden' ? '<div class="sub">ended, mark as done?</div>' : ''}</td>
            <td><strong>${esc(e.title)}</strong><div class="sub">${esc(e.category)}${e.location ? ` · ${esc(e.location)}` : ''}</div></td>
            <td>${statusPill(e.status)}</td>
            <td class="num">${e.registered}${e.capacity ? ` / ${e.capacity}` : ''}</td>
            <td class="num">${e.attended_count}</td>
            <td class="num">${e.credits}</td>
            <td class="actions"><a class="btn-sm" href="#attendance/${e.id}">Check-in</a><button class="btn-sm" type="button" data-edit="${e.id}">Edit</button></td>
          </tr>`).join('') : '<tr><td colspan="7" class="muted">No events yet. Create the first one.</td></tr>'}
        </tbody>
      </table></div>`;
    document.getElementById('new-ev').addEventListener('click', () => eventForm(null));
    main.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      eventForm(events.find((e) => e.id === Number(b.dataset.edit)));
    }));
  }

  function eventForm(e) {
    const v = e || { title: '', summary: '', description: '', category: 'Workshop', location: '', starts_at: '', ends_at: '', capacity: 0, credits: 0, status: 'open' };
    openModal(`
      ${modalHead(e ? 'Edit event' : 'New event')}
      <form id="ev-form" novalidate>
        <label class="field"><span>Title</span><input name="title" maxlength="120" required value="${esc(v.title)}"></label>
        <label class="field"><span>One-line summary <i>(shown in the list)</i></span><input name="summary" maxlength="240" value="${esc(v.summary)}"></label>
        <label class="field"><span>Description</span><textarea name="description" maxlength="4000">${esc(v.description)}</textarea></label>
        <div class="row2">
          <label class="field"><span>Category</span><select name="category">${meta.categories.map((c) => `<option ${c === v.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
          <label class="field"><span>Location</span><input name="location" maxlength="120" value="${esc(v.location)}" placeholder="e.g. Main campus hall"></label>
        </div>
        <div class="row2">
          <label class="field"><span>Starts</span><input type="datetime-local" name="starts_at" required value="${esc(v.starts_at)}"></label>
          <label class="field"><span>Ends <i>(default +2h)</i></span><input type="datetime-local" name="ends_at" value="${esc(v.ends_at)}"></label>
        </div>
        <div class="row2">
          <label class="field"><span>Capacity <i>(0 = unlimited)</i></span><input type="number" name="capacity" min="0" max="5000" step="1" value="${esc(v.capacity)}"></label>
          <label class="field"><span>CSO credits on attendance</span><input type="number" name="credits" min="0" max="20" step="0.5" value="${esc(v.credits)}"></label>
        </div>
        <label class="field"><span>Status</span><select name="status">${meta.statuses.map((s) => `<option value="${s}" ${s === v.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <p class="status-help" id="status-help">${esc(STATUS_HELP[v.status])}</p>
        <p class="msg error" id="ev-msg" role="alert"></p>
        <div class="modal-foot">
          ${e ? '<button class="btn-sm danger left" type="button" id="ev-del">Delete event</button>' : ''}
          <button class="btn ghost" type="button" data-close>Cancel</button>
          <button class="btn" type="submit">${e ? 'Save changes' : 'Create event'}</button>
        </div>
      </form>`);
    const form = document.getElementById('ev-form');
    const msg = document.getElementById('ev-msg');
    form.elements.status.addEventListener('change', () => {
      document.getElementById('status-help').textContent = STATUS_HELP[form.elements.status.value] || '';
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      msg.textContent = '';
      const body = formData(form);
      body.capacity = body.capacity === '' ? 0 : Number(body.capacity);
      body.credits = body.credits === '' ? 0 : Number(body.credits);
      try {
        await api(e ? `/api/admin/events/${e.id}` : '/api/admin/events', { method: e ? 'PUT' : 'POST', body });
        modal.close();
        route();
      } catch (err) {
        msg.textContent = err.message;
      }
    });
    if (e) {
      document.getElementById('ev-del').addEventListener('click', async () => {
        if (!confirm(`Delete "${e.title}"? Registrations for it will be removed too.`)) return;
        try {
          await api(`/api/admin/events/${e.id}`, { method: 'DELETE' });
          modal.close();
          route();
        } catch (err) {
          msg.textContent = err.message;
        }
      });
    }
  }

  // ---------------------------------------------------------------- attendance
  async function tabAttendance(arg) {
    const { events, now } = await api('/api/admin/events');
    const usable = events.filter((e) => e.status !== 'hidden');
    if (!usable.length) {
      main.innerHTML = '<div class="toolbar"><h2>Check-in</h2></div><p class="empty">Create an event first.</p>';
      return;
    }
    // Default: the event happening now / next, else the most recent one.
    const chrono = usable.slice().sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    const fallback = chrono.find((e) => e.ends_at >= now) || chrono[chrono.length - 1];
    const selected = usable.find((e) => e.id === Number(arg)) || fallback;

    const { event, registrations } = await api(`/api/admin/events/${selected.id}/registrations`);
    const attended = registrations.filter((r) => r.attended).length;

    main.innerHTML = `
      <div class="toolbar">
        <h2>Check-in</h2>
        <select class="input" id="ev-pick" aria-label="Event">
          ${usable.map((e) => `<option value="${e.id}" ${e.id === event.id ? 'selected' : ''}>${esc(fmt(e.starts_at).split(',')[0])} · ${esc(e.title)}</option>`).join('')}
        </select>
        <a class="btn-sm" href="/api/admin/events/${event.id}/registrations.csv">Export CSV</a>
      </div>

      <form class="panel" id="checkin" novalidate>
        <h3>${esc(event.title)}</h3>
        <div class="checkin">
          <label class="field"><span>University number</span><input class="input uni-input" name="uni_no" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="20231234" autofocus></label>
          <label class="field"><span>Name <i>(only for new students)</i></span><input class="input" name="name" maxlength="80"></label>
          <button class="btn" type="submit">Check in</button>
        </div>
        <div class="flash" id="ci-flash" role="status"></div>
        <p class="muted" style="margin:6px 0 0;font-size:14px">${attended} of ${registrations.length} checked in.
          ${event.credits > 0 ? `Each check-in also gives ${event.credits} CSO credit${event.credits === 1 ? '' : 's'}.` : 'This event gives no credits.'}
          Walk-ins are added automatically.</p>
      </form>

      <div class="toolbar"><h2 style="font-size:30px">Registered</h2><input class="input" id="reg-filter" placeholder="Filter by name or number"></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Here</th><th>Student</th><th>Uni no.</th><th>Major</th><th>Code</th><th>Registered</th><th>Source</th></tr></thead>
        <tbody id="reg-body">${registrations.length ? registrations.map((r) => `
          <tr class="${r.attended ? 'att' : ''}" data-search="${esc(`${r.name} ${r.uni_no}`.toLowerCase())}">
            <td><input type="checkbox" data-uni="${esc(r.uni_no)}" ${r.attended ? 'checked' : ''} aria-label="Attended: ${esc(r.name)}"></td>
            <td><strong>${esc(r.name)}</strong>${r.email ? `<div class="sub">${esc(r.email)}</div>` : ''}</td>
            <td class="num">${esc(r.uni_no)}</td>
            <td>${esc(r.major || '')}</td>
            <td class="num">${esc(r.code)}</td>
            <td class="num">${esc(fmt(r.created_at))}</td>
            <td>${esc(r.source)}</td>
          </tr>`).join('') : '<tr><td colspan="7" class="muted">No registrations yet.</td></tr>'}
        </tbody>
      </table></div>`;

    document.getElementById('ev-pick').addEventListener('change', (ev) => { location.hash = `attendance/${ev.target.value}`; });

    const form = document.getElementById('checkin');
    const fl = document.getElementById('ci-flash');
    form.elements.uni_no.addEventListener('input', () => { form.elements.uni_no.value = form.elements.uni_no.value.replace(/\D/g, '').slice(0, 8); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = formData(form);
      if (!/^\d{8}$/.test(body.uni_no)) return flash(fl, 'University number must be 8 digits.', 'error');
      try {
        const r = await api(`/api/admin/events/${event.id}/attendance`, { method: 'POST', body: { ...body, attended: true } });
        const note = r.already ? 'was already checked in' : r.walk_in ? 'checked in as a walk-in' : 'checked in';
        sessionStorage.setItem('cso-flash', `✓ ${r.student.name} ${note}. Stamp #${r.stamps}.`);
        tabAttendance(event.id);
      } catch (err) {
        flash(fl, err.message, 'error');
        if (/name/i.test(err.message)) form.elements.name.focus();
      }
    });
    const pending = sessionStorage.getItem('cso-flash');
    if (pending) {
      flash(fl, pending, 'ok');
      sessionStorage.removeItem('cso-flash');
    }

    main.querySelectorAll('input[data-uni]').forEach((cb) => cb.addEventListener('change', async () => {
      cb.disabled = true;
      try {
        await api(`/api/admin/events/${event.id}/attendance`, { method: 'POST', body: { uni_no: cb.dataset.uni, attended: cb.checked } });
        cb.closest('tr').classList.toggle('att', cb.checked);
      } catch (err) {
        cb.checked = !cb.checked;
        flash(fl, err.message, 'error');
      }
      cb.disabled = false;
    }));

    document.getElementById('reg-filter').addEventListener('input', (ev) => {
      const q = ev.target.value.trim().toLowerCase();
      document.querySelectorAll('#reg-body tr[data-search]').forEach((tr) => { tr.hidden = q && !tr.dataset.search.includes(q); });
    });
  }

  // ---------------------------------------------------------------- credits
  async function tabCredits() {
    main.innerHTML = `
      <div class="toolbar"><h2>CSO credits</h2></div>
      <div class="cols">
        <div>
          <form class="panel" id="cr-form" novalidate>
            <h3>Give credits</h3>
            <label class="field"><span>University number</span><input class="input uni-input" name="uni_no" inputmode="numeric" maxlength="8" autocomplete="off" placeholder="20231234"></label>
            <p class="hint" id="cr-who"></p>
            <div class="row2">
              <label class="field"><span>Amount <i>(negative to remove)</i></span><input class="input" name="amount" type="number" step="0.5" min="-50" max="50" value="1"></label>
              <label class="field"><span>Name <i>(new students)</i></span><input class="input" name="name" maxlength="80"></label>
            </div>
            <label class="field"><span>Reason</span><input class="input" name="reason" maxlength="160" placeholder="e.g. Volunteered at Welcome Day"></label>
            <div class="flash" id="cr-flash" role="status"></div>
            <button class="btn block" type="submit">Add to ledger</button>
          </form>
          <h3 style="font:400 28px/1 var(--serif);margin:36px 0 12px">Top earners</h3>
          <div class="tbl-wrap"><table class="tbl"><tbody id="leaders"></tbody></table></div>
        </div>
        <div>
          <div class="toolbar" style="margin-top:0"><h2 style="font-size:30px">Ledger</h2><input class="input" id="cr-q" placeholder="Search name, number, reason"></div>
          <div class="tbl-wrap"><table class="tbl">
            <thead><tr><th>Date</th><th>Student</th><th>Reason</th><th>Amount</th><th></th></tr></thead>
            <tbody id="ledger"></tbody>
          </table></div>
        </div>
      </div>`;

    const load = async (q = '') => {
      const { ledger, leaders } = await api(`/api/admin/credits?q=${encodeURIComponent(q)}`);
      document.getElementById('leaders').innerHTML = leaders.length ? leaders.map((l, i) => `
        <tr><td class="num muted">${pad(i + 1)}</td><td><strong>${esc(l.name)}</strong><div class="sub">${esc(l.uni_no)}</div></td><td class="num" style="text-align:right">${l.total}</td></tr>`).join('')
        : '<tr><td class="muted">No credits yet.</td></tr>';
      document.getElementById('ledger').innerHTML = ledger.length ? ledger.map((c) => `
        <tr>
          <td class="num">${esc(fmt(c.created_at))}</td>
          <td><strong>${esc(c.name)}</strong><div class="sub">${esc(c.uni_no)}</div></td>
          <td>${esc(c.reason)}${c.auto ? '<div class="sub">from attendance</div>' : ''}</td>
          <td class="num">${c.amount > 0 ? '+' : ''}${c.amount}</td>
          <td class="actions">${c.auto ? '' : `<button class="btn-sm danger" type="button" data-del="${c.id}">Remove</button>`}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">Nothing here.</td></tr>';
      document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Remove this credit entry?')) return;
        try {
          await api(`/api/admin/credits/${b.dataset.del}`, { method: 'DELETE' });
          load(document.getElementById('cr-q').value);
        } catch (err) { alert(err.message); }
      }));
    };
    await load();

    document.getElementById('cr-q').addEventListener('input', debounce((ev) => load(ev.target.value)));

    const form = document.getElementById('cr-form');
    const fl = document.getElementById('cr-flash');
    const who = document.getElementById('cr-who');
    form.elements.uni_no.addEventListener('input', debounce(async () => {
      const el = form.elements.uni_no;
      el.value = el.value.replace(/\D/g, '').slice(0, 8);
      who.textContent = '';
      if (el.value.length !== 8) return;
      try {
        const r = await api(`/api/students/${el.value}`);
        who.textContent = r.known ? `${r.first_name} is in the database.` : 'New student. Add their name.';
        who.className = r.known ? 'hint ok' : 'hint';
      } catch { /* ignore */ }
    }, 150));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const body = formData(form);
      body.amount = Number(body.amount);
      try {
        const r = await api('/api/admin/credits', { method: 'POST', body });
        flash(fl, `✓ ${body.amount > 0 ? '+' : ''}${body.amount} to ${r.student.name}. New total: ${r.total}.`);
        form.elements.uni_no.value = '';
        form.elements.name.value = '';
        who.textContent = '';
        form.elements.uni_no.focus();
        load(document.getElementById('cr-q').value);
      } catch (err) {
        flash(fl, err.message, 'error');
      }
    });
  }

  // ---------------------------------------------------------------- teams
  async function tabTeams() {
    const { teams } = await api('/api/admin/teams');
    main.innerHTML = `
      <div class="toolbar"><h2>Selected teams</h2><button class="btn" type="button" id="new-team">New team</button></div>
      ${teams.length ? teams.map((t) => `
        <section class="team-card" data-team="${t.id}">
          <header>
            <h3>${esc(t.name)}</h3>
            <span class="meta">${esc(t.category)}${t.season ? ` · ${esc(t.season)}` : ''} · ${t.members.length} member${t.members.length === 1 ? '' : 's'}</span>
            <span class="spacer"></span>
            <button class="btn-sm" type="button" data-edit-team="${t.id}">Edit</button>
          </header>
          ${t.description ? `<p class="muted" style="margin:8px 0 0">${esc(t.description)}</p>` : ''}
          <div class="member-row">${t.members.map((m) => `
            <span class="member-chip">${esc(m.name)} <span class="mono">${esc(m.uni_no)}</span>${m.role !== 'Member' ? `<em>${esc(m.role)}</em>` : ''}
              <button type="button" data-rm="${esc(m.uni_no)}" aria-label="Remove ${esc(m.name)}">×</button></span>`).join('') || '<span class="muted">No members yet.</span>'}
          </div>
          <form class="inline-form" data-add novalidate>
            <input class="input" name="uni_no" inputmode="numeric" maxlength="8" placeholder="Uni no." aria-label="University number">
            <input class="input" name="role" maxlength="40" placeholder="Role (Member)" aria-label="Role">
            <input class="input" name="name" maxlength="80" placeholder="Name, if new" aria-label="Name if new student">
            <button class="btn" type="submit">Add</button>
          </form>
          <div class="flash" role="status"></div>
        </section>`).join('') : '<p class="empty">No teams yet. Add your committees and competition teams.</p>'}`;

    document.getElementById('new-team').addEventListener('click', () => teamForm(null));
    main.querySelectorAll('[data-edit-team]').forEach((b) => b.addEventListener('click', () => {
      teamForm(teams.find((t) => t.id === Number(b.dataset.editTeam)));
    }));
    main.querySelectorAll('[data-team]').forEach((sec) => {
      const id = sec.dataset.team;
      const fl = sec.querySelector('.flash');
      sec.querySelector('[data-add]').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const body = formData(ev.target);
        try {
          await api(`/api/admin/teams/${id}/members`, { method: 'POST', body });
          tabTeams();
        } catch (err) { flash(fl, err.message, 'error'); }
      });
      sec.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
        try {
          await api(`/api/admin/teams/${id}/members/${b.dataset.rm}`, { method: 'DELETE' });
          tabTeams();
        } catch (err) { flash(fl, err.message, 'error'); }
      }));
    });
  }

  function teamForm(t) {
    const v = t || { name: '', category: 'Committee', season: '', description: '' };
    openModal(`
      ${modalHead(t ? 'Edit team' : 'New team')}
      <form id="team-form" novalidate>
        <label class="field"><span>Team name</span><input name="name" maxlength="80" value="${esc(v.name)}"></label>
        <div class="row2">
          <label class="field"><span>Category</span><input name="category" maxlength="40" list="team-cats" value="${esc(v.category)}"></label>
          <label class="field"><span>Season</span><input name="season" maxlength="40" value="${esc(v.season)}" placeholder="e.g. 2026/27"></label>
        </div>
        <datalist id="team-cats"><option>Committee</option><option>Volunteer team</option><option>Field team</option><option>Media</option></datalist>
        <label class="field"><span>Description</span><textarea name="description" maxlength="600">${esc(v.description)}</textarea></label>
        <p class="msg error" id="team-msg" role="alert"></p>
        <div class="modal-foot">
          ${t ? '<button class="btn-sm danger left" type="button" id="team-del">Delete team</button>' : ''}
          <button class="btn ghost" type="button" data-close>Cancel</button>
          <button class="btn" type="submit">${t ? 'Save' : 'Create team'}</button>
        </div>
      </form>`);
    const form = document.getElementById('team-form');
    const msg = document.getElementById('team-msg');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api(t ? `/api/admin/teams/${t.id}` : '/api/admin/teams', { method: t ? 'PUT' : 'POST', body: formData(form) });
        modal.close();
        tabTeams();
      } catch (err) { msg.textContent = err.message; }
    });
    if (t) {
      document.getElementById('team-del').addEventListener('click', async () => {
        if (!confirm(`Delete team "${t.name}"? Students stay in the database.`)) return;
        try {
          await api(`/api/admin/teams/${t.id}`, { method: 'DELETE' });
          modal.close();
          tabTeams();
        } catch (err) { msg.textContent = err.message; }
      });
    }
  }

  // ---------------------------------------------------------------- students
  async function tabStudents() {
    main.innerHTML = `
      <div class="toolbar"><h2>Students</h2><input class="input" id="st-q" placeholder="Search name, number, email" autofocus></div>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>Student</th><th>Uni no.</th><th>Major</th><th>Stamps</th><th>Tier</th><th>Credits</th><th>Teams</th></tr></thead>
        <tbody id="st-body"></tbody>
      </table></div>`;
    let rows = [];
    const load = async (q = '') => {
      ({ students: rows } = await api(`/api/admin/students?q=${encodeURIComponent(q)}`));
      document.getElementById('st-body').innerHTML = rows.length ? rows.map((s) => `
        <tr class="clickable" data-uni="${esc(s.uni_no)}" tabindex="0">
          <td><strong>${esc(s.name)}</strong>${s.email ? `<div class="sub">${esc(s.email)}</div>` : ''}</td>
          <td class="num">${esc(s.uni_no)}</td>
          <td>${esc(s.major || '')}</td>
          <td class="num">${s.stamps} <span class="muted">/ ${s.registrations}</span></td>
          <td>${esc(s.tier)}</td>
          <td class="num">${s.credits}</td>
          <td>${esc(s.teams || '')}</td>
        </tr>`).join('') : '<tr><td colspan="7" class="muted">No students found.</td></tr>';
      document.querySelectorAll('#st-body tr[data-uni]').forEach((tr) => {
        const open = () => studentModal(tr.dataset.uni, () => load(document.getElementById('st-q').value));
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
      });
    };
    await load();
    document.getElementById('st-q').addEventListener('input', debounce((ev) => load(ev.target.value)));
  }

  async function studentModal(uni, onSaved) {
    openModal('<div class="loading">Loading</div>');
    let data;
    try {
      data = await api(`/api/admin/students/${uni}`);
    } catch (err) {
      modalBody.innerHTML = `${modalHead('Student')}<div class="error-box">${esc(err.message)}</div>`;
      return;
    }
    const s = data.student;
    const c = data.card;
    modalBody.innerHTML = `
      ${modalHead(s.name)}
      <p class="mono muted" style="margin:-10px 0 18px">${esc(s.uni_no)} · ${esc(c.loyalty.tier)} · ${c.loyalty.stamps} stamps · ${c.credits_total} credits</p>
      <form id="st-form" novalidate>
        <label class="field"><span>Full name</span><input name="name" maxlength="80" value="${esc(s.name)}"></label>
        <div class="row2">
          <label class="field"><span>Email</span><input name="email" type="email" maxlength="120" value="${esc(s.email || '')}"></label>
          <label class="field"><span>Major</span><select name="major"><option value="">—</option>${meta.majors.map((m) => `<option ${m === s.major ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
        </div>
        <p class="msg error" id="st-msg" role="alert"></p>
        <div class="modal-foot">
          <a class="btn-sm left" href="/#/card/${esc(s.uni_no)}" target="_blank" rel="noopener">Public card ↗</a>
          <button class="btn ghost" type="button" data-close>Close</button>
          <button class="btn" type="submit">Save</button>
        </div>
      </form>
      <h3 style="font:400 24px/1 var(--serif);margin:26px 0 8px">Attended</h3>
      <div class="tbl-wrap"><table class="tbl"><tbody>${c.stamps.length ? c.stamps.slice().reverse().map((x) => `<tr><td>${esc(x.title)}</td><td class="num">${esc(fmt(x.starts_at))}</td></tr>`).join('') : '<tr><td class="muted">No events attended yet.</td></tr>'}</tbody></table></div>`;
    const form = document.getElementById('st-form');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api(`/api/admin/students/${uni}`, { method: 'PUT', body: formData(form) });
        modal.close();
        onSaved();
      } catch (err) { document.getElementById('st-msg').textContent = err.message; }
    });
  }

  start().catch((err) => { main.innerHTML = `<div class="error-box">${esc(err.message)}</div>`; });
})();
