const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function api(url, method = 'GET', body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Something went wrong.');
  return d;
}
const say = (el, text, ok) => { el.textContent = text; el.className = 'msg' + (ok ? ' ok' : ''); };

let me = null;

function renderLayout() {
  const page = document.body.dataset.page;
  const link = (href, label, key) => `<a href="${href}" class="${page === key ? 'active' : ''}">${label}</a>`;
  $('#nav').innerHTML = `<div class="bar"><a class="logo" href="index.html">🔄 Skill Exchange Hub</a><nav>
    ${link('index.html', 'Home', 'home')}${link('about.html', 'About', 'about')}
    ${link('services.html', 'Services', 'services')}${link('careers.html', 'Careers', 'careers')}
    ${link('contact.html', 'Contact', 'contact')}
    ${me ? link('explore.html', 'Explore', 'explore') + link('lessons.html', 'Lessons', 'lessons') + link('messages.html', 'Messages', 'messages') + link('dashboard.html', 'Dashboard', 'dashboard') + link('credits.html', '💰 ' + me.credits, 'credits') + '<button id="logoutBtn">Logout</button>'
         : link('login.html', 'Login', 'login') + '<a class="btn small" href="join.html">Join</a>'}
  </nav></div>`;
  $('#footer').innerHTML = `© ${new Date().getFullYear()} Skill Exchange Hub — Learn by teaching.`;
  const lo = $('#logoutBtn');
  if (lo) lo.onclick = async () => { await api('/api/logout', 'POST'); location.href = 'index.html'; };
}

const accBtns = (r) => r.status !== 'accepted' ? '' : `<p><a class="btn small ghost" href="messages.html?req=${r.id}">💬 Message</a>
  ${r.paid ? '<span class="badge">✅ Learning confirmed</span>' : `<select id="h${r.id}" style="width:auto;display:inline"><option>1</option><option>2</option><option>3</option></select> hr <button class="btn small" data-confirm="${r.id}">Confirm Learning</button>`}</p>`;
function wireConfirm() {
  document.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
    try {
      const d = await api(`/api/requests/${b.dataset.confirm}/confirm`, 'POST', { hours: $('#h' + b.dataset.confirm).value });
      alert('Done! Credits sent to your teacher. Your balance: ' + d.credits); location.reload();
    } catch (err) { alert(err.message); }
  });
}
function embedUrl(u) {
  try {
    const x = new URL(u);
    if (x.hostname.includes('youtu.be')) return 'https://www.youtube.com/embed/' + x.pathname.slice(1);
    if (x.hostname.includes('youtube.com') && x.searchParams.get('v')) return 'https://www.youtube.com/embed/' + x.searchParams.get('v');
  } catch {}
  return '';
}
const when = (t) => new Date(t.replace(' ', 'T') + 'Z').toLocaleString();

