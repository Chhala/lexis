/* ═══════════════════════════════════════════════════════════════
   LEXIS — app.js  v1.2
   Logique complète : IndexedDB · Sessions · Récompenses · Stats
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────
   CONSTANTES
───────────────────────────────────────────────────────────── */
const DB_NAME    = 'lexisDB';
const DB_VERSION = 1;
const THEMES_ALL = [
  'agri.','arts','bot.','cuis.','géogr.','hist.','ling.','litt.',
  'marit.','myth.','méd.','métro.','philo.','polit.','relig.',
  'scien.','sports','zool.'
];

const BADGES_SERIE = [
  { id:'serie_3',   label:'🌱 Motivé',      desc:'3 jours consécutifs',   days:3,   joker:true  },
  { id:'serie_30',  label:'🔥 Persévérant', desc:'30 jours consécutifs',  days:30,  joker:true  },
  { id:'serie_180', label:'⚡ Acharné',      desc:'180 jours consécutifs', days:180, joker:true  },
  { id:'serie_365', label:'🏆 Résolu',       desc:'365 jours consécutifs', days:365, joker:true  },
];
const BADGES_MAITRISE = [
  { id:'m_25',  label:'📖 Lettré',      desc:'25% des mots maîtrisés',  pct:25  },
  { id:'m_50',  label:'🔬 Savant',      desc:'50% des mots maîtrisés',  pct:50  },
  { id:'m_75',  label:'💎 Érudit',      desc:'75% des mots maîtrisés',  pct:75  },
  { id:'m_100', label:'👑 Lexicologue', desc:'100% des mots maîtrisés', pct:100 },
];
const BADGES_LEARN = [
  { id:'perfect',     label:'⭐ Session parfaite', desc:'100% correct en apprentissage'         },
  { id:'infaillible', label:'🎯 Infaillible',      desc:'5 sessions parfaites consécutives'     },
];
const BADGES_FLASH = [
  { id:'flash_perfect',   label:'⚡ Session parfaite',  desc:'100% correct en Flash'                    },
  { id:'flash_electrique',label:'🔋 Électrique',          desc:'5 sessions Flash dans la même journée'    },
];
const BADGES_DIVERS = [
  { id:'redemption', label:'⚔️ Rédemption', desc:'Maîtriser un mot raté 5× ou plus' },
];

const DEFAULT_SETTINGS = {
  wordsPerSession: 12, reviewRatioPct: 20, masteredRatioPct: 10,
  learnRatioPct: 75,
  flashWordsPerSession: 10, flashRatioPct: 75,
  validDays: [1,2,3,4,5],
  soundCorrect: true, soundWrong: true, soundRewards: true,
  soundVolume: 0.5,
  currentStreak: 0, longestStreak: 0, jokers: 0,
  badges: [], lastExportDate: null, lastWordExportDate: null,
  perfectStreak: 0, redemptionDone: false,
  flashSessionCount: 0, lastLearningDate: null,
  masteredSnapshots: [],
  wordsBaseVersion: null,
  lastWordsExportVersion: null,
  flashSessionsToday: 0, flashSessionsDate: null,
};

/* ─────────────────────────────────────────────────────────────
   ÉTAT GLOBAL
───────────────────────────────────────────────────────────── */
let db       = null;
let settings = { ...DEFAULT_SETTINGS };
let allWords = [];
let pendingRewards = [];

// État Flash
let flashSession = {
  words:[], idx:0, answers:[], mode:'mot-def', startTime:0,
  revealed:false, history:[],
};

// État Apprentissage
let learnSession = {
  words:[], idx:0, phase:'memo',
  results:[], hintUsed:[], qcmHintUsed:[],
  // Pour chaque mot : 'write' ou 'evoke'
  wordMode:[],
  scrolledAll:false,
  perfectSoFar:true, usedQcmHint:false,
  startTimes:[], waitingSwipe:false,
};

// Navigation
let currentScreen  = 'home';
let wordFormMode   = 'create';
let editingWordId  = null;
let swipedRowId    = null;
let wordsFromReview = false;

// Recherche / filtres
let searchMode    = 'mot';
let activeFilters = new Set(['all']);
let searchQuery   = '';

/* ─────────────────────────────────────────────────────────────
   INDEXEDDB
───────────────────────────────────────────────────────────── */
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('words')) {
        const ws = d.createObjectStore('words', { keyPath:'id' });
        ws.createIndex('status', 'status');
        ws.createIndex('mot', 'mot');
      }
      if (!d.objectStoreNames.contains('sessions')) {
        const ss = d.createObjectStore('sessions', { keyPath:'id' });
        ss.createIndex('date', 'date');
      }
      if (!d.objectStoreNames.contains('settings')) {
        d.createObjectStore('settings', { keyPath:'key' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbPut(storeName, obj) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).put(obj);
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite');
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = e  => reject(e.target.error);
  });
}

function dbPutAll(storeName, items) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const st = tx.objectStore(storeName);
    items.forEach(item => st.put(item));
    tx.oncomplete = () => resolve();
    tx.onerror    = e  => reject(e.target.error);
  });
}

/* ─────────────────────────────────────────────────────────────
   SETTINGS
───────────────────────────────────────────────────────────── */
async function loadSettings() {
  const rows = await dbGetAll('settings');
  rows.forEach(r => { settings[r.key] = r.value; });
}

async function saveSetting(key, value) {
  settings[key] = value;
  await dbPut('settings', { key, value });
}

async function saveSettings() {
  const tx = db.transaction('settings', 'readwrite');
  const st = tx.objectStore('settings');
  Object.entries(settings).forEach(([k,v]) => st.put({ key:k, value:v }));
  return new Promise((res,rej) => { tx.oncomplete=res; tx.onerror=rej; });
}

/* ─────────────────────────────────────────────────────────────
   CHARGEMENT INITIAL DES MOTS
───────────────────────────────────────────────────────────── */
async function loadWords() {
  allWords = await dbGetAll('words');
  if (allWords.length === 0) {
    try {
      const resp = await fetch('words.json');
      const raw  = await resp.json();
      const sentinel = raw.find(item => item.__lexis_version__);
      if (sentinel) {
        const ver = sentinel.__lexis_version__;
        settings.wordsBaseVersion = ver;
        await saveSetting('wordsBaseVersion', ver);
      }
      const data = raw.filter(item => !item.__lexis_version__);
      await dbPutAll('words', data);
      allWords = data;
    } catch(e) {
      console.error('Impossible de charger words.json', e);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
   UTILITAIRES MOTS
───────────────────────────────────────────────────────────── */
function activeWords() { return allWords.filter(w => !w.isArchived); }
function masteredWords(){ return allWords.filter(w => !w.isArchived && w.status === 'maîtrisé'); }
function reviewWords()  { return allWords.filter(w => !w.isArchived && w.status === 'à_revoir'); }

async function updateWord(word) {
  const idx = allWords.findIndex(w => w.id === word.id);
  if (idx >= 0) allWords[idx] = word;
  await dbPut('words', word);
}

function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    return (c==='x' ? r : (r&0x3|0x8)).toString(16);
  });
}

function levenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 0;
  const m = a.length, n = b.length;
  const dp = Array.from({length:m+1}, (_,i) => Array.from({length:n+1}, (_,j) => i===0?j:j===0?i:0));
  for (let i=1;i<=m;i++) for (let j=1;j<=n;j++)
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}

function findApprox(query, limit=8) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  return allWords
    .filter(w => !w.isArchived)
    .map(w => ({ w, d: levenshtein(q, w.mot.toLowerCase()) }))
    .filter(x => x.d <= 2 && x.d > 0)
    .sort((a,b) => a.d - b.d)
    .slice(0, limit)
    .map(x => x.w);
}

function maskWord(text, mot) {
  if (!text || !mot) return text;
  const toMask = [mot, ...allWords
    .filter(w => levenshtein(mot.toLowerCase(), w.mot.toLowerCase()) <= 2 && w.mot !== mot)
    .map(w => w.mot)
  ];
  let result = text;
  toMask.forEach(m => {
    const re = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'), 'gi');
    result = result.replace(re, '###');
  });
  return result;
}

function natureBadgeClass(nat) {
  if (!nat) return 'badge-n';
  if (nat.includes('n.m')) return 'badge-nm';
  if (nat.includes('n.f')) return 'badge-nf';
  if (nat.includes('adj')) return 'badge-adj';
  if (nat.includes('v.'))  return 'badge-v';
  if (nat.includes('loc')) return 'badge-loc';
  return 'badge-n';
}

function natureBadgeHtml(natureArr) {
  if (!natureArr || !natureArr.length) return '';
  return natureArr.map(n => `<span class="badge ${natureBadgeClass([n])}">${n}</span>`).join(' ');
}

function firstSyllable(word) {
  if (!word) return '';
  const w = word.toLowerCase();
  const V = 'aeéèêëiîïoôuùûüy';
  let i = 0;
  while (i < w.length && !V.includes(w[i])) i++;
  while (i < w.length && V.includes(w[i])) i++;
  const peak = i;
  if (peak <= 1) return word.slice(0, Math.min(2, word.length));
  return word.slice(0, peak);
}

/* ─────────────────────────────────────────────────────────────
   AUDIO
───────────────────────────────────────────────────────────── */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx   = null;
let gainMaster = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx   = new AudioCtx();
    gainMaster = audioCtx.createGain();
    gainMaster.connect(audioCtx.destination);
    gainMaster.gain.value = settings.soundVolume !== undefined ? settings.soundVolume : 0.5;
  }
  return audioCtx;
}

function setMasterVolume(v) {
  if (gainMaster) gainMaster.gain.value = v;
}

function playTone(type) {
  if (type === 'correct' && !settings.soundCorrect) return;
  if (type === 'wrong'   && !settings.soundWrong)   return;
  if (type === 'reward'  && !settings.soundRewards)  return;

  try {
    const c   = getAudioCtx();
    const vol = settings.soundVolume !== undefined ? settings.soundVolume : 0.5;
    if (gainMaster) gainMaster.gain.value = vol;
    const dest = gainMaster || c.destination;

    if (type === 'correct') {
      const o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(dest);
      o.type = 'sine'; o.frequency.value = 784;
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(0.16, c.currentTime + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.32);
      o.start(c.currentTime); o.stop(c.currentTime + 0.37);
    } else if (type === 'wrong') {
      [[330, 0], [262, 0.16]].forEach(([freq, t]) => {
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(dest);
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0, c.currentTime + t);
        g.gain.linearRampToValueAtTime(0.14, c.currentTime + t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.25);
        o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.28);
      });
    } else if (type === 'reward') {
      [523, 659, 784, 1047].forEach((freq, i) => {
        const t = i * 0.1;
        const o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(dest);
        o.type = 'sine'; o.frequency.value = freq;
        g.gain.setValueAtTime(0, c.currentTime + t);
        g.gain.linearRampToValueAtTime(0.13, c.currentTime + t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.28);
        o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.33);
        if (i > 1) {
          const o2 = c.createOscillator(), g2 = c.createGain();
          o2.connect(g2); g2.connect(dest);
          o2.type = 'triangle'; o2.frequency.value = freq;
          g2.gain.setValueAtTime(0, c.currentTime + t);
          g2.gain.linearRampToValueAtTime(0.05, c.currentTime + t + 0.015);
          g2.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.28);
          o2.start(c.currentTime + t); o2.stop(c.currentTime + t + 0.33);
        }
      });
    }
  } catch(e) { /* silencieux */ }
}

/* ─────────────────────────────────────────────────────────────
   CONFETTIS
───────────────────────────────────────────────────────────── */
function launchConfetti() {
  const wrap = document.getElementById('confetti-container');
  wrap.innerHTML = '';
  const colors = ['#5341D6','#D4860A','#639922','#A32D2D','#7B6EE8','#E8C97A','#72243E'];
  for (let i = 0; i < 50; i++) {
    const d = document.createElement('div');
    d.className = 'confetti-dot';
    const sz = 5 + Math.random() * 7;
    const duration = 1.2 + Math.random() * 1.5;
    const delay    = Math.random() * 0.8;
    d.style.cssText = `left:${Math.random()*100}%;top:0;
      background:${colors[i%colors.length]};
      animation-duration:${duration}s;animation-delay:${delay}s;
      width:${sz}px;height:${sz}px;
      border-radius:${Math.random()>0.5?'50%':'3px'}`;
    wrap.appendChild(d);
    setTimeout(() => d.remove(), (duration + delay + 0.5) * 1000);
  }
}

