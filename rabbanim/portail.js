// Espace Rabbanim : file, prise en charge, réponses. Tout texte reçu est affiché avec textContent (jamais interprété).
(() => {
  const $ = (id) => document.getElementById(id);
  const node = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (text, action, cls = 'btn secondary') => { const b = node('button', text, cls); b.type = 'button'; b.onclick = action; return b; };
  const traditions = { unknown: 'À orienter', habad: '‘Habad', sefarade: 'Séfarade', ashkenaze: 'Ashkénaze', tous: 'Tous les minhag' };
  const statuses = { waiting: 'En attente', inprogress: 'Pris en charge', answered: 'Réponse envoyée' };
  const stamp = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d); };
  const newOp = () => 'op-' + crypto.randomUUID();
  // Adresses du serveur : fichier config.js (site STAM) ; sinon même origine (serveur de test).
  const cfg = window.STAM_PORTAL || { apiBase: '', authBase: '', key: '' };
  let token = '', refresh = '';
  // Reste connecté sur ce téléphone (icône sur l'écran d'accueil) jusqu'à « Se déconnecter ».
  try { token = localStorage.getItem('stam-rav-token') || ''; refresh = localStorage.getItem('stam-rav-refresh') || ''; } catch {}
  let selected = null, draftOp = null;

  // Connexion du Rav : e-mail et mot de passe du compte créé par l'équipe STAM (service de connexion Supabase).
  async function auth(grant, payload) {
    const res = await fetch(cfg.authBase + '/token?grant_type=' + grant, { method: 'POST', headers: { apikey: cfg.key, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(grant === 'password' ? 'E-mail ou mot de passe incorrect.' : 'Connexion expirée.');
    token = data.access_token; refresh = data.refresh_token || '';
    try { localStorage.setItem('stam-rav-token', token); localStorage.setItem('stam-rav-refresh', refresh); } catch {}
  }
  async function api(method, path, body, retried) {
    const res = await fetch(cfg.apiBase + path, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && refresh && !retried && cfg.authBase) {
      try { await auth('refresh_token', { refresh_token: refresh }); return api(method, path, body, true); } catch { /* reconnexion nécessaire */ }
    }
    if (res.status === 401 || (res.status === 403 && data.error === 'not-rav')) { logout(res.status === 403 ? 'Ce compte n’est pas un compte Rav de STAM.' : 'Connexion expirée : reconnecte-toi.'); throw new Error(''); }
    if (!res.ok) throw new Error(data.message || 'Action impossible. Réessaie.');
    return data;
  }
  const error = (message) => { $('error').textContent = message || ''; };
  const run = (work) => async () => { try { error(''); await work(); } catch (e) { error(e.message); } };

  function logout(message = '') {
    token = ''; refresh = ''; selected = null;
    try { localStorage.removeItem('stam-rav-token'); localStorage.removeItem('stam-rav-refresh'); sessionStorage.clear(); } catch {}
    $('login').hidden = false; $('space').hidden = true; $('logout').hidden = true; $('changePassword').hidden = true; $('loginError').textContent = message;
  }

  async function renderMe() {
    const me = await api('GET', '/v1/rabbanim/me');
    $('who').textContent = me.displayName + ' · ' + traditions[me.tradition];
    $('availability').textContent = me.available ? 'Disponible pour prendre une question' : 'Indisponible';
    $('toggle').onclick = run(async () => { await api('POST', '/v1/rabbanim/availability', { available: !me.available }); await renderAll(); });
  }

  // Une ligne par femme (numéro anonyme), comme une messagerie : nouveaux messages d'abord.
  async function renderQueue() {
    const { women } = await api('GET', '/v1/rabbanim/women');
    const list = $('queue'); list.replaceChildren();
    if (!women.length) list.append(node('p', 'Aucune question pour le moment.', 'rav-team-empty'));
    for (const w of women) {
      const card = button('', run(async () => { selected = w.number; draftOp = null; await renderThread(); }), 'rav-question-card' + (selected === w.number ? ' selected' : ''));
      const title = node('strong', 'Femme n° ' + w.number);
      if (w.unread) title.append(node('span', 'nouveau message', 'rav-unread'));
      else if (w.toTake) title.append(node('span', 'nouvelle question', 'rav-unread'));
      card.append(title, node('small', w.preview || ''), node('small', traditions[w.tradition] + ' · ' + stamp(w.lastAt) + ' · ' + w.questions + (w.questions > 1 ? ' questions' : ' question')));
      list.append(card);
    }
  }

  // Conversation d'une femme : toutes ses questions dans l'ordre, la note personnelle du Rav, la réponse en bas.
  async function renderThread() {
    const target = $('thread'), draft = $('reply')?.value || '';
    if (!selected) { target.replaceChildren(node('p', 'Choisis une femme à gauche.', 'rav-team-empty')); return; }
    let w;
    try { w = await api('GET', '/v1/rabbanim/women/' + selected); }
    catch (e) { selected = null; target.replaceChildren(node('p', e.message, 'rav-team-empty')); return; }
    target.replaceChildren(node('h3', 'Femme n° ' + w.number), node('p', 'Minhag : ' + traditions[w.tradition], 'rav-small'));
    // Note personnelle : visible seulement par moi.
    const noteLabel = node('label', 'Ma note sur cette femme (visible par moi seul)'), note = node('textarea');
    note.rows = 2; note.maxLength = 2000; note.value = w.note || ''; note.placeholder = 'Ex. : allaite, cycles irréguliers…';
    noteLabel.append(note);
    const saveNote = button('Enregistrer la note', run(async () => { await api('POST', '/v1/rabbanim/women/' + w.number + '/note', { note: note.value }); error('Note enregistrée.'); }));
    target.append(noteLabel, saveNote);
    let current = null;
    for (const t of w.threads) {
      const head = node('div', undefined, 'rav-thread-head');
      head.append(node('strong', t.topic + ' · ' + stamp(t.createdAt)), node('span', statuses[t.status], 'rav-status ' + t.status));
      target.append(head);
      if (t.neededBy) target.append(node('p', 'Réponse souhaitée avant le ' + stamp(t.neededBy) + ' (indication, sans engagement de délai).', 'rav-small'));
      for (const m of t.messages) {
        const row = node('div', undefined, 'rav-message ' + m.role);
        row.append(node('strong', (m.role === 'client' ? 'Elle' : m.author) + (m.kind === 'precision' ? ' · demande de précision' : '') + ' · ' + stamp(m.at)), node('span', m.text));
        target.append(row);
      }
      if (!t.assignedToMe) target.append(button('Prendre en charge cette question', run(async () => { await api('POST', '/v1/rabbanim/threads/' + t.id + '/take'); await renderAll(); }), 'btn'));
      else current = t;
    }
    if (!current) return;
    // La réponse va à la question la plus récente que je suis.
    const label = node('label', 'Ma réponse · ' + current.topic + ' du ' + stamp(current.createdAt)), input = node('textarea');
    input.id = 'reply'; input.rows = 6; input.maxLength = 3000; input.value = draft;
    input.oninput = () => { if (!draftOp) draftOp = newOp(); };
    label.append(input);
    const send = (kind) => run(async () => {
      const text = input.value.trim(); if (!text) return;
      // Même identifiant si l'envoi est relancé après une coupure : le message n'est publié qu'une fois.
      draftOp = draftOp || newOp();
      await api('POST', '/v1/rabbanim/threads/' + current.id + '/messages', { op: draftOp, text, kind });
      draftOp = null; input.value = ''; await renderAll();
    });
    const actions = node('div', undefined, 'rav-actions');
    actions.append(button('Publier la réponse', send('answer'), 'btn'), button('Demander une précision', send('precision')), button('Rendre à la file', run(async () => {
      if (!confirm('Rendre cette question à la file ? Un autre Rav pourra la prendre.')) return;
      await api('POST', '/v1/rabbanim/threads/' + current.id + '/release'); await renderAll();
    })));
    target.append(label, actions);
  }

  async function renderAll() { await renderMe(); await renderQueue(); await renderThread(); }

  async function open() {
    try { await renderMe(); } catch { return; }
    $('login').hidden = true; $('space').hidden = false; $('logout').hidden = false; $('changePassword').hidden = false;
    await renderAll().catch((e) => error(e.message));
  }

  $('connect').onclick = async () => {
    const email = $('email').value.trim(), password = $('password').value;
    if (!email || !password) { $('loginError').textContent = 'Indique ton e-mail et ton mot de passe.'; return; }
    $('loginError').textContent = 'Connexion…';
    try { await auth('password', { email, password }); $('password').value = ''; $('loginError').textContent = ''; await open(); }
    catch (e) { $('loginError').textContent = e.message || 'Connexion impossible.'; }
  };
  $('password').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('connect').click(); });
  // Changer son mot de passe (après la première connexion avec le mot de passe donné par l'équipe).
  $('changePassword').onclick = run(async () => {
    const next = prompt('Nouveau mot de passe (10 caractères au moins) :');
    if (!next) return;
    if (next.length < 10) throw new Error('Choisis un mot de passe de 10 caractères au moins.');
    const res = await fetch(cfg.authBase + '/user', { method: 'PUT', headers: { apikey: cfg.key, authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ password: next }) });
    if (!res.ok) throw new Error('Le mot de passe n’a pas pu être changé. Réessaie.');
    error('Mot de passe changé.');
  });
  $('logout').onclick = () => logout();
  // Actualisation régulière tant que la page est visible ; le brouillon de réponse est conservé.
  setInterval(() => { if (token && !document.hidden && !$('space').hidden) renderQueue().catch(() => {}); }, 30000);
  if (token) open();
})();