const pages = {
  async lessons() {
    if (!me) return (location.href = 'login.html');
    async function load() {
      const list = await api('/api/lessons?q=' + encodeURIComponent($('#q').value));
      $('#list').innerHTML = list.map(l => `<a class="card link" href="lesson.html?id=${l.id}">
        <h3>${esc(l.title)}</h3><span class="tag offer">${esc(l.skill)}</span> ${l.done ? '<span class="badge">✅ Completed</span>' : ''}
        <p>By ${esc(l.author)}</p><span class="go">Open lesson →</span></a>`).join('') || '<p>No lessons yet. Add the first one!</p>';
    }
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/lessons', 'POST', { skill: $('#skill').value, title: $('#title').value, content: $('#content').value, video_url: $('#video').value });
        e.target.reset(); say($('#msg'), 'Lesson published!', true); load();
      } catch (err) { say($('#msg'), err.message); }
    };
    $('#q').oninput = load; load();
  },
  async lesson() {
    if (!me) return (location.href = 'login.html');
    const id = new URLSearchParams(location.search).get('id');
    try {
      const l = await api('/api/lessons/' + encodeURIComponent(id));
      const emb = embedUrl(l.video_url);
      $('#box').innerHTML = `<h1>${esc(l.title)}</h1><p><span class="tag offer">${esc(l.skill)}</span> by <b>${esc(l.author)}</b></p>
        ${emb ? `<iframe src="${esc(emb)}" style="width:100%;aspect-ratio:16/9;border:0;border-radius:12px" allowfullscreen></iframe>`
              : l.video_url ? `<p><a class="btn small" target="_blank" rel="noopener" href="${esc(l.video_url)}">▶ Open video</a></p>` : ''}
        <div class="card" style="white-space:pre-wrap">${esc(l.content)}</div>
        <p><button class="btn" id="done" ${l.done ? 'disabled' : ''}>${l.done ? '✅ Completed' : 'Mark as complete'}</button> <a class="btn ghost" href="lessons.html">← All lessons</a></p>`;
      $('#done').onclick = async () => { await api(`/api/lessons/${id}/complete`, 'POST'); $('#done').textContent = '✅ Completed'; $('#done').disabled = true; };
    } catch (err) { $('#box').innerHTML = `<p class="msg">${esc(err.message)}</p>`; }
  },
  async messages() {
    if (!me) return (location.href = 'login.html');
    let cur = +new URLSearchParams(location.search).get('req') || 0, timer;
    async function showChat() {
      if (!cur) return;
      try {
        const msgs = await api('/api/messages/' + cur);
        $('#chat').innerHTML = msgs.map(m => `<div class="bubble ${m.sender_id === me.id ? 'me' : ''}"><b>${esc(m.name)}</b><br>${esc(m.body)}<small>${when(m.created_at)}</small></div>`).join('') || '<p>Say hello 👋</p>';
        $('#chat').scrollTop = $('#chat').scrollHeight;
      } catch (err) { $('#chat').textContent = err.message; }
    }
    async function load() {
      const c = await api('/api/conversations');
      $('#convos').innerHTML = c.map(x => `<div class="card convo ${x.id === cur ? 'on' : ''}" data-id="${x.id}"><b>${esc(x.other)}</b><br><small>${esc(x.give_skill)} ⇄ ${esc(x.get_skill)}</small><br><small>${esc(x.last || 'No messages yet')}</small></div>`).join('')
        || '<p>No conversations yet. Chats open once an exchange is accepted.</p>';
      document.querySelectorAll('.convo').forEach(el => el.onclick = () => { cur = +el.dataset.id; history.replaceState(0, '', '?req=' + cur); load(); });
      $('#form').classList.toggle('hidden', !cur);
      await showChat();
    }
    $('#form').onsubmit = async (e) => {
      e.preventDefault();
      const b = $('#body').value.trim(); if (!b) return;
      try { await api('/api/messages/' + cur, 'POST', { body: b }); $('#body').value = ''; showChat(); } catch (err) { alert(err.message); }
    };
    await load();
    timer = setInterval(showChat, 5000);
  },
  async credits() {
    if (!me) return (location.href = 'login.html');
    const d = await api('/api/credits');
    $('#bal').textContent = d.credits;
    $('#rows').innerHTML = d.history.map(t => {
      const out = t.from_id === me.id;
      return `<tr><td>${when(t.created_at)}</td><td>${esc(t.note)}</td><td>${out ? 'Paid to ' + esc(t.to_name) : 'Earned from ' + esc(t.from_name)}</td>
        <td style="color:${out ? 'var(--bad)' : 'var(--ok)'};font-weight:700">${out ? '−' : '+'}${t.amount}</td></tr>`;
    }).join('') || '<tr><td colspan="4">No transactions yet.</td></tr>';
  },

  join() {
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/signup', 'POST', { name: $('#name').value, email: $('#email').value, password: $('#password').value, bio: $('#bio').value });
        location.href = 'dashboard.html';
      } catch (err) { say($('#msg'), err.message); }
    };
  },
  login() {
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/login', 'POST', { email: $('#email').value, password: $('#password').value });
        location.href = 'dashboard.html';
      } catch (err) { say($('#msg'), err.message); }
    };
  },
  contact() {
    $('#f').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/api/contact', 'POST', { name: $('#name').value, email: $('#email').value, message: $('#message').value });
        say($('#msg'), 'Thank you! We received your message.', true);
        e.target.reset();
      } catch (err) { say($('#msg'), err.message); }
    };
  },
  async dashboard() {
    if (!me) return (location.href = 'login.html');
    $('#hello').textContent = `Welcome, ${me.name}!`;

    async function loadSkills() {
      const list = await api('/api/skills');
      const tags = (kind) => list.filter(s => s.kind === kind)
        .map(s => `<span class="tag ${kind}">${esc(s.name)} <button data-id="${s.id}" title="Remove">✕</button></span>`).join('') || '<span style="color:var(--muted)">None yet</span>';
      $('#offers').innerHTML = tags('offer');
      $('#wants').innerHTML = tags('want');
      document.querySelectorAll('.tag button').forEach(b => b.onclick = async () => { await api('/api/skills/' + b.dataset.id, 'DELETE'); loadSkills(); });
    }
    document.querySelectorAll('.addSkill').forEach(f => f.onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/api/skills', 'POST', { name: f.name.value, kind: f.dataset.kind }); f.reset(); say($('#smsg'), ''); loadSkills(); }
      catch (err) { say($('#smsg'), err.message); }
    });

    async function loadRequests() {
      const { incoming, outgoing } = await api('/api/requests');
      $('#incoming').innerHTML = incoming.map(r => `<div class="card"><b>${esc(r.from_name)}</b> will teach you <b>${esc(r.give_skill)}</b> and wants to learn <b>${esc(r.get_skill)}</b> from you.
        ${r.message ? `<p>“${esc(r.message)}”</p>` : ''}
        <div>Status: <span class="status-${r.status}">${r.status}</span></div>
        ${r.status === 'pending' ? `<button class="btn small" data-a="accepted" data-id="${r.id}">Accept</button> <button class="btn small red" data-a="declined" data-id="${r.id}">Decline</button>` : ''}
        ${r.status === 'accepted' ? `<div>Contact: <a href="mailto:${esc(r.from_email)}">${esc(r.from_email)}</a></div>` : ''}${accBtns(r)}</div>`).join('') || '<p style="color:var(--muted)">No incoming requests.</p>';
      $('#outgoing').innerHTML = outgoing.map(r => `<div class="card">To <b>${esc(r.to_name)}</b>: you teach <b>${esc(r.give_skill)}</b>, you learn <b>${esc(r.get_skill)}</b>.
        <div>Status: <span class="status-${r.status}">${r.status}</span></div>
        ${r.status === 'accepted' ? `<div>Contact: <a href="mailto:${esc(r.to_email)}">${esc(r.to_email)}</a></div>` : ''}${accBtns(r)}</div>`).join('') || '<p style="color:var(--muted)">No outgoing requests.</p>';
      wireConfirm();
      document.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => { await api(`/api/requests/${b.dataset.id}/respond`, 'POST', { status: b.dataset.a }); loadRequests(); });
    }
    loadSkills(); loadRequests();
  },
  async explore() {
    if (!me) return (location.href = 'login.html');
    const mySkills = await api('/api/skills');
    const myOffers = mySkills.filter(s => s.kind === 'offer').map(s => s.name);
    let users = [];

    async function load() {
      users = await api('/api/explore?q=' + encodeURIComponent($('#q').value));
      $('#results').innerHTML = users.map((u, i) => `<div class="card">
        <h3>${esc(u.name)} ${u.score ? '<span class="badge">⭐ Good match</span>' : ''}</h3>
        <p style="color:var(--muted)">${esc(u.bio)}</p>
        <div><b>Can teach:</b> ${u.offers.map(n => `<span class="tag offer">${esc(n)}</span>`).join('') || '—'}</div>
        <div><b>Wants to learn:</b> ${u.wants.map(n => `<span class="tag want">${esc(n)}</span>`).join('') || '—'}</div>
        <p><button class="btn small" data-i="${i}">Propose exchange</button></p></div>`).join('') || '<p>No members found yet. Invite friends to join!</p>';
      document.querySelectorAll('[data-i]').forEach(b => b.onclick = () => openDialog(users[b.dataset.i]));
    }
    function openDialog(u) {
      if (!myOffers.length) { alert('First add a skill you can teach on your Dashboard.'); return; }
      if (!u.offers.length) { alert('This member has not listed a skill to teach yet.'); return; }
      $('#dName').textContent = u.name;
      $('#give').innerHTML = myOffers.map(n => `<option>${esc(n)}</option>`).join('');
      $('#get').innerHTML = u.offers.map(n => `<option>${esc(n)}</option>`).join('');
      $('#dmsg').value = ''; say($('#dErr'), '');
      $('#send').onclick = async () => {
        try { await api('/api/requests', 'POST', { to_id: u.id, give_skill: $('#give').value, get_skill: $('#get').value, message: $('#dmsg').value }); $('#dlg').close(); alert('Request sent!'); }
        catch (err) { say($('#dErr'), err.message); }
      };
      $('#dlg').showModal();
    }
    $('#q').oninput = load;
    load();
  }
};

(async () => {
  try { me = await api('/api/me'); } catch {}
  renderLayout();
  const p = document.body.dataset.page;
  if (pages[p]) pages[p]();
})();