/* ─────────────────────────────────────────────────────────────
   TOAST
───────────────────────────────────────────────────────────── */
let toastTimer = null;
function showToast(msg) {
  const el  = document.getElementById('toast');
  const txt = document.getElementById('toast-msg');
  txt.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

/* ─────────────────────────────────────────────────────────────
   MODAL
───────────────────────────────────────────────────────────── */
function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  el.addEventListener('click', function outsideClick(e) {
    if (e.target === el) { closeModal(id); el.removeEventListener('click', outsideClick); }
  });
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}

/* ─────────────────────────────────────────────────────────────
   SWIPE BAS → ACCUEIL
───────────────────────────────────────────────────────────── */
function initGlobalSwipeDown() {
  let sy = 0, sx = 0, st = 0, active = false;

  document.addEventListener('touchstart', e => {
    sy = e.touches[0].clientY;
    sx = e.touches[0].clientX;
    st = Date.now();
    active = true;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!active) return;
    active = false;
    const dy      = e.changedTouches[0].clientY - sy;
    const dx      = Math.abs(e.changedTouches[0].clientX - sx);
    const elapsed = Date.now() - st;
    const velocity= dy / Math.max(elapsed, 1);

    if (dy < 160 || dx > 50 || velocity < 0.6 || elapsed > 350) return;

    const focused = document.activeElement;
    if (focused && (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA')) return;
    const modalOpen = document.querySelector('.modal-overlay.show');
    if (modalOpen) {
      const flameOpen = document.getElementById('flame-popup');
      if (flameOpen && flameOpen.classList.contains('show')) closeModal('flame-popup');
      return;
    }

    const target = e.target;
    const scrollParent = target.closest('.scroll, .scroll-full, .memo-scroll, .form-scroll, .restit-body, .flash-body');
    if (scrollParent && scrollParent.scrollTop > 10) return;

    if (currentScreen !== 'home') navigateTo('home');
  }, { passive: true });
}

/* ─────────────────────────────────────────────────────────────
   NAVIGATION
───────────────────────────────────────────────────────────── */
function navigateTo(screen) {
  const hiddenNav = ['flash','learn'];
  document.getElementById('bottom-nav').style.display = hiddenNav.includes(screen) ? 'none' : '';

  document.querySelectorAll('.screen, #screen-flash, #screen-learn').forEach(s => {
    s.classList.remove('active');
    s.style.display = '';
  });

  if (screen === 'flash') {
    document.getElementById('screen-flash').style.display = 'flex';
    document.getElementById('screen-flash').classList.add('active');
  } else if (screen === 'learn') {
    document.getElementById('screen-learn').style.display = 'flex';
    document.getElementById('screen-learn').classList.add('active');
  } else {
    const el = document.getElementById(`screen-${screen}`);
    if (el) el.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(ni => {
      ni.classList.toggle('active', ni.dataset.screen === screen);
    });
  }

  currentScreen = screen;

  if (screen === 'home')     refreshHome();
  if (screen === 'words') {
    if (!wordsFromReview) {
      activeFilters = new Set(['all']);
      document.querySelectorAll('.filter-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.filter === 'all');
      });
    } else {
      wordsFromReview = false;
    }
    refreshWordList();
  }
  if (screen === 'stats')    refreshStats();
  if (screen === 'settings') refreshSettings();
}

/* ─────────────────────────────────────────────────────────────
   ACCUEIL
───────────────────────────────────────────────────────────── */
function refreshHome() {
  const active   = activeWords();
  const mastered = masteredWords();
  const review   = reviewWords();

  document.getElementById('home-total').textContent    = active.length.toLocaleString('fr');
  document.getElementById('home-mastered').textContent = mastered.length.toLocaleString('fr');
  document.getElementById('home-review').textContent   = review.length.toLocaleString('fr');

  refreshSuccessRate();

  const n = settings.currentStreak || 0;
  const isLexicologue = settings.badges && settings.badges.includes('m_100');
  document.getElementById('streak-n').textContent  = n;
  document.getElementById('streak-ico').textContent = isLexicologue ? '👑' : '🔥';
  const j = settings.jokers || 0;
  document.getElementById('streak-shield').textContent = j > 0 ? `🛡×${j}` : '';

  const done  = settings.lastLearningDate === todayStr();
  const total = settings.wordsPerSession || 12;

  document.getElementById('hero-title').textContent = done
    ? 'Défi du jour accompli ✓'
    : 'Session d\'apprentissage';

  document.getElementById('hero-prog').style.width = done ? '100%' : '0%';
  document.getElementById('hero-foot-left').textContent = done ? `${total} / ${total} mots` : `0 / ${total} mots`;

  const days = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
  const validDays = settings.validDays || [1,2,3,4,5];
  const labels = validDays.map(d => days[d]);
  document.getElementById('hero-foot-right').textContent =
    labels.length === 5 && JSON.stringify(validDays) === JSON.stringify([1,2,3,4,5])
      ? 'Lun – Ven'
      : labels.join(', ');
}

async function refreshSuccessRate() {
  try {
    const sessions = await dbGetAll('sessions');
    const cutoff = Date.now() - 30*24*3600*1000;
    const recent = sessions.filter(s => s.mode === 'learn' && new Date(s.date).getTime() > cutoff);
    if (!recent.length) { document.getElementById('home-rate').textContent = '—'; return; }
    const totalCorrect = recent.reduce((a,s) => a + s.correctCount, 0);
    const totalWords   = recent.reduce((a,s) => a + s.totalWords,   0);
    const rate = totalWords > 0 ? Math.round(totalCorrect/totalWords*100) : 0;
    document.getElementById('home-rate').textContent = `${rate}%`;
  } catch(e) { document.getElementById('home-rate').textContent = '—'; }
}

function todayStr() {
  return new Date().toISOString().slice(0,10);
}

/* ─────────────────────────────────────────────────────────────
   SÉRIE & JOKERS
───────────────────────────────────────────────────────────── */
async function checkAndUpdateStreak(sessionDate) {
  const last   = settings.lastLearningDate;
  let streak   = settings.currentStreak || 0;
  let longest  = settings.longestStreak || 0;

  if (!last) {
    streak = 1;
  } else {
    const diff = daysDiff(last, sessionDate);
    if (diff === 0) return;
    if (diff === 1) {
      streak++;
    } else {
      const jokers = settings.jokers || 0;
      if (jokers >= 2) {
        settings.jokers = jokers - 2;
        streak++;
        showJokerBanner('2 jokers ont été utilisés pour préserver votre série.');
      } else if (jokers === 1) {
        settings.jokers = 0;
        streak = 1;
        showJokerBanner('Vous n\'avez pas suffisamment de jokers pour préserver votre série.');
      } else {
        streak = 1;
      }
    }
  }

  if (streak > longest) longest = streak;
  settings.currentStreak    = streak;
  settings.longestStreak    = longest;
  settings.lastLearningDate = sessionDate;

  const prevStreak = (last ? (settings.currentStreak - 1) : 0);
  const newJoker   = Math.floor(streak/15) - Math.floor(prevStreak/15);
  if (newJoker > 0) settings.jokers = Math.min(5, (settings.jokers||0) + newJoker);

  await checkSerieBadges(streak);
  await saveSettings();
  refreshHome();
}

function showJokerBanner(msg) {
  document.getElementById('joker-banner-msg').textContent = msg;
  document.getElementById('joker-banner').classList.add('show');
}

function daysDiff(d1, d2) {
  return Math.round((new Date(d2) - new Date(d1)) / 86400000);
}

async function checkSerieBadges(streak) {
  const badges = settings.badges || [];
  for (const b of BADGES_SERIE) {
    if (streak >= b.days && !badges.includes(b.id)) {
      badges.push(b.id);
      settings.badges = badges;
      if (b.joker) settings.jokers = Math.min(5, (settings.jokers||0) + 1);
      pendingRewards.push(b);
    }
  }
}

async function checkMaitriseBadges() {
  const active   = activeWords().length;
  const mastered = masteredWords().length;
  if (!active) return;
  const pct    = Math.round(mastered / active * 100);
  const badges = settings.badges || [];
  let newBadge = null;
  for (const b of BADGES_MAITRISE) {
    if (pct >= b.pct && !badges.includes(b.id)) {
      badges.push(b.id);
      settings.badges = badges;
      newBadge = b;
      pendingRewards.push(b);
      if (b.id === 'm_100') pendingRewards.push({ special: 'lexicologue' });
    }
  }
  if (newBadge) await saveSettings();
}

async function grantFlashJoker() {
  settings.flashSessionCount = (settings.flashSessionCount||0) + 1;
  if (settings.flashSessionCount % 60 === 0) {
    settings.jokers = Math.min(5, (settings.jokers||0) + 1);
    await saveSettings();
    showToast('🛡 Joker gagné !');
  } else {
    await saveSetting('flashSessionCount', settings.flashSessionCount);
  }
}

/* ─────────────────────────────────────────────────────────────
   POPUP FLAMME
───────────────────────────────────────────────────────────── */
function openFlamePopup() {
  const streak  = settings.currentStreak || 0;
  const longest = settings.longestStreak || 0;
  const jokers  = settings.jokers || 0;
  const badges  = settings.badges || [];

  document.getElementById('popup-serie').textContent  = `${streak} 🔥`;
  document.getElementById('popup-best').textContent   = longest;
  document.getElementById('popup-jokers').textContent = `🛡 Jokers disponibles : ${jokers} / 5`;

  const nextFromSerie = 15 - (streak % 15);
  const nextFromFlash = 60 - ((settings.flashSessionCount||0) % 60);
  document.getElementById('popup-next-joker').textContent =
    `Prochain joker : +${nextFromSerie === 15 ? 15 : nextFromSerie} jours de série ou ${nextFromFlash} sessions Flash`;

  const active   = activeWords().length;
  const mastered = masteredWords().length;
  const pct      = active ? Math.round(mastered/active*100) : 0;

  // Rendu par catégories
  const cats = [
    { label:'Série',        badges: BADGES_SERIE   },
    { label:'Maîtrise',     badges: BADGES_MAITRISE},
    { label:'Apprentissage',badges: BADGES_LEARN   },
    { label:'Flash',        badges: BADGES_FLASH   },
    { label:'Divers',       badges: BADGES_DIVERS  },
  ];

  let html = '';
  cats.forEach(cat => {
    const catBadges = cat.badges.filter(Boolean);
    if (!catBadges.length) return;
    html += `<div style="font-size:10px;font-weight:600;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.07em;margin:10px 0 4px">${cat.label}</div>`;
    catBadges.forEach(b => {
      const unlocked = badges.includes(b.id);
      let progress = '';
      if (b.days) progress = unlocked ? 'débloqué' : `${streak} / ${b.days} jours`;
      if (b.pct)  progress = unlocked ? 'débloqué' : `${pct}% / ${b.pct}%`;
      html += `<div class="badge-item ${unlocked?'':'badge-locked'}">
        <div class="badge-icon-wrap" style="background:${unlocked?'#EAF3DE':'#F0F0F0'}">${b.label.split(' ')[0]}</div>
        <div>
          <div class="badge-name">${b.label.split(' ').slice(1).join(' ')}</div>
          <div class="badge-desc">${b.desc}${progress?' — '+progress:''}</div>
        </div>
        <div class="badge-check" style="color:${unlocked?'var(--color-success)':'var(--text-disabled)'}">${unlocked?'✓':'🔒'}</div>
      </div>`;
    });
  });

  document.getElementById('popup-badges').innerHTML = html;
  openModal('flame-popup');
}

