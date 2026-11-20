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
  // Photos jointes par les femmes (20 novembre 2026) : lues une fois par session, affichées en vignette, agrandies au toucher.
  const photoCache = new Map();
  function photoView(id) {
    const box = node('button', undefined, 'rav-photo'); box.type = 'button'; box.setAttribute('aria-label', 'Agrandir la photo');
    const img = node('img'); img.alt = 'Photo envoyée'; box.append(img);
    const show = (url) => { if (url) img.src = url; else box.replaceWith(node('span', 'Photo effacée (30 jours après l’envoi)', 'rav-small')); };
    if (photoCache.has(id)) show(photoCache.get(id));
    else api('GET', '/v1/rabbanim/photos/' + id).then((p) => { const url = 'data:' + p.mime + ';base64,' + p.data; photoCache.set(id, url); show(url); }, () => show(null));
    box.onclick = () => {
      if (!img.src) return;
      const layer = node('div', undefined, 'rav-photo-layer'), big = node('img'); big.src = img.src; big.alt = 'Photo envoyée, en grand';
      layer.append(big, node('p', 'Toucher pour fermer'));
      layer.onclick = () => layer.remove();
      document.body.append(layer);
    };
    return box;
  }

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
        row.append(node('strong', (m.role === 'client' ? 'Elle' : m.author) + (m.kind === 'precision' ? ' · demande de précision' : '') + ' · ' + stamp(m.at)));
        if (!(m.photos && m.photos.length && m.text === 'Photo jointe')) row.append(node('span', m.text));
        if (m.photos && m.photos.length) { const pics = node('div', undefined, 'rav-photos'); for (const id of m.photos) pics.append(photoView(id)); row.append(pics); }
        target.append(row);
      }
      if (!t.assignedToMe) target.append(button('Prendre en charge cette question', run(async () => { await api('POST', '/v1/rabbanim/threads/' + t.id + '/take'); await renderAll(); }), 'btn'));
      else if (t.status === 'answered') target.append(node('p', '✓ Réponse publiée · question fermée. La femme pose une nouvelle question si elle a besoin d’une suite.', 'rav-small'));
      else current = t;
    }
    if (!current) return;
    // La réponse va à la question la plus récente que je suis et qui n'est pas encore fermée.
    const label = node('label', 'Ma réponse · ' + current.topic + ' du ' + stamp(current.createdAt)), input = node('textarea');
    input.id = 'reply'; input.rows = 6; input.maxLength = 3000; input.value = draft;
    input.oninput = () => { if (!draftOp) draftOp = newOp(); };
    label.append(input);
    const send = (kind) => run(async () => {
      const text = input.value.trim(); if (!text) return;
      // Publier la réponse ferme la question (demande du Rav) ; une demande de précision la laisse ouverte.
      if (kind === 'answer' && !confirm('Publier la réponse ? La question sera fermée : la femme posera une nouvelle question si elle a besoin d’une suite.')) return;
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
    target.append(label, actions, node('p', '« Publier la réponse » ferme la question. « Demander une précision » la laisse ouverte pour que la femme réponde.', 'rav-small'));
  }

  // ---------- Notifications sur ce téléphone ----------
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const keyBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

  async function currentSubscription() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }

  async function renderPush() {
    const box = $('push'); if (!box) return;
    box.replaceChildren();
    if (!pushSupported()) {
      box.append(node('p', isIOS() && !installed()
        ? 'Pour recevoir une notification à chaque nouvelle question : ajoute d’abord cette page à l’écran d’accueil (Partager → « Sur l’écran d’accueil »), puis ouvre l’espace depuis l’icône « STAM Rav ».'
        : 'Ce navigateur ne permet pas les notifications. Sur iPhone, utilise Safari et l’icône sur l’écran d’accueil ; sur Android, Chrome.', 'rav-small'));
      return;
    }
    const sub = await currentSubscription();
    if (sub && Notification.permission === 'granted') {
      // Réenregistrée à chaque ouverture : l'adresse peut changer.
      api('POST', '/v1/rabbanim/push/subscribe', sub.toJSON()).catch(() => {});
      box.append(node('p', '🔔 Notifications activées sur ce téléphone.', 'rav-small'), button('Couper les notifications', run(async () => {
        await api('POST', '/v1/rabbanim/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
        await sub.unsubscribe(); await renderPush();
      })));
      return;
    }
    if (Notification.permission === 'denied') {
      box.append(node('p', 'Les notifications sont bloquées pour cette page. Autorise-les dans les réglages du téléphone (Réglages → Notifications → STAM Rav), puis rouvre l’espace.', 'rav-small'));
      return;
    }
    box.append(node('p', 'Reçois une notification sur ce téléphone à chaque nouvelle question ou nouveau message.', 'rav-small'), button('Activer les notifications', run(async () => {
      const reg = await navigator.serviceWorker.register('sw.js');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { await renderPush(); return; }
      const { publicKey } = await api('GET', '/v1/rabbanim/push/key');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      await api('POST', '/v1/rabbanim/push/subscribe', sub.toJSON());
      await renderPush();
      error('Notifications activées.');
    }), 'btn'));
  }

  // Notification touchée : ouvrir la conversation de cette femme.
  const openFromHash = () => { const m = /^#femme-(\d+)$/.exec(location.hash); if (m) { selected = Number(m[1]); history.replaceState(null, '', location.pathname); } };
  if (pushSupported()) navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.open) { selected = e.data.open; draftOp = null; renderAll().catch(() => {}); } });

  async function renderAll() { await renderMe(); await renderQueue(); await renderThread(); }

  async function open() {
    try { await renderMe(); } catch { return; }
    $('login').hidden = true; $('space').hidden = false; $('logout').hidden = false; $('changePassword').hidden = false;
    openFromHash();
    await renderAll().catch((e) => error(e.message));
    renderPush().catch(() => {});
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
  // Se déconnecter coupe aussi les notifications de ce téléphone.
  $('logout').onclick = async () => {
    try { const sub = await currentSubscription(); if (sub) { await api('POST', '/v1/rabbanim/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); } } catch { /* déjà coupé */ }
    logout();
  };
  // Actualisation régulière tant que la page est visible ; le brouillon de réponse est conservé.
  setInterval(() => { if (token && !document.hidden && !$('space').hidden) renderQueue().catch(() => {}); }, 30000);
  document.addEventListener('visibilitychange', () => { if (token && !document.hidden && !$('space').hidden) renderQueue().catch(() => {}); });
  if (token) open();
})();