/* ─────────────────────────────────────────────────────────────
   LISTE DE MOTS
───────────────────────────────────────────────────────────── */
function refreshWordList() {
  const q        = searchQuery.toLowerCase();
  const archived = activeFilters.has('archived');

  let filtered = allWords.filter(w => {
    if (archived) return w.isArchived;
    if (w.isArchived) return false;
    return true;
  });

  if (!activeFilters.has('all') && !activeFilters.has('archived')) {
    filtered = filtered.filter(w => {
      return [...activeFilters].every(f => {
        if (f === 'nm')       return w.nature.includes('n.m');
        if (f === 'nf')       return w.nature.includes('n.f');
        if (f === 'adj')      return w.nature.includes('adj.');
        if (f === 'v')        return w.nature.includes('v.');
        if (f === 'loc')      return w.nature.includes('loc.');
        if (f === 'review')   return w.status === 'à_revoir';
        if (f === 'mastered') return w.status === 'maîtrisé';
        if (f === 'added')    return w.isUserCreated;
        return true;
      });
    });
  }

  if (q) {
    filtered = filtered.filter(w => {
      if (searchMode === 'mot')        return w.mot.toLowerCase().includes(q);
      if (searchMode === 'definition') return (w.definition||'').toLowerCase().includes(q);
      if (searchMode === 'theme')      return (w.themes||[]).some(t => t.includes(q));
      return true;
    });
  }

  filtered.sort((a,b) => a.mot.localeCompare(b.mot, 'fr'));

  const countActive = allWords.filter(w => !w.isArchived).length;
  document.getElementById('words-count').textContent = `${countActive.toLocaleString('fr')} mots`;
  renderWordList(filtered);
}

function renderWordList(words) {
  const list = document.getElementById('word-list');
  if (!words.length) {
    list.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-disabled);font-size:13px">Aucun mot trouvé</div>`;
    return;
  }

  list.innerHTML = words.map(w => {
    const natHtml   = natureBadgeHtml(w.nature);
    const dot       = w.status === 'à_revoir' ? '<div class="word-status-dot status-dot-review"></div>'
                    : w.status === 'maîtrisé' ? '<div class="word-status-dot status-dot-mastered"></div>'
                    : '';
    const archClass = w.isArchived ? ' archived' : '';
    const themeHtml = (w.themes||[]).map(t => `<span class="theme-chip">${t}</span>`).join(' ');
    const noteHtml  = w.noteVariante ? `<div class="detail-note">${w.noteVariante}</div>` : '';
    return `
    <div class="word-row${archClass}" id="wrow-${w.id}" data-id="${w.id}">
      <div class="word-main" data-id="${w.id}">
        <div class="word-left">
          <div class="word-name">${w.mot}</div>
          <div class="word-def-preview">${w.definition||''}</div>
        </div>
        ${natHtml}
        ${dot}
      </div>
      <div class="word-detail">
        <div class="detail-def"><strong>${w.definition||''}</strong></div>
        ${noteHtml}
        <div class="detail-themes">${themeHtml}</div>
      </div>
      <div class="word-actions" id="wact-${w.id}">
        <button class="swipe-edit-btn" data-id="${w.id}">
          <svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="swipe-arch-btn" data-id="${w.id}" data-archived="${w.isArchived}">
          <svg viewBox="0 0 24 24"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.word-main').forEach(el => {
    el.addEventListener('click', () => toggleWordRow(el.dataset.id));
  });
  list.querySelectorAll('.swipe-edit-btn').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); openWordForm(el.dataset.id); });
  });
  list.querySelectorAll('.swipe-arch-btn').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); toggleArchive(el.dataset.id); });
  });

  initSwipe(list);
}

function toggleWordRow(id) {
  if (swipedRowId === id) { closeSwipe(swipedRowId); return; }
  if (swipedRowId) closeSwipe(swipedRowId);
  document.querySelectorAll('.word-row.expanded').forEach(r => {
    if (r.id !== `wrow-${id}`) {
      r.classList.remove('expanded');
      r.querySelector('.word-main').style.transform = '';
    }
  });
  const row = document.getElementById(`wrow-${id}`);
  if (row) row.classList.toggle('expanded');
}

function initSwipe(container) {
  let startX = 0, startY = 0, currentId = null, isDragging = false;

  container.addEventListener('touchstart', e => {
    const main = e.target.closest('.word-main');
    if (!main) return;
    currentId = main.dataset.id;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    isDragging = false;
  }, { passive:true });

  container.addEventListener('touchmove', e => {
    if (!currentId) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (!isDragging && Math.abs(dy) > Math.abs(dx)) { currentId = null; return; }
    isDragging = true;
    if (dx < 0) {
      const main = document.querySelector(`#wrow-${currentId} .word-main`);
      if (main) main.style.transform = `translateX(${Math.max(dx, -96)}px)`;
    }
  }, { passive:true });

  container.addEventListener('touchend', e => {
    if (!currentId || !isDragging) return;
    const dx  = e.changedTouches[0].clientX - startX;
    const main = document.querySelector(`#wrow-${currentId} .word-main`);
    const row  = document.getElementById(`wrow-${currentId}`);
    if (dx < -40) {
      if (row && row.classList.contains('expanded')) row.classList.remove('expanded');
      if (swipedRowId && swipedRowId !== currentId) closeSwipe(swipedRowId);
      swipedRowId = currentId;
      if (main) main.style.transform = 'translateX(-96px)';
      if (row) row.classList.add('swiped');
    } else {
      closeSwipe(currentId);
    }
    currentId = null;
  });

  document.addEventListener('click', e => {
    if (swipedRowId && !e.target.closest(`#wrow-${swipedRowId}`)) closeSwipe(swipedRowId);
  });
}

function closeSwipe(id) {
  const main = document.querySelector(`#wrow-${id} .word-main`);
  if (main) main.style.transform = '';
  const row = document.getElementById(`wrow-${id}`);
  if (row) row.classList.remove('swiped');
  if (swipedRowId === id) swipedRowId = null;
}

async function toggleArchive(id) {
  const w = allWords.find(x => x.id === id);
  if (!w) return;
  w.isArchived = !w.isArchived;
  if (!w.isArchived) { w.status = 'nouveau'; w.consecutiveCorrect = 0; }
  await updateWord(w);
  refreshWordList();
  showToast(w.isArchived ? 'Mot archivé' : 'Mot restauré');
}

/* ─────────────────────────────────────────────────────────────
   FORMULAIRE CRÉATION / ÉDITION
───────────────────────────────────────────────────────────── */
let formThemes = [];
let selectedNatures = new Set();
const THEMES_SYSTEM = ['à_revoir','maîtrisé','ajouté','archivé'];

function openWordForm(id = null) {
  wordFormMode  = id ? 'edit' : 'create';
  editingWordId = id;
  formThemes    = [];
  selectedNatures = new Set();

  document.getElementById('form-title').textContent = id ? 'Modifier le mot' : 'Nouveau mot';
  document.getElementById('form-mot').value   = '';
  document.getElementById('form-def').value   = '';
  document.getElementById('form-note').value  = '';
  document.getElementById('dyn-list').style.display = 'none';
  document.getElementById('dyn-list').innerHTML = '';
  document.querySelectorAll('.nat-btn').forEach(b => b.classList.remove('sel'));

  if (id) {
    const w = allWords.find(x => x.id === id);
    if (w) {
      document.getElementById('form-mot').value  = w.mot;
      document.getElementById('form-def').value  = w.definition || '';
      document.getElementById('form-note').value = w.noteVariante || '';
      formThemes = [...(w.themes || [])].filter(t => !THEMES_SYSTEM.includes(t));
      selectedNatures = new Set(w.nature || []);
      selectedNatures.forEach(n => {
        const btn = document.querySelector(`.nat-btn[data-nat="${n}"]`);
        if (btn) btn.classList.add('sel');
      });
    }
  }

  renderFormThemes();
  updateFormSaveBtn();

  if (swipedRowId) closeSwipe(swipedRowId);
  const wordList = document.querySelector('#screen-words .scroll');
  if (wordList) wordList.style.display = 'none';
  document.getElementById('word-form').classList.add('active');
  setTimeout(() => document.getElementById('form-mot').focus(), 100);
}

function closeWordForm() {
  document.getElementById('word-form').classList.remove('active');
  const wordList = document.querySelector('#screen-words .scroll');
  if (wordList) wordList.style.display = '';
  editingWordId = null;
  searchQuery   = '';
  document.getElementById('search-input').value = '';
  refreshWordList();
}

function renderFormThemes() {
  const row = document.getElementById('theme-row');
  const chips = formThemes.map(t =>
    `<span class="theme-chip-del">${t}<span class="del-x" data-theme="${t}">×</span></span>`
  ).join('');
  row.innerHTML = chips + `<button class="theme-add-btn" id="theme-add-btn">+</button>`;
  row.querySelectorAll('.del-x').forEach(x => {
    x.addEventListener('click', () => {
      formThemes = formThemes.filter(t => t !== x.dataset.theme);
      renderFormThemes();
    });
  });
  document.getElementById('theme-add-btn').addEventListener('click', openThemePicker);
}

function updateFormSaveBtn() {
  const mot = document.getElementById('form-mot').value.trim();
  const def = document.getElementById('form-def').value.trim();
  const existing = allWords.find(w =>
    !w.isArchived && w.mot.toLowerCase() === mot.toLowerCase() && w.id !== editingWordId
  );
  document.getElementById('form-save-btn').disabled = !(mot.length > 0 && def.length > 0 && !existing);
}

function updateDynList(query) {
  if (!query || query.length < 2) {
    document.getElementById('dyn-list').style.display = 'none';
    return;
  }
  const q      = query.toLowerCase();
  const exact  = allWords.filter(w => !w.isArchived && w.mot.toLowerCase().startsWith(q)).slice(0,5);
  const approx = findApprox(query, 4);
  const dynEl  = document.getElementById('dyn-list');

  if (!exact.length && !approx.length) { dynEl.style.display = 'none'; return; }

  let html = '';
  exact.forEach(w => {
    html += `<div class="dyn-item" data-word="${w.mot}"><span class="dyn-word">${w.mot}</span>${natureBadgeHtml(w.nature)}</div>`;
  });
  approx.forEach(w => {
    if (!exact.find(e => e.id === w.id)) {
      html += `<div class="dyn-item dyn-approx" data-word="${w.mot}"><span class="dyn-word">${w.mot}</span><span style="font-size:11px;color:var(--color-warning);font-style:italic">approchant</span></div>`;
    }
  });

  dynEl.innerHTML = html;
  dynEl.style.display = html ? '' : 'none';
  dynEl.querySelectorAll('.dyn-item').forEach(el => {
    el.addEventListener('click', () => {
      document.getElementById('form-mot').value = el.dataset.word;
      dynEl.style.display = 'none';
      updateFormSaveBtn();
    });
  });
}

async function saveWordForm() {
  const mot  = document.getElementById('form-mot').value.trim();
  const def  = document.getElementById('form-def').value.trim();
  const note = document.getElementById('form-note').value.trim();
  if (!mot || !def) return;

  if (wordFormMode === 'create') {
    const newWord = {
      id: generateId(), mot, definition: def, noteVariante: note,
      nature: [...selectedNatures],
      pronunciationHint: '', isPrefix: selectedNatures.has('préf.') || selectedNatures.has('suff.'),
      status: 'nouveau', consecutiveCorrect: 0, errorCount: 0,
      lastSeenDate: null, themes: [...formThemes], isUserCreated: true, isArchived: false,
    };
    allWords.push(newWord);
    await dbPut('words', newWord);
    markWordsModified();
    showToast('Mot ajouté');
  } else {
    const w = allWords.find(x => x.id === editingWordId);
    if (w) {
      const firstEdit = !w.isUserCreated;
      w.mot = mot; w.definition = def; w.noteVariante = note;
      w.nature = [...selectedNatures];
      w.themes = [...formThemes];
      w.isPrefix = selectedNatures.has('préf.') || selectedNatures.has('suff.');
      if (firstEdit) w.isUserCreated = true;
      await updateWord(w);
      markWordsModified();
      showToast('Mot modifié');
    }
  }
  closeWordForm();
}

function markWordsModified() {
  settings._wordsModified = true;
  saveSetting('_wordsModified', true);
  refreshWordsModifiedMsg();
}

function refreshWordsModifiedMsg() {
  const msg = document.getElementById('words-modified-msg');
  if (settings._wordsModified && settings.lastWordExportDate) {
    msg.classList.remove('hidden');
  } else {
    msg.classList.add('hidden');
  }
}

/* ─────────────────────────────────────────────────────────────
   THEME PICKER
───────────────────────────────────────────────────────────── */
let pickerSelected = null;

function openThemePicker() {
  pickerSelected = null;
  renderThemesGrid('');
  document.getElementById('theme-search').value = '';
  openModal('theme-picker');
}

function renderThemesGrid(filter) {
  const grid = document.getElementById('themes-grid');
  const displayThemes = THEMES_ALL.filter(t => !THEMES_SYSTEM.includes(t));
  grid.innerHTML = displayThemes.map(t => {
    const disabled = formThemes.includes(t);
    const sel = t === pickerSelected;
    if (filter && !t.includes(filter.toLowerCase())) return '';
    return `<span class="tpill${sel?' sel':''}${disabled?' disabled':''}" data-theme="${t}">${t}${disabled?' ✓':''}</span>`;
  }).join('');

  grid.querySelectorAll('.tpill:not(.disabled)').forEach(p => {
    p.addEventListener('click', () => {
      pickerSelected = p.dataset.theme;
      renderThemesGrid(document.getElementById('theme-search').value);
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   MODE FLASH — SESSION
───────────────────────────────────────────────────────────── */
function buildFlashPool() {
  const active   = activeWords();
  const mastered = active.filter(w => w.status === 'maîtrisé');
  const others   = active.filter(w => w.status !== 'maîtrisé');

  const total      = settings.flashWordsPerSession || 10;
  const mastRatio  = 0.10; // 10% de mots maîtrisés
  const nMastered  = Math.min(Math.round(total * mastRatio), mastered.length);
  const nOthers    = Math.min(total - nMastered, others.length);

  return shuffleArray([
    ...shuffleArray(mastered).slice(0, nMastered),
    ...shuffleArray(others).slice(0, nOthers),
  ]);
}

function startFlash() {
  const pool = buildFlashPool();
  if (!pool.length) {
    showToast('Aucun mot disponible');
    return;
  }

  const ratio = (settings.flashRatioPct !== undefined ? settings.flashRatioPct : 75) / 100;

  flashSession = {
    words:    pool,
    idx:      0,
    answers:  [],
    cardModes: pool.map(() => Math.random() < ratio ? 'mot-def' : 'def-mot'),
    hintUsed: new Array(pool.length).fill(false),
    startTime: Date.now(),
    revealed:  false,
  };

  navigateTo('flash');
  document.getElementById('flash-results').style.display = 'none';
  document.getElementById('flash-question').style.display = '';
  renderFlashQuestion();
  initFlashSwipe();
}

function renderFlashQuestion() {
  const s   = flashSession;
  const w   = s.words[s.idx];
  const tot = s.words.length;
  const mode = s.cardModes[s.idx]; // 'mot-def' ou 'def-mot'

  document.getElementById('flash-counter').textContent = `${s.idx+1} / ${tot}`;
  document.getElementById('flash-progress').style.width = `${(s.idx/tot)*100}%`;

  // Bouton gauche : maison si question 1, flèche sinon
  const backBtn = document.getElementById('flash-back-btn');
  if (s.idx === 0) {
    backBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke="var(--text-secondary)" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`;
  } else {
    backBtn.innerHTML = `<svg viewBox="0 0 24 24" stroke="var(--text-secondary)" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`;
  }

  // Afficher la question
  if (mode === 'mot-def') {
    document.getElementById('flash-q-label').textContent  = 'Mot';
    document.getElementById('flash-q-word').textContent   = w.mot;
    document.getElementById('flash-q-word').style.display = '';
    document.getElementById('flash-q-badge').innerHTML    = natureBadgeHtml(w.nature);
    document.getElementById('flash-q-badge').style.display= '';
    document.getElementById('flash-q-def').style.display  = 'none';
    document.getElementById('flash-prompt').textContent   = 'Évoque la définition, puis…';
  } else {
    document.getElementById('flash-q-label').textContent  = 'Définition';
    document.getElementById('flash-q-word').style.display = 'none';
    document.getElementById('flash-q-badge').style.display= 'none';
    document.getElementById('flash-q-def').style.display  = '';
    document.getElementById('flash-q-def').innerHTML      = `<strong>${w.definition}</strong>`;
    document.getElementById('flash-prompt').textContent   = 'Évoque le mot, puis…';
  }

  // Réinitialiser l'état
  s.revealed = false;
  document.getElementById('flash-answer-card').style.display = 'none';
  document.getElementById('flash-judge-row').style.display   = 'none';
  document.getElementById('flash-reveal-btn').style.display  = '';

  // Indice syllabe : visible uniquement en mode def-mot (on montre la définition, l'utilisateur cherche le mot)
  const hintBtn = document.getElementById('flash-hint-btn');
  if (mode === 'def-mot') {
    hintBtn.style.display = '';
    hintBtn.textContent   = 'indice';
    hintBtn.className     = 'flash-hint-btn';
    hintBtn.disabled      = false;
  } else {
    // En mode mot→déf, pas d'indice (la syllabe du mot est déjà visible)
    hintBtn.style.display = 'none';
  }
}

function handleFlashHint() {
  const s = flashSession;
  const w = s.words[s.idx];
  if (s.hintUsed[s.idx] || s.revealed) return;

  s.hintUsed[s.idx] = true;
  const syl = firstSyllable(w.mot);

  const hintBtn = document.getElementById('flash-hint-btn');
  hintBtn.textContent = syl + '…';
  hintBtn.className   = 'flash-hint-btn used';
  hintBtn.disabled    = true;
}

function revealFlashAnswer() {
  const s  = flashSession;
  const w  = s.words[s.idx];
  const mode = s.cardModes[s.idx];

  s.revealed = true;

  // Afficher la réponse
  const answerLabel = document.getElementById('flash-answer-label');
  const answerText  = document.getElementById('flash-answer-text');

  if (mode === 'mot-def') {
    answerLabel.textContent = 'Définition';
    answerText.textContent  = w.definition;
  } else {
    answerLabel.textContent = 'Mot';
    answerText.innerHTML    = `${w.mot} ${natureBadgeHtml(w.nature)}`;
  }

  document.getElementById('flash-answer-card').style.display = '';
  document.getElementById('flash-judge-row').style.display   = '';
  document.getElementById('flash-reveal-btn').style.display  = 'none';
}

async function judgeFlash(correct) {
  const s = flashSession;
  const w = s.words[s.idx];

  if (correct) playTone('correct');
  else         playTone('wrong');

  s.answers.push({ wordId: w.id, correct });

  // Mettre à jour le mot si maîtrisé et erreur
  if (!correct && w.status === 'maîtrisé') {
    w.status = 'à_revoir';
    w.consecutiveCorrect = 0;
    w.errorCount = (w.errorCount||0) + 1;
    await updateWord(w);
  }

  // Avancer
  s.idx++;
  if (s.idx >= s.words.length) {
    await endFlash();
  } else {
    renderFlashQuestion();
  }
}

function initFlashSwipe() {
  const screen = document.getElementById('screen-flash');
  let sx = 0;

  screen._flashTouchStart && screen.removeEventListener('touchstart', screen._flashTouchStart);
  screen._flashTouchEnd   && screen.removeEventListener('touchend',   screen._flashTouchEnd);

  screen._flashTouchStart = e => { sx = e.touches[0].clientX; };
  screen._flashTouchEnd   = e => {
    const dx = e.changedTouches[0].clientX - sx;
    // Swipe droit : question précédente en lecture seule
    if (dx > 60 && flashSession.idx > 0 && !flashSession.revealed) {
      showFlashPrevious();
    }
  };

  screen.addEventListener('touchstart', screen._flashTouchStart, { passive: true });
  screen.addEventListener('touchend',   screen._flashTouchEnd,   { passive: true });
}

function showFlashPrevious() {
  const s       = flashSession;
  const prevIdx = s.idx - 1;
  const prevWord = s.words[prevIdx];
  const prevAns  = s.answers[prevIdx];
  const prevMode = s.cardModes[prevIdx];
  if (!prevAns) return;

  // Afficher question précédente
  document.getElementById('flash-counter').textContent = `${prevIdx+1} / ${s.words.length} — déjà répondu`;
  // Flèche gauche en lecture seule
  document.getElementById('flash-back-btn').innerHTML = `<svg viewBox="0 0 24 24" stroke="var(--text-secondary)" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>`;

  if (prevMode === 'mot-def') {
    document.getElementById('flash-q-label').textContent  = 'Mot';
    document.getElementById('flash-q-word').textContent   = prevWord.mot;
    document.getElementById('flash-q-word').style.display = '';
    document.getElementById('flash-q-badge').innerHTML    = natureBadgeHtml(prevWord.nature);
    document.getElementById('flash-q-badge').style.display= '';
    document.getElementById('flash-q-def').style.display  = 'none';
    document.getElementById('flash-answer-label').textContent = 'Définition';
    document.getElementById('flash-answer-text').textContent  = prevWord.definition;
  } else {
    document.getElementById('flash-q-label').textContent  = 'Définition';
    document.getElementById('flash-q-word').style.display = 'none';
    document.getElementById('flash-q-badge').style.display= 'none';
    document.getElementById('flash-q-def').style.display  = '';
    document.getElementById('flash-q-def').innerHTML      = `<strong>${prevWord.definition}</strong>`;
    document.getElementById('flash-answer-label').textContent = 'Mot';
    document.getElementById('flash-answer-text').innerHTML    = `${prevWord.mot} ${natureBadgeHtml(prevWord.nature)}`;
  }

  // Afficher la réponse et le résultat (lecture seule)
  document.getElementById('flash-answer-card').style.display = '';
  document.getElementById('flash-reveal-btn').style.display  = 'none';
  document.getElementById('flash-judge-row').style.display   = 'none';

  // Indicateur correct/incorrect
  document.getElementById('flash-prompt').textContent = prevAns.correct ? '✓ Correct' : '✗ Incorrect';

  // Revenir à la question courante après 2.5s
  setTimeout(() => {
    if (flashSession.idx === s.idx) renderFlashQuestion();
  }, 2500);
}

async function endFlash() {
  const correctCount = flashSession.answers.filter(a => a.correct).length;
  const total        = flashSession.words.length;
  const isPerfect    = correctCount === total && total > 0;

  // Badge Session parfaite Flash
  if (isPerfect && !(settings.badges||[]).includes('flash_perfect')) {
    settings.badges = [...(settings.badges||[]), 'flash_perfect'];
    pendingRewards.push(BADGES_FLASH.find(b => b.id === 'flash_perfect'));
  }

  // Badge Électrique : 5 sessions Flash dans la même journée
  const today = todayStr();
  if (settings.flashSessionsDate !== today) {
    settings.flashSessionsDate  = today;
    settings.flashSessionsToday = 0;
  }
  settings.flashSessionsToday = (settings.flashSessionsToday || 0) + 1;
  if (settings.flashSessionsToday >= 5 && !(settings.badges||[]).includes('flash_electrique')) {
    settings.badges = [...(settings.badges||[]), 'flash_electrique'];
    pendingRewards.push(BADGES_FLASH.find(b => b.id === 'flash_electrique'));
  }

  const session = {
    id: generateId(),
    date: new Date().toISOString(),
    mode: 'flash',
    totalWords: total,
    correctCount,
    durationSeconds: Math.round((Date.now()-flashSession.startTime)/1000),
    isChallengeDay: false,
    streakAtSession: settings.currentStreak,
  };
  await dbPut('sessions', session);
  await grantFlashJoker();

  // Mettre à jour snapshot maîtrise
  const snap  = { date: today, count: masteredWords().length };
  const snaps = settings.masteredSnapshots || [];
  const todaySnap = snaps.find(s => s.date === today);
  if (todaySnap) todaySnap.count = snap.count;
  else snaps.push(snap);
  settings.masteredSnapshots = snaps;

  await checkMaitriseBadges();
  await saveSettings();

  showFlashResults(correctCount, total);
}

function showFlashResults(correct, total) {
  const score  = total ? Math.round(correct/total*100) : 0;
  const errors = total - correct;

  document.getElementById('flash-question').style.display = 'none';
  document.getElementById('flash-results').style.display  = '';

  document.getElementById('flash-res-score').textContent   = `${score}%`;
  document.getElementById('flash-res-correct').textContent = correct;
  document.getElementById('flash-res-errors').textContent  = errors;

  const missed = flashSession.answers.filter(a => !a.correct)
    .map(a => allWords.find(w => w.id === a.wordId)).filter(Boolean);
  const missEl = document.getElementById('flash-miss-list');
  if (missed.length) {
    missEl.innerHTML = missed.map(w =>
      `<div class="miss-item">
        <span class="miss-word">${w.mot} <span style="font-size:11px;color:var(--text-tertiary)">${(w.nature||[]).join(', ')}</span></span>
        <span class="miss-x">✗</span>
      </div>`
    ).join('');
  } else {
    missEl.innerHTML = `<div style="font-size:13px;color:var(--text-disabled);text-align:center;padding:8px">Aucun mot raté 🎉</div>`;
  }

  if (pendingRewards.length) {
    const r = pendingRewards[pendingRewards.length - 1];
    if (r && !r.special) {
      document.getElementById('flash-reward-banner').classList.remove('hidden');
      document.getElementById('flash-reward-icon').textContent  = r.label ? r.label.split(' ')[0] : '🏅';
      document.getElementById('flash-reward-title').textContent = `Badge débloqué : ${r.label ? r.label.split(' ').slice(1).join(' ') : ''}`;
      document.getElementById('flash-reward-sub').textContent   = r.desc || '';
      playTone('reward');
      launchConfetti();
    }
    pendingRewards = [];
  } else {
    document.getElementById('flash-reward-banner').classList.add('hidden');
  }

  // Gestes de retour
  let sx = 0;
  const results = document.getElementById('flash-results');
  results.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive:true });
  results.addEventListener('touchend', e => {
    if (Math.abs(e.changedTouches[0].clientX - sx) > 60) navigateTo('home');
  });
  results.addEventListener('click', e => {
    if (!e.target.closest('button')) navigateTo('home');
  });
}

/* ─────────────────────────────────────────────────────────────
   APPRENTISSAGE
───────────────────────────────────────────────────────────── */
function buildLearnPool() {
  const active   = activeWords();
  const review   = active.filter(w => w.status === 'à_revoir');
  const mastered = active.filter(w => w.status === 'maîtrisé');
  const fresh    = active.filter(w => w.status === 'nouveau');

  const total    = settings.wordsPerSession || 12;
  const revRatio = (settings.reviewRatioPct || 20) / 100;
  const mastRatio= (settings.masteredRatioPct || 10) / 100;

  let nReview   = Math.round(total * revRatio);
  let nMastered = Math.round(total * mastRatio);
  let nFresh    = total - nReview - nMastered;

  const actualReview   = Math.min(nReview,   review.length);
  const actualMastered = Math.min(nMastered, mastered.length);
  let   actualFresh    = Math.min(nFresh,    fresh.length);
  actualFresh = Math.min(actualFresh + (total - actualReview - actualMastered - actualFresh), fresh.length);

  const sortedReview = [...review]
    .sort((a,b) => (b.errorCount||0)-(a.errorCount||0) || (a.lastSeenDate||'')<(b.lastSeenDate||'')?-1:1)
    .slice(0, actualReview);

  return shuffleArray([
    ...sortedReview,
    ...shuffleArray([...mastered]).slice(0, actualMastered),
    ...shuffleArray([...fresh]).slice(0, actualFresh),
  ]);
}

function startLearn() {
  const pool = buildLearnPool();
  if (!pool.length) { showToast('Aucun mot disponible'); return; }

  // learnRatioPct = % saisie (défaut 75%). Évocation = 100 - learnRatioPct
  const writeRatio = (settings.learnRatioPct !== undefined ? settings.learnRatioPct : 75) / 100;
  const evokeRatio = 1 - writeRatio;

  learnSession = {
    words:    pool,
    idx:      0,
    phase:    'memo',
    results:  [],
    hintUsed: new Array(pool.length).fill(null),
    qcmHintUsed: new Array(pool.length).fill(false),
    wordMode: pool.map(() => Math.random() < evokeRatio ? 'evoke' : 'write'),
    scrolledAll: false,
    perfectSoFar: true,
    usedQcmHint:  false,
    startTimes: pool.map(() => 0),
    waitingSwipe: false,
  };

  navigateTo('learn');
  startMemoPhase();
}

/* ── Phase 1 : Mémorisation ── */
function startMemoPhase() {
  learnSession.phase        = 'memo';
  learnSession.scrolledAll  = false;

  document.getElementById('memo-phase').style.display = '';
  document.getElementById('restitution-phase').classList.remove('active');
  document.getElementById('learn-results').classList.remove('active');
  document.getElementById('learn-phase-tag').textContent = 'Mémorisation';
  document.getElementById('learn-counter').textContent   = learnSession.words.length;

  const testerBtn = document.getElementById('tester-btn');
  testerBtn.className = 'tester-btn disabled';
  testerBtn.disabled  = true;

  const scroll = document.getElementById('memo-scroll');
  scroll.innerHTML = learnSession.words.map((w, i) => {
    const isAlt      = i % 2 === 1;
    const isReview   = w.status === 'à_revoir';
    const isMastered = w.status === 'maîtrisé';
    const borderClass = isReview ? ' review' : isMastered ? ' mastered' : '';
    const themeHtml   = (w.themes && w.themes.length)
      ? w.themes.map(t => `<span class="theme-chip">${t}</span>`).join(' ') : '';
    const natHtml = natureBadgeHtml(w.nature);
    return `<div class="memo-card${isAlt?' alt':' plain'}${borderClass}">
      <div class="memo-word">${w.mot}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:4px">${natHtml}${themeHtml}</div>
      <div class="memo-def"><strong>${w.definition}</strong></div>
      ${w.noteVariante ? `<div style="font-size:11px;color:var(--text-tertiary);font-style:italic;margin-top:4px">${w.noteVariante}</div>` : ''}
    </div>`;
  }).join('');

  scroll.addEventListener('scroll', () => {
    const atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
    if (atBottom && !learnSession.scrolledAll) {
      learnSession.scrolledAll = true;
      testerBtn.className = 'tester-btn enabled';
      testerBtn.disabled  = false;
    }
  });

  setTimeout(() => {
    if (scroll.scrollHeight <= scroll.clientHeight + 40) {
      learnSession.scrolledAll = true;
      testerBtn.className = 'tester-btn enabled';
      testerBtn.disabled  = false;
    }
  }, 300);
}

/* ── Phase 2 : Restitution ── */
function startRestitutionPhase() {
  learnSession.phase = 'restitution';
  learnSession.idx   = 0;

  document.getElementById('memo-phase').style.display = 'none';
  document.getElementById('restitution-phase').classList.add('active');
  document.getElementById('learn-results').classList.remove('active');
  document.getElementById('learn-phase-tag').textContent = 'Restitution';

  initLearnSwipe();
  renderLearnQuestion();
}

function renderLearnQuestion() {
  const s    = learnSession;
  const w    = s.words[s.idx];
  const total = s.words.length;
  const mode  = s.wordMode[s.idx]; // 'write' ou 'evoke'

  document.getElementById('learn-counter').textContent = `${s.idx+1} / ${total}`;
  document.getElementById('learn-progress').style.width = `${(s.idx/total)*100}%`;

  s.waitingSwipe = false;

  if (mode === 'evoke') {
    renderLearnEvoke(w, s);
  } else {
    renderLearnWrite(w, s);
  }

  s.startTimes[s.idx] = Date.now();
}

function renderLearnWrite(w, s) {
  // Mode saisie : on montre la définition, l'utilisateur écrit le mot
  const maskedDef = maskWord(w.definition, w.mot);
  document.getElementById('learn-def-text').innerHTML = `<strong>${maskedDef}</strong>`;

  const input = document.getElementById('answer-input');
  input.value     = '';
  input.className = 'answer-input';
  input.disabled  = false;
  input.style.display = '';

  document.getElementById('validate-btn').style.display  = '';
  document.getElementById('validate-btn').disabled       = false;
  document.getElementById('feedback-wrong').classList.remove('show');

  const letterUsed = s.hintUsed[s.idx] !== null;

  const hintLetterBtn = document.getElementById('hint-letter-btn');
  hintLetterBtn.textContent = letterUsed ? (firstSyllable(w.mot) + '…') : 'indice';
  hintLetterBtn.className   = `hint-pill hint-pill-primary${letterUsed?' used':''}`;
  hintLetterBtn.disabled    = letterUsed;
  hintLetterBtn.style.display = '';

  // Masquer la zone évocation
  document.getElementById('evoke-zone').style.display      = 'none';
  document.getElementById('learn-def-block').style.display = '';

  setTimeout(() => { input.focus(); }, 100);
}

function renderLearnEvoke(w, s) {
  // Mode évocation : on montre le mot, l'utilisateur évoque la définition
  document.getElementById('evoke-zone').style.display      = 'flex';
  document.getElementById('learn-def-block').style.display = 'none';
  document.getElementById('answer-input').style.display    = 'none';
  document.getElementById('validate-btn').style.display    = 'none';
  document.getElementById('feedback-wrong').classList.remove('show');
  document.getElementById('hint-letter-btn').style.display = 'none';

  document.getElementById('evoke-word').textContent = w.mot;
  document.getElementById('evoke-badge').innerHTML  = natureBadgeHtml(w.nature);
  document.getElementById('evoke-prompt').textContent = 'Évoque la définition, puis…';

  document.getElementById('evoke-answer-card').style.display = 'none';
  document.getElementById('evoke-judge-row').style.display   = 'none';
  document.getElementById('evoke-reveal-btn').style.display  = '';
}

function revealLearnEvoke() {
  const w = learnSession.words[learnSession.idx];
  document.getElementById('evoke-def-text').textContent = w.definition;
  document.getElementById('evoke-answer-card').style.display = '';
  document.getElementById('evoke-judge-row').style.display   = '';
  document.getElementById('evoke-reveal-btn').style.display  = 'none';
}

function judgeLearnEvoke(correct) {
  const s = learnSession;
  const w = s.words[s.idx];
  const elapsed = Math.round((Date.now() - s.startTimes[s.idx]) / 1000);

  if (correct) playTone('correct');
  else {
    playTone('wrong');
    s.perfectSoFar = false;
  }

  s.results.push({ wordId: w.id, correct, elapsed, mode: 'evoke' });
  advanceLearn();
}

function handleHintLetter() {
  const s = learnSession;
  const w = s.words[s.idx];
  if (s.hintUsed[s.idx] !== null) return;

  s.hintUsed[s.idx] = true;
  const syl = firstSyllable(w.mot);
  const input = document.getElementById('answer-input');
  input.value = syl;
  input.focus();

  const hintLetterBtn = document.getElementById('hint-letter-btn');
  hintLetterBtn.textContent = syl + '…';
  hintLetterBtn.className = 'hint-pill hint-pill-primary used';
  hintLetterBtn.disabled  = true;
}

function handleAnswerValidate() {
  const s   = learnSession;
  const w   = s.words[s.idx];
  const val = document.getElementById('answer-input').value.trim().toLowerCase();
  const mot = w.mot.toLowerCase();

  if (!val) return;

  const correct = val === mot || levenshtein(val, mot) <= 1;
  const elapsed = Math.round((Date.now() - s.startTimes[s.idx]) / 1000);

  if (correct) {
    playTone('correct');
    document.getElementById('answer-input').className = 'answer-input correct';
    document.getElementById('answer-input').value     = w.mot + ' ✓';
    document.getElementById('answer-input').disabled  = true;
    document.getElementById('feedback-wrong').classList.remove('show');
    s.results.push({ wordId: w.id, correct: true, elapsed, hint: s.hintUsed[s.idx] !== null ? 'letter' : null });
    setTimeout(advanceLearn, 900);
  } else {
    playTone('wrong');
    s.perfectSoFar = false;
    document.getElementById('feedback-wrong').classList.add('show');
    document.getElementById('fb-wrong-text').textContent   = val;
    document.getElementById('fb-correct-text').textContent = w.mot;
    document.getElementById('answer-input').className = 'answer-input wrong';
    document.getElementById('answer-input').disabled  = true;
    document.getElementById('validate-btn').disabled  = true;
    s.results.push({ wordId: w.id, correct: false, elapsed, hint: s.hintUsed[s.idx] !== null ? 'letter' : null });
    s.waitingSwipe = true;
  }
}

function initLearnSwipe() {
  const screen = document.getElementById('screen-learn');
  let sx = 0, sy = 0;

  screen._learnSwipeTouchStart && screen.removeEventListener('touchstart', screen._learnSwipeTouchStart);
  screen._learnSwipeTouchEnd   && screen.removeEventListener('touchend',   screen._learnSwipeTouchEnd);

  screen._learnSwipeTouchStart = e => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
  };
  screen._learnSwipeTouchEnd = e => {
    if (!learnSession.waitingSwipe) return;
    const dx = Math.abs(e.changedTouches[0].clientX - sx);
    const dy = Math.abs(e.changedTouches[0].clientY - sy);
    const isTap       = dx < 15 && dy < 15;
    const isSwipeLeft = e.changedTouches[0].clientX - sx < -40;
    if (isTap || isSwipeLeft) {
      learnSession.waitingSwipe = false;
      advanceLearn();
    }
  };

  screen.addEventListener('touchstart', screen._learnSwipeTouchStart, { passive: true });
  screen.addEventListener('touchend',   screen._learnSwipeTouchEnd,   { passive: true });
}

async function advanceLearn() {
  learnSession.idx++;
  if (learnSession.idx >= learnSession.words.length) {
    await endLearn();
  } else {
    document.getElementById('answer-input').style.display = '';
    document.getElementById('validate-btn').style.display = '';
    document.getElementById('hint-letter-btn').style.display = '';
    renderLearnQuestion();
  }
}

async function endLearn() {
  for (const res of learnSession.results) {
    const w = allWords.find(x => x.id === res.wordId);
    if (!w) continue;
    const prev = w.status;

    if (res.correct) {
      w.consecutiveCorrect = (w.consecutiveCorrect||0) + 1;
      if (w.consecutiveCorrect >= 3) w.status = 'maîtrisé';
    } else {
      w.errorCount         = (w.errorCount||0) + 1;
      w.consecutiveCorrect = 0;
      if (prev === 'maîtrisé' || prev === 'nouveau') w.status = 'à_revoir';
    }
    w.lastSeenDate = todayStr();

    // Badge Rédemption
    if (res.correct && w.status === 'maîtrisé' && w.errorCount >= 5 && !settings.redemptionDone) {
      settings.redemptionDone = true;
      pendingRewards.push(BADGES_DIVERS.find(b => b.id === 'redemption'));
      await saveSetting('redemptionDone', true);
      if (navigator.vibrate) navigator.vibrate([50,30,100,30,200]);
    }

    await updateWord(w);
  }

  const totalWords   = learnSession.words.length;
  const correctCount = learnSession.results.filter(r => r.correct).length;
  // Session parfaite : 100% correct, pas d'indice utilisé
  const isPerfect    = learnSession.perfectSoFar && correctCount === totalWords;

  if (isPerfect) {
    settings.perfectStreak = (settings.perfectStreak||0) + 1;
    if (!(settings.badges||[]).includes('perfect')) {
      settings.badges = [...(settings.badges||[]), 'perfect'];
      pendingRewards.push(BADGES_LEARN.find(b => b.id === 'perfect'));
    }
    if (settings.perfectStreak >= 5 && !(settings.badges||[]).includes('infaillible')) {
      settings.badges = [...(settings.badges||[]), 'infaillible'];
      pendingRewards.push(BADGES_LEARN.find(b => b.id === 'infaillible'));
    }
  } else {
    settings.perfectStreak = 0;
  }

  const snap  = { date: todayStr(), count: masteredWords().length };
  const snaps = settings.masteredSnapshots || [];
  const todaySnap = snaps.find(s => s.date === todayStr());
  if (todaySnap) todaySnap.count = snap.count;
  else snaps.push(snap);
  settings.masteredSnapshots = snaps;

  await checkMaitriseBadges();
  await checkAndUpdateStreak(todayStr());

  const avgTime = learnSession.results.length
    ? Math.round(learnSession.results.filter(r=>r.elapsed).reduce((a,r)=>a+(r.elapsed||0),0) / learnSession.results.length)
    : 0;

  await dbPut('sessions', {
    id: generateId(), date: new Date().toISOString(), mode: 'learn',
    totalWords, correctCount, durationSeconds: 0,
    isChallengeDay: true, streakAtSession: settings.currentStreak,
  });
  await saveSettings();

  showLearnResults(correctCount, totalWords, avgTime);
}

function showLearnResults(correct, total, avgTime) {
  const score  = total ? Math.round(correct/total*100) : 0;
  const errors = total - correct;

  document.getElementById('memo-phase').style.display = 'none';
  document.getElementById('restitution-phase').classList.remove('active');
  document.getElementById('learn-results').classList.add('active');
  document.getElementById('learn-phase-tag').textContent = 'Résultats';
  document.getElementById('learn-counter').textContent   = '✓';

  document.getElementById('learn-res-score').textContent   = `${score}%`;
  document.getElementById('learn-res-time').textContent    = avgTime ? `${avgTime}s` : '—';
  document.getElementById('learn-res-correct').textContent = correct;
  document.getElementById('learn-res-errors').textContent  = errors;

  const missed = learnSession.results.filter(r => !r.correct).map(r => allWords.find(w => w.id === r.wordId)).filter(Boolean);
  const missEl = document.getElementById('learn-miss-list');
  if (missed.length) {
    document.getElementById('learn-miss-label').classList.remove('hidden');
    missEl.classList.remove('hidden');
    missEl.innerHTML = missed.map(w =>
      `<div class="miss-item">
        <span class="miss-word">${w.mot} <span style="font-size:11px;color:var(--text-tertiary)">${(w.nature||[]).join(', ')}</span></span>
        <span class="miss-x">✗</span>
      </div>`
    ).join('');
  } else {
    document.getElementById('learn-miss-label').classList.add('hidden');
    missEl.classList.add('hidden');
  }

  if (pendingRewards.length) {
    const r = pendingRewards[pendingRewards.length - 1];
    if (r && !r.special) {
      document.getElementById('learn-reward-banner').classList.remove('hidden');
      document.getElementById('learn-reward-icon').textContent  = r.label ? r.label.split(' ')[0] : '🏅';
      document.getElementById('learn-reward-title').textContent = `Badge débloqué : ${r.label ? r.label.split(' ').slice(1).join(' ') : ''}`;
      document.getElementById('learn-reward-sub').textContent   = r.desc || '';
      playTone('reward');
      launchConfetti();
    }
    pendingRewards = [];
  } else {
    document.getElementById('learn-reward-banner').classList.add('hidden');
  }

  let sx = 0;
  const results = document.getElementById('learn-results');
  results.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive:true });
  results.addEventListener('touchend', e => {
    if (Math.abs(e.changedTouches[0].clientX - sx) > 60) navigateTo('home');
  });
  results.addEventListener('click', e => {
    if (!e.target.closest('button')) navigateTo('home');
  });
}

/* ─────────────────────────────────────────────────────────────
   STATS
───────────────────────────────────────────────────────────── */
async function refreshStats() {
  const active   = activeWords();
  const mastered = masteredWords();
  const review   = reviewWords();
  const total    = active.length;

  const mPct = total ? mastered.length / total : 0;
  const rPct = total ? review.length / total : 0;
  const vPct = 1 - mPct - rPct;

  document.getElementById('seg-m').style.flex = Math.round(mPct * 1000);
  document.getElementById('seg-r').style.flex = Math.round(rPct * 1000);
  document.getElementById('seg-v').style.flex = Math.max(1, Math.round(vPct * 1000));

  const fmt = v => v >= 1 ? '100%' : `${(v*100).toFixed(2)}%`;
  document.getElementById('leg-m').textContent = `Maîtrisés ${fmt(mPct)}`;
  document.getElementById('leg-r').textContent = `À revoir ${fmt(rPct)}`;
  document.getElementById('leg-v').textContent = `À voir ${fmt(vPct)}`;
  document.getElementById('curve-pct').textContent = fmt(mPct);

  drawCurve();

  const sessions = await dbGetAll('sessions');
  drawHisto(sessions);

  const learnSess = sessions.filter(s => s.mode === 'learn').length;
  const flashSess = sessions.filter(s => s.mode === 'flash').length;
  document.getElementById('stat-sess-learn').textContent = learnSess;
  document.getElementById('stat-sess-flash').textContent = flashSess;

  const diffList = [...active]
    .filter(w => w.errorCount > 0)
    .sort((a,b) => (b.errorCount||0) - (a.errorCount||0))
    .slice(0, 4);

  const diffEl = document.getElementById('diff-words-list');
  if (diffList.length) {
    diffEl.innerHTML = diffList.map((w, i) =>
      `<div class="diff-item${i < diffList.length-1 ? ' diff-sep' : ''}">
        <div class="diff-left"><span class="diff-word">${w.mot}</span>${natureBadgeHtml(w.nature)}</div>
        <span class="diff-errors">✗ ${w.errorCount}×</span>
      </div>`
    ).join('');
  } else {
    diffEl.innerHTML = `<div style="font-size:13px;color:var(--text-disabled);text-align:center;padding:8px">Pas encore de données</div>`;
  }
}

function drawCurve() {
  const snaps = settings.masteredSnapshots || [];
  if (!snaps.length) return;

  const filtered = [...snaps].sort((a,b) => a.date.localeCompare(b.date));
  const total = activeWords().length || 1;
  const W = 300, H = 70, pad = 4;

  const xs = filtered.map((_,i) => pad + (i/(Math.max(filtered.length-1,1))) * (W-2*pad));
  const ys = filtered.map(s => H - pad - ((s.count/total) * (H-2*pad)));

  if (filtered.length < 2) {
    const x = W/2, y = H - pad - ((filtered[0].count/total)*(H-2*pad));
    document.getElementById('curve-fill').setAttribute('d','');
    document.getElementById('curve-line').setAttribute('d','');
    document.getElementById('curve-dot').setAttribute('cx', x);
    document.getElementById('curve-dot').setAttribute('cy', y);
    document.getElementById('curve-dot').style.display = '';
    document.getElementById('curve-x-labels').innerHTML = '';
    return;
  }

  let line = `M${xs[0]},${ys[0]}`;
  for (let i=1;i<xs.length;i++) {
    const cpx = (xs[i-1]+xs[i])/2;
    line += ` C${cpx},${ys[i-1]} ${cpx},${ys[i]} ${xs[i]},${ys[i]}`;
  }
  const fill = line + ` L${xs[xs.length-1]},${H} L${xs[0]},${H} Z`;

  document.getElementById('curve-fill').setAttribute('d', fill);
  document.getElementById('curve-line').setAttribute('d', line);
  document.getElementById('curve-dot').style.display  = 'none';
  document.getElementById('curve-vline').style.display = 'none';

  const labels = [
    fmtDate(filtered[0].date),
    fmtDate(filtered[Math.floor(filtered.length/2)].date),
    fmtDate(filtered[filtered.length-1].date),
  ];
  document.getElementById('curve-x-labels').innerHTML = labels.map(l=>`<span>${l}</span>`).join('');

  initCurveTouch(filtered, xs, ys, total, W, H);
}

function initCurveTouch(snaps, xs, ys, total, W) {
  const svg   = document.getElementById('curve-svg');
  const label = document.getElementById('curve-date');
  const dot   = document.getElementById('curve-dot');
  const vline = document.getElementById('curve-vline');

  // Supprimer anciens listeners
  svg._ctsStart && svg.removeEventListener('touchstart', svg._ctsStart);
  svg._ctsMove  && svg.removeEventListener('touchmove',  svg._ctsMove);
  svg._ctsEnd   && svg.removeEventListener('touchend',   svg._ctsEnd);

  svg._ctsStart = e => { e.preventDefault(); handleCurveTouch(e.touches[0], snaps, xs, ys, total, W, label, dot, vline); };
  svg._ctsMove  = e => { e.preventDefault(); handleCurveTouch(e.touches[0], snaps, xs, ys, total, W, label, dot, vline); };
  svg._ctsEnd   = () => { label.style.display='none'; dot.style.display='none'; vline.style.display='none'; };

  svg.addEventListener('touchstart', svg._ctsStart, { passive: false });
  svg.addEventListener('touchmove',  svg._ctsMove,  { passive: false });
  svg.addEventListener('touchend',   svg._ctsEnd,   { passive: true  });
}

function handleCurveTouch(touch, snaps, xs, ys, total, W, label, dot, vline) {
  const svgEl = document.getElementById('curve-svg');
  const rect  = svgEl.getBoundingClientRect();
  const xSvg  = ((touch.clientX - rect.left) / rect.width) * W;
  let closest = 0, minDist = Infinity;
  xs.forEach((x,i) => { const d=Math.abs(x-xSvg); if(d<minDist){minDist=d;closest=i;} });
  const snap   = snaps[closest];
  const pct    = total ? snap.count / total : 0;
  const pctStr = pct >= 1 ? '100%' : `${(pct*100).toFixed(2)}%`;
  label.textContent = `${fmtDate(snap.date)} · ${pctStr}`;
  label.style.display = '';
  dot.setAttribute('cx', xs[closest]);
  dot.setAttribute('cy', ys[closest]);
  dot.style.display = '';
  vline.setAttribute('x1', xs[closest]);
  vline.setAttribute('x2', xs[closest]);
  vline.style.display = '';
}

function fmtDate(str) {
  if (!str) return '';
  const d = new Date(str);
  const months = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function drawHisto(sessions) {
  const svg = document.getElementById('histo-svg');
  const W = 294, barW = 30, barGap = 12, barH = 60;
  const statusY = 72, labelY = 90, legendY = 108;

  const today   = new Date();
  const dow     = today.getDay();
  // Lundi de la semaine courante — correction bug dimanche (dow=0)
  const diffToMonday = (dow === 0) ? 6 : dow - 1;
  const monday  = new Date(today);
  monday.setDate(today.getDate() - diffToMonday);

  const days7 = Array.from({length:7}, (_,i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().slice(0,10);
  });

  const learnByDay = {}, flashByDay = {};
  sessions.forEach(s => {
    const d = s.date.slice(0,10);
    if (s.mode === 'learn') learnByDay[d] = (learnByDay[d]||0) + (s.totalWords||0);
    if (s.mode === 'flash') flashByDay[d] = (flashByDay[d]||0) + (s.totalWords||0);
  });

  const validDays = settings.validDays || [1,2,3,4,5];
  const maxVal    = Math.max(1, ...days7.map(d => (learnByDay[d]||0) + (flashByDay[d]||0)));
  const dayLabels = ['L','M','M','J','V','S','D'];

  let svgContent = '';
  days7.forEach((dateStr, i) => {
    const x   = i * (barW + barGap) + 6;
    const lv  = learnByDay[dateStr]||0;
    const fv  = flashByDay[dateStr]||0;
    const tot = lv + fv;
    // Jour de la semaine pour ce jour précis (0=dim, 1=lun…)
    const dateDow   = new Date(dateStr).getDay();
    const isValid   = validDays.includes(dateDow);
    const hasAct    = tot > 0;
    const isFuture  = dateStr > todayStr();

    let statusColor = '#D8D8D8'; // gris par défaut (jours inactifs ou dimanche)
    if (!isFuture && isValid) {
      if (hasAct) statusColor = '#B8DFB4';
      else if (dateStr < todayStr()) statusColor = '#E8A0A0';
      else statusColor = '#B8DFB4'; // aujourd'hui, jour valide sans activité
    }
    // Les jours non valides restent toujours gris #D8D8D8

    svgContent += `<rect x="${x}" y="${statusY}" width="${barW}" height="4" rx="2" fill="${statusColor}"/>`;

    if (hasAct) {
      const fH = Math.round((fv/maxVal) * barH);
      const lH = Math.round((lv/maxVal) * barH);
      const totalH = fH + lH;
      const baseY  = statusY - 4 - totalH;
      if (fH > 0) svgContent += `<rect x="${x}" y="${baseY}" width="${barW}" height="${fH}" rx="3" fill="#B8B0EE"/>`;
      if (lH > 0) svgContent += `<rect x="${x}" y="${baseY+fH}" width="${barW}" height="${lH}" rx="3" fill="#B8DFB4"/>`;
    }

    const lblColor = isValid ? '#bbb' : '#ccc';
    svgContent += `<text x="${x+barW/2}" y="${labelY}" text-anchor="middle" font-size="10" fill="${lblColor}" font-family="sans-serif">${dayLabels[i]}</text>`;
  });

  svgContent += `
    <rect x="10"  y="${legendY}" width="10" height="8" rx="2" fill="#B8DFB4"/>
    <text x="24"  y="${legendY+7}" font-size="9" fill="#888" font-family="sans-serif">Apprentissage</text>
    <rect x="115" y="${legendY}" width="10" height="8" rx="2" fill="#B8B0EE"/>
    <text x="129" y="${legendY+7}" font-size="9" fill="#888" font-family="sans-serif">Flash</text>
  `;

  svg.innerHTML = svgContent;
}

/* ─────────────────────────────────────────────────────────────
   RÉGLAGES
───────────────────────────────────────────────────────────── */
function refreshSettings() {
  document.querySelectorAll('.day-btn').forEach(b => {
    const day = parseInt(b.dataset.day);
    const on  = (settings.validDays||[1,2,3,4,5]).includes(day);
    b.className = `day-btn ${on ? 'on' : 'off'}`;
  });

  document.getElementById('learn-words-val').textContent    = settings.wordsPerSession || 12;
  document.getElementById('review-ratio-val').textContent   = `${settings.reviewRatioPct || 20}%`;
  document.getElementById('mastered-ratio-val').textContent = `${settings.masteredRatioPct || 10}%`;

  const learnRatio = settings.learnRatioPct !== undefined ? settings.learnRatioPct : 75;
  refreshLearnRatioSlider(learnRatio);

  document.getElementById('flash-words-val').textContent = settings.flashWordsPerSession || 10;

  const flashRatio = settings.flashRatioPct !== undefined ? settings.flashRatioPct : 75;
  refreshFlashRatioSlider(flashRatio);

  refreshSoundBtns();
  refreshWordsModifiedMsg();

  const baseVer = settings.wordsBaseVersion || '—';
  const baseVerDisplay = baseVer.replace('lexis_v', 'Base v');
  const expVer  = settings.lastWordsExportVersion || null;
  document.getElementById('version-line').textContent =
    `Lexis v1.2 · ${baseVerDisplay}${expVer ? ' · export ' + expVer.replace('lexis_v','') : ''}`;
}

function refreshLearnRatioSlider(ratio) {
  const slider = document.getElementById('learn-ratio-slider');
  if (slider) slider.value = ratio;
  updateLearnRatioLabel(ratio);
}

function updateLearnRatioLabel(ratio) {
  // ratio = % saisie
  const lbl = document.getElementById('learn-ratio-label');
  if (!lbl) return;
  const writePct = ratio;
  const evPct    = 100 - ratio;
  if (writePct === 100) lbl.textContent = '100% saisie';
  else if (evPct === 100) lbl.textContent = '100% évocation';
  else lbl.textContent = `${writePct}% saisie · ${evPct}% évocation`;
}

function refreshFlashRatioSlider(ratio) {
  const slider = document.getElementById('flash-ratio-slider');
  if (slider) slider.value = ratio;
  updateFlashRatioLabel(ratio);
}

function updateFlashRatioLabel(ratio) {
  const lbl = document.getElementById('flash-ratio-label');
  if (!lbl) return;
  const motPct = ratio;
  const defPct = 100 - ratio;
  if (motPct === 0)   lbl.textContent = '100% Déf. → Mot';
  else if (motPct === 100) lbl.textContent = '100% Mot → Déf.';
  else lbl.textContent = `${motPct}% Mot → Déf. · ${defPct}% Déf. → Mot`;
}

function refreshSoundBtns() {
  setSound('snd-correct-btn', settings.soundCorrect);
  setSound('snd-wrong-btn',   settings.soundWrong);
  setSound('snd-reward-btn',  settings.soundRewards);
}

function setSound(id, on) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.className = `speaker-btn ${on ? 'on' : 'off'}`;
  btn.innerHTML = on
    ? `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>`
    : `<svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>`;
}

/* ─────────────────────────────────────────────────────────────
   VERSIONNAGE EXPORT
───────────────────────────────────────────────────────────── */
function computeNextWordsVersion() {
  const now    = new Date();
  const yy     = String(now.getFullYear()).slice(2);
  const mm     = String(now.getMonth()+1).padStart(2,'0');
  const prefix = `lexis_v${yy}${mm}-`;
  const current = settings.lastWordsExportVersion || '';
  if (current.startsWith(prefix)) {
    const letter = current.slice(prefix.length);
    return prefix + String.fromCharCode(letter.charCodeAt(0) + 1);
  }
  return prefix + 'a';
}

/* ─────────────────────────────────────────────────────────────
   EXPORT / IMPORT
───────────────────────────────────────────────────────────── */
function exportProgress() {
  downloadJson({ version:'1.2', exportDate: new Date().toISOString(), settings },
    `lexis-progression-${todayStr()}.json`);
  saveSetting('lastExportDate', todayStr());
  showToast('Progression exportée');
}

async function importProgress(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data.settings) throw new Error('Format invalide');
    Object.assign(settings, data.settings);
    await saveSettings();
    refreshHome();
    refreshSettings();
    showToast('Progression importée');
  } catch(e) { showToast('Erreur : fichier invalide'); }
}

function exportWords() {
  const version  = computeNextWordsVersion();
  const wordData = allWords.filter(w => !w.isArchived || w.isUserCreated);
  downloadJson([{ __lexis_version__: version }, ...wordData], 'words.json');
  settings.lastWordsExportVersion = version;
  saveSetting('lastWordsExportVersion', version);
  saveSetting('lastWordExportDate', todayStr());
  saveSetting('_wordsModified', false);
  settings._wordsModified = false;
  refreshWordsModifiedMsg();
  refreshSettings();
  showToast(`Liste exportée (${version})`);
}

async function importWords(file) {
  try {
    const raw = JSON.parse(await file.text());
    if (!Array.isArray(raw)) throw new Error('Format invalide');

    const sentinel = raw.find(item => item.__lexis_version__);
    if (sentinel) {
      settings.wordsBaseVersion = sentinel.__lexis_version__;
      await saveSetting('wordsBaseVersion', sentinel.__lexis_version__);
    }
    const data = raw.filter(item => !item.__lexis_version__);

    const progMap = {};
    allWords.forEach(w => {
      progMap[w.id] = { status:w.status, consecutiveCorrect:w.consecutiveCorrect, errorCount:w.errorCount, lastSeenDate:w.lastSeenDate };
    });
    data.forEach(w => { if (progMap[w.id]) Object.assign(w, progMap[w.id]); });

    const tx = db.transaction('words', 'readwrite');
    tx.objectStore('words').clear();
    data.forEach(w => tx.objectStore('words').put(w));
    await new Promise((res,rej) => { tx.oncomplete=res; tx.onerror=rej; });

    allWords = data;
    refreshWordList();
    refreshHome();
    refreshSettings();
    showToast('Liste importée');
  } catch(e) { showToast('Erreur : fichier invalide'); }
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function resetProgress() {
  allWords.forEach(w => { w.status='nouveau'; w.consecutiveCorrect=0; w.errorCount=0; w.lastSeenDate=null; });
  await dbPutAll('words', allWords);

  const tx = db.transaction('sessions', 'readwrite');
  tx.objectStore('sessions').clear();
  await new Promise((res,rej)=>{ tx.oncomplete=res; tx.onerror=rej; });

  ['currentStreak','longestStreak','jokers','badges','lastLearningDate',
   'perfectStreak','redemptionDone','flashSessionCount','masteredSnapshots',
   'flashSessionsToday','flashSessionsDate'].forEach(k => { settings[k] = DEFAULT_SETTINGS[k]; });
  await saveSettings();
  refreshHome();
  refreshSettings();
  showToast('Entraînement réinitialisé');
}

async function deleteApp() {
  try {
    for (const store of ['words','sessions','settings']) {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      await new Promise((res,rej)=>{ tx.oncomplete=res; tx.onerror=rej; });
    }
    if ('caches' in window) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
    if ('serviceWorker' in navigator)
      await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister()));

    document.body.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;padding:24px;text-align:center;gap:16px">
        <div style="font-size:32px">✓</div>
        <div style="font-size:18px;font-weight:600;color:#1A1A1A">Données supprimées</div>
        <div style="font-size:14px;color:#555;line-height:1.6">
          Toutes les données de Lexis ont été effacées.<br>
          Pour désinstaller l'application, rendez-vous dans les<br>
          <strong>réglages de votre navigateur</strong> ou appuyez longuement<br>
          sur l'icône Lexis sur votre écran d'accueil.
        </div>
      </div>`;
  } catch(e) { showToast('Erreur lors de la suppression'); console.error(e); }
}

/* ─────────────────────────────────────────────────────────────
   UTILITAIRE
───────────────────────────────────────────────────────────── */
function shuffleArray(arr) {
  const a = [...arr];
  for (let i=a.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

/* ─────────────────────────────────────────────────────────────
   EVENTS — BINDING
───────────────────────────────────────────────────────────── */
function bindEvents() {

  document.querySelectorAll('.nav-item').forEach(ni => {
    ni.addEventListener('click', () => navigateTo(ni.dataset.screen));
  });

  /* ── Accueil ── */
  document.getElementById('streak-pill-btn').addEventListener('click', openFlamePopup);
  document.getElementById('btn-go-flash').addEventListener('click', startFlash);
  document.getElementById('btn-go-learn').addEventListener('click', startLearn);

  document.getElementById('home-review-card').addEventListener('click', () => {
    wordsFromReview = true;
    activeFilters   = new Set(['review']);
    navigateTo('words');
    requestAnimationFrame(() => {
      document.querySelectorAll('.filter-pill').forEach(p => {
        p.classList.toggle('active', p.dataset.filter === 'review');
      });
    });
  });

  document.getElementById('joker-banner-close').addEventListener('click', () => {
    document.getElementById('joker-banner').classList.remove('show');
  });

  /* ── Flash ── */
  document.getElementById('flash-back-btn').addEventListener('click', () => {
    if (flashSession.idx === 0) {
      navigateTo('home');
    } else {
      showFlashPrevious();
    }
  });
  document.getElementById('flash-hint-btn').addEventListener('click', handleFlashHint);
  document.getElementById('flash-reveal-btn').addEventListener('click', revealFlashAnswer);
  document.getElementById('flash-judge-wrong').addEventListener('click', () => judgeFlash(false));
  document.getElementById('flash-judge-ok').addEventListener('click',    () => judgeFlash(true));

  /* ── Apprentissage ── */
  document.getElementById('learn-back-btn').addEventListener('click', () => navigateTo('home'));
  document.getElementById('tester-btn').addEventListener('click', () => {
    if (!learnSession.scrolledAll) return;
    startRestitutionPhase();
  });
  document.getElementById('validate-btn').addEventListener('click', handleAnswerValidate);
  document.getElementById('answer-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAnswerValidate();
  });
  document.getElementById('hint-letter-btn').addEventListener('click', handleHintLetter);
  document.getElementById('evoke-reveal-btn').addEventListener('click', revealLearnEvoke);
  document.getElementById('evoke-judge-wrong').addEventListener('click', () => judgeLearnEvoke(false));
  document.getElementById('evoke-judge-ok').addEventListener('click',    () => judgeLearnEvoke(true));

  /* ── Liste de mots ── */
  document.getElementById('btn-add-word').addEventListener('click', () => openWordForm(null));
  document.getElementById('form-cancel-btn').addEventListener('click', closeWordForm);
  document.getElementById('form-cancel-btn2').addEventListener('click', closeWordForm);
  document.getElementById('form-save-btn').addEventListener('click', saveWordForm);
  document.getElementById('form-mot').addEventListener('input', e => {
    updateDynList(e.target.value.trim());
    updateFormSaveBtn();
  });
  document.getElementById('form-def').addEventListener('input', updateFormSaveBtn);
  document.querySelectorAll('.nat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const nat = btn.dataset.nat;
      if (selectedNatures.has(nat)) selectedNatures.delete(nat);
      else selectedNatures.add(nat);
      btn.classList.toggle('sel', selectedNatures.has(nat));
    });
  });
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value;
    refreshWordList();
  });
  document.getElementById('cycle-btn').addEventListener('click', () => {
    const modes  = ['mot','definition','theme'];
    const labels = { mot:'Rechercher un mot…', definition:'Rechercher dans les définitions…', theme:'Rechercher par thème…' };
    searchMode   = modes[(modes.indexOf(searchMode)+1) % modes.length];
    document.getElementById('search-input').placeholder = labels[searchMode];
    refreshWordList();
  });
  document.getElementById('filters-wrap').addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    const f = pill.dataset.filter;
    if (f === 'all') {
      activeFilters = new Set(['all']);
    } else {
      activeFilters.delete('all');
      if (activeFilters.has(f)) activeFilters.delete(f);
      else activeFilters.add(f);
      if (!activeFilters.size) activeFilters.add('all');
    }
    document.querySelectorAll('.filter-pill').forEach(p => {
      p.classList.toggle('active', activeFilters.has(p.dataset.filter) ||
        (activeFilters.has('all') && p.dataset.filter === 'all'));
    });
    refreshWordList();
  });

  /* ── Réglages ── */
  document.getElementById('day-grid').addEventListener('click', e => {
    const btn = e.target.closest('.day-btn');
    if (!btn) return;
    const day = parseInt(btn.dataset.day);
    let days  = [...(settings.validDays || [1,2,3,4,5])];
    if (days.includes(day)) days = days.filter(d => d !== day);
    else days.push(day);
    saveSetting('validDays', days);
    btn.className = `day-btn ${days.includes(day) ? 'on' : 'off'}`;
  });

  makeStepper('learn-words',    'wordsPerSession',   5, 35, 1);
  makeStepper('review-ratio',   'reviewRatioPct',    0, 35, 5, '%');
  makeStepper('mastered-ratio', 'masteredRatioPct',  0, 35, 5, '%');
  makeStepper('flash-words',    'flashWordsPerSession', 5, 25, 1);

  // Slider ratio Apprentissage
  document.getElementById('learn-ratio-slider').addEventListener('input', e => {
    const raw     = parseInt(e.target.value);
    const snapped = Math.round(raw / 25) * 25;
    e.target.value = snapped;
    settings.learnRatioPct = snapped;
    saveSetting('learnRatioPct', snapped);
    updateLearnRatioLabel(snapped); // snapped = % saisie
  });

  // Slider ratio Flash
  document.getElementById('flash-ratio-slider').addEventListener('input', e => {
    const raw     = parseInt(e.target.value);
    const snapped = Math.round(raw / 25) * 25;
    e.target.value = snapped;
    settings.flashRatioPct = snapped;
    saveSetting('flashRatioPct', snapped);
    updateFlashRatioLabel(snapped);
  });

  // Sons
  ['correct','wrong','reward'].forEach(type => {
    const key = type === 'correct' ? 'soundCorrect' : type === 'wrong' ? 'soundWrong' : 'soundRewards';
    document.getElementById(`snd-${type}-btn`).addEventListener('click', () => {
      settings[key] = !settings[key];
      saveSetting(key, settings[key]);
      refreshSoundBtns();
      if (settings[key]) playTone(type);
    });
  });

  // Données
  document.getElementById('btn-import-progress').addEventListener('click', () => openModal('import-progress-modal'));
  document.getElementById('btn-export-progress').addEventListener('click', exportProgress);
  document.getElementById('btn-import-words').addEventListener('click',    () => openModal('import-words-modal'));
  document.getElementById('btn-export-words').addEventListener('click',    exportWords);

  document.getElementById('import-progress-cancel').addEventListener('click', () => closeModal('import-progress-modal'));
  document.getElementById('import-progress-choose').addEventListener('click', () => {
    document.getElementById('import-progress-input').click();
  });
  document.getElementById('import-progress-input').addEventListener('change', e => {
    if (e.target.files[0]) { importProgress(e.target.files[0]); closeModal('import-progress-modal'); }
  });
  document.getElementById('import-words-cancel').addEventListener('click', () => closeModal('import-words-modal'));
  document.getElementById('import-words-choose').addEventListener('click', () => {
    document.getElementById('import-words-input').click();
  });
  document.getElementById('import-words-input').addEventListener('change', e => {
    if (e.target.files[0]) { importWords(e.target.files[0]); closeModal('import-words-modal'); }
  });

  document.getElementById('btn-reset').addEventListener('click',  () => openModal('reset-modal'));
  document.getElementById('reset-cancel').addEventListener('click',  () => closeModal('reset-modal'));
  document.getElementById('reset-confirm').addEventListener('click', async () => {
    closeModal('reset-modal'); await resetProgress();
  });

  document.getElementById('btn-delete-app').addEventListener('click', () => openModal('delete-app-modal'));
  document.getElementById('delete-app-cancel').addEventListener('click',  () => closeModal('delete-app-modal'));
  document.getElementById('delete-app-confirm').addEventListener('click', async () => {
    closeModal('delete-app-modal'); await deleteApp();
  });

  /* ── Theme picker ── */
  document.getElementById('theme-cancel').addEventListener('click',  () => closeModal('theme-picker'));
  document.getElementById('theme-confirm').addEventListener('click', () => {
    if (pickerSelected && !formThemes.includes(pickerSelected)) {
      formThemes.push(pickerSelected);
      renderFormThemes();
    }
    closeModal('theme-picker');
  });
  document.getElementById('theme-search').addEventListener('input', e => {
    renderThemesGrid(e.target.value);
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('show');
    });
  });

  initGlobalSwipeDown();
}

function makeStepper(prefix, key, min, max, step, suffix='') {
  const valEl  = document.getElementById(`${prefix}-val`);
  const btnMin = document.getElementById(`${prefix}-minus`);
  const btnPls = document.getElementById(`${prefix}-plus`);
  if (!valEl || !btnMin || !btnPls) return;
  btnMin.addEventListener('click', () => {
    const v = Math.max(min, (settings[key]||min) - step);
    saveSetting(key, v);
    valEl.textContent = v + suffix;
  });
  btnPls.addEventListener('click', () => {
    const v = Math.min(max, (settings[key]||min) + step);
    saveSetting(key, v);
    valEl.textContent = v + suffix;
  });
}

/* ─────────────────────────────────────────────────────────────
   INIT
───────────────────────────────────────────────────────────── */
async function init() {
  try {
    db = await openDB();
    await loadSettings();
    await loadWords();

    setTimeout(() => {
      document.getElementById('splash').classList.add('hidden');
    }, 1600);

    const baseVer   = settings.wordsBaseVersion || 'lexis_v2604-a';
    const splashSub = document.getElementById('splash-sub');
    const baseVerDisplay = baseVer.replace('lexis_v', 'Base v');
    if (splashSub) splashSub.textContent = `${baseVerDisplay} · ${allWords.length.toLocaleString('fr')} mots`;

    refreshHome();
    refreshSettings();
    bindEvents();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('service-worker.js')
        .catch(err => console.warn('SW:', err));
    }
  } catch(e) {
    console.error('Init failed:', e);
    document.getElementById('splash').innerHTML =
      '<div style="color:#A32D2D;padding:20px;text-align:center">Erreur de chargement.<br>Veuillez recharger l\'application.</div>';
  }
}

document.addEventListener('DOMContentLoaded', init);
