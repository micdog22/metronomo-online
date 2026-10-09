import {
  BPM_MIN, BPM_MAX, TIMER_INTERVAL_MS, UNIT_LABELS,
  clampBpm, buildPattern, subdivisionOptions, resolveSubdivision, scheduleTicks, createTapTempo,
  tempoMarking, validateTrainer, trainerBpm, trainerStatus, keyAction, sanitizeSettings, getSignature,
} from './metronome-core.js';
import { playTick, volumeToGain } from './sounds.js';

const STORAGE_KEY = 'metronomo-online';
const $ = (id) => document.getElementById(id);
const els = {
  bpm: $('bpm'),
  bpmUnit: $('bpm-unit'),
  range: $('bpm-range'),
  down: $('bpm-down'),
  up: $('bpm-up'),
  marking: $('marking'),
  beats: $('beats'),
  barInfo: $('bar-info'),
  toggle: $('toggle'),
  tap: $('tap'),
  status: $('status'),
  signature: $('signature'),
  subdivision: $('subdivision'),
  unitHint: $('unit-hint'),
  volume: $('volume'),
  volumeValue: $('volume-value'),
  accent: $('accent'),
  sounds: document.querySelectorAll('input[name="sound"]'),
  trainerEnabled: $('trainer-enabled'),
  trainerStep: $('trainer-step'),
  trainerBars: $('trainer-bars'),
  trainerLimit: $('trainer-limit'),
  trainerStatus: $('trainer-status'),
};

let settings = loadSettings();
let pattern = buildPattern(settings.signature, settings.subdivision, settings.accent);
let audio = null;
let running = false;
let timerId = null;
let rafId = null;
let sched = null;
let queue = [];
let training = null; // { startBpm, startBar } enquanto o treino roda
let lastBar = -1;
let dots = [];
let activeDot = null;
let wakeLock = null;
const tapper = createTapTempo();

function loadSettings() {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'));
  } catch {
    return sanitizeSettings(null);
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Armazenamento indisponível: as preferências valem só nesta visita.
  }
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function setStatus(text) {
  setText(els.status, text);
}

// ---------- Áudio ----------

function ensureAudio() {
  if (!audio) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      setStatus('Seu navegador não tem suporte a Web Audio, então o metrônomo não consegue tocar.');
      return null;
    }
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // Recurso opcional (Safari): segue sem ele.
    }
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = volumeToGain(settings.volume);
    master.connect(ctx.destination);
    audio = { ctx, master };
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
  return audio;
}

function bpmForBar(bar) {
  return training ? trainerBpm(training.startBpm, settings.trainer, bar - training.startBar) : settings.bpm;
}

function schedule() {
  const { ctx, master } = audio;
  const result = scheduleTicks(sched, ctx.currentTime, pattern, bpmForBar);
  sched = result.state;
  for (const note of result.notes) {
    playTick(ctx, master, note.time, settings.sound, note.level);
    queue.push(note);
  }
  if (queue.length > 64) queue.splice(0, queue.length - 64);
}

function draw() {
  if (!running) return;
  const now = audio.ctx.currentTime;
  let current = null;
  while (queue.length && queue[0].time <= now) current = queue.shift();
  if (current) onTickPlayed(current);
  rafId = requestAnimationFrame(draw);
}

function onTickPlayed(note) {
  highlight(note.tickIndex);
  if (note.bar === lastBar) return;
  lastBar = note.bar;
  setText(els.barInfo, `Tocando · compasso ${note.bar + 1}`);
  if (training) {
    if (note.bpm !== settings.bpm) {
      settings.bpm = note.bpm;
      renderBpm();
      saveSettings();
    }
    renderTrainerStatus(note.bar);
  }
}

function canTrain() {
  return settings.trainer.enabled && settings.trainer.limit > settings.bpm;
}

function start() {
  const a = ensureAudio();
  if (!a) return;
  running = true;
  pattern = buildPattern(settings.signature, settings.subdivision, settings.accent);
  renderBeats();
  sched = { nextTime: a.ctx.currentTime + 0.08, tickIndex: 0, bar: 0 };
  training = canTrain() ? { startBpm: settings.bpm, startBar: 0 } : null;
  queue = [];
  lastBar = -1;
  schedule();
  timerId = setInterval(schedule, TIMER_INTERVAL_MS);
  rafId = requestAnimationFrame(draw);
  requestWakeLock();
  els.toggle.textContent = 'Parar';
  els.toggle.setAttribute('aria-pressed', 'true');
  els.toggle.classList.add('playing');
  setStatus(training ? 'Tocando com treino progressivo.' : 'Tocando.');
  renderTrainerStatus(0);
}

function stop() {
  running = false;
  clearInterval(timerId);
  cancelAnimationFrame(rafId);
  timerId = null;
  queue = [];
  training = null;
  highlight(-1);
  releaseWakeLock();
  els.toggle.textContent = 'Iniciar';
  els.toggle.setAttribute('aria-pressed', 'false');
  els.toggle.classList.remove('playing');
  setText(els.barInfo, 'Parado');
  setStatus('Parado.');
  renderTrainerStatus();
}

function toggle() {
  if (running) stop();
  else start();
}

async function requestWakeLock() {
  try {
    if (!('wakeLock' in navigator) || wakeLock) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null;
    });
  } catch {
    wakeLock = null; // sem permissão ou sem suporte: a tela pode apagar, mas o som continua
  }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

// ---------- Interface ----------

function renderBpm() {
  if (document.activeElement !== els.bpm) els.bpm.value = String(settings.bpm);
  els.range.value = String(settings.bpm);
  els.range.setAttribute('aria-valuetext', `${settings.bpm} BPM`);
  const marking = tempoMarking(settings.bpm);
  setText(els.marking, `${marking.name} · ${marking.description}`);
  els.down.disabled = settings.bpm <= BPM_MIN;
  els.up.disabled = settings.bpm >= BPM_MAX;
}

function renderUnit() {
  const unit = UNIT_LABELS[getSignature(settings.signature).unit];
  setText(els.bpmUnit, `BPM ${unit.symbol}`);
  els.bpmUnit.title = `O BPM conta a ${unit.name}`;
  let hint = `O BPM conta a ${unit.name} (${unit.symbol}).`;
  if (settings.signature === '6/8' || settings.signature === '12/8') {
    hint = `No ${settings.signature}, o BPM conta a semínima pontuada (♩.): cada tempo tem três colcheias.`;
  } else if (settings.signature === '7/8') {
    hint = 'No 7/8, o BPM conta a colcheia (♪), agrupada em 2+2+3, com destaque no início de cada grupo.';
  }
  setText(els.unitHint, hint);
}

function renderSubdivisions() {
  const options = subdivisionOptions(settings.signature);
  els.subdivision.replaceChildren(...options.map((o) => new Option(o.label, o.id)));
  els.subdivision.value = settings.subdivision;
}

function renderBeats() {
  const frag = document.createDocumentFragment();
  let group = null;
  pattern.ticks.forEach((tick, index) => {
    if (tick.sub === 0) {
      group = document.createElement('div');
      group.className = 'beat';
      if (pattern.signature === '7/8' && (tick.level === 'strong' || tick.level === 'accent')) group.classList.add('group-start');
      frag.appendChild(group);
    }
    const dot = document.createElement('span');
    dot.className = `dot ${tick.level}`;
    if (tick.sub === 0) dot.textContent = String(tick.beat + 1);
    dot.dataset.index = String(index);
    group.appendChild(dot);
  });
  els.beats.replaceChildren(frag);
  dots = Array.from(els.beats.querySelectorAll('.dot'));
  activeDot = null;
}

function highlight(index) {
  if (activeDot) activeDot.classList.remove('active');
  activeDot = dots[index] || null;
  if (activeDot) activeDot.classList.add('active');
}

function renderTrainerStatus(bar = 0) {
  const t = settings.trainer;
  els.trainerStatus.classList.remove('error');
  const checked = validateTrainer({ step: els.trainerStep.value, everyBars: els.trainerBars.value, limit: els.trainerLimit.value });
  if (!checked.ok) {
    els.trainerStatus.classList.add('error');
    setText(els.trainerStatus, checked.errors.join(' '));
    return;
  }
  const plan = `sobe ${t.step} BPM a cada ${t.everyBars} ${t.everyBars === 1 ? 'compasso' : 'compassos'} até ${t.limit} BPM`;
  if (!t.enabled) {
    setText(els.trainerStatus, `Desativado. Quando ativo, ${plan}.`);
    return;
  }
  if (running && training) {
    const status = trainerStatus(training.startBpm, t, bar - training.startBar);
    setText(els.trainerStatus, status.done
      ? `Limite de ${t.limit} BPM atingido. Bom trabalho!`
      : `Treino em andamento: ${status.bpm} BPM. Próximo aumento em ${status.nextIn} ${status.nextIn === 1 ? 'compasso' : 'compassos'}.`);
    return;
  }
  if (t.limit <= settings.bpm) {
    els.trainerStatus.classList.add('error');
    setText(els.trainerStatus, `O limite precisa ser maior que o andamento atual (${settings.bpm} BPM). Diminua o BPM ou aumente o limite.`);
    return;
  }
  setText(els.trainerStatus, `Ao iniciar: começa em ${settings.bpm} BPM e ${plan}.`);
}

function renderAll() {
  renderBpm();
  renderUnit();
  renderSubdivisions();
  renderBeats();
  els.signature.value = settings.signature;
  els.accent.checked = settings.accent;
  els.volume.value = String(settings.volume);
  setText(els.volumeValue, `${settings.volume}%`);
  for (const radio of els.sounds) radio.checked = radio.value === settings.sound;
  els.trainerEnabled.checked = settings.trainer.enabled;
  els.trainerStep.value = String(settings.trainer.step);
  els.trainerBars.value = String(settings.trainer.everyBars);
  els.trainerLimit.value = String(settings.trainer.limit);
  renderTrainerStatus();
}

// ---------- Ações ----------

function setBpm(value) {
  const bpm = clampBpm(value);
  if (bpm === null) return;
  settings.bpm = bpm;
  // Mudança manual durante o treino: a progressão recomeça a partir do novo andamento.
  if (running && training) training = { startBpm: bpm, startBar: sched.bar };
  renderBpm();
  renderTrainerStatus(lastBar < 0 ? 0 : lastBar);
  saveSettings();
}

function patternChanged(restartBar) {
  pattern = buildPattern(settings.signature, settings.subdivision, settings.accent);
  renderBeats();
  if (running && restartBar) {
    sched = { ...sched, tickIndex: 0, bar: sched.bar + 1 };
    queue = [];
  }
  saveSettings();
}

function doTap() {
  const bpm = tapper.tap(performance.now());
  els.tap.classList.remove('tapped');
  void els.tap.offsetWidth;
  els.tap.classList.add('tapped');
  if (bpm === null) {
    setStatus('Continue tocando no ritmo…');
    return;
  }
  setBpm(bpm);
  setStatus(`Tap tempo: ${bpm} BPM (${tapper.count} toques).`);
}

function previewSound() {
  const a = ensureAudio();
  if (a && !running) playTick(a.ctx, a.master, a.ctx.currentTime + 0.02, settings.sound, 'accent');
}

function readTrainerInputs() {
  const checked = validateTrainer({ step: els.trainerStep.value, everyBars: els.trainerBars.value, limit: els.trainerLimit.value });
  if (checked.ok) {
    settings.trainer = { ...settings.trainer, ...checked.value };
    saveSettings();
  }
  renderTrainerStatus(lastBar < 0 ? 0 : lastBar);
}

els.toggle.addEventListener('click', toggle);
els.down.addEventListener('click', () => setBpm(settings.bpm - 1));
els.up.addEventListener('click', () => setBpm(settings.bpm + 1));
els.range.addEventListener('input', () => setBpm(els.range.value));
els.bpm.addEventListener('input', () => {
  const n = Number(els.bpm.value);
  if (els.bpm.value !== '' && Number.isFinite(n) && n >= BPM_MIN && n <= BPM_MAX) setBpm(n);
});
els.bpm.addEventListener('change', () => {
  if (els.bpm.value === '' || clampBpm(els.bpm.value) === null) els.bpm.value = String(settings.bpm);
  else setBpm(els.bpm.value);
  els.bpm.value = String(settings.bpm);
});

// Tap: pointerdown dá a menor latência; click sem ponteiro (Enter, leitor de tela) também conta.
els.tap.addEventListener('pointerdown', (e) => {
  if (e.button === 0) doTap();
});
els.tap.addEventListener('click', (e) => {
  if (e.detail === 0) doTap();
});

els.signature.addEventListener('change', () => {
  settings.signature = els.signature.value;
  settings.subdivision = resolveSubdivision(settings.signature, settings.subdivision);
  renderSubdivisions();
  renderUnit();
  patternChanged(true);
});
els.subdivision.addEventListener('change', () => {
  settings.subdivision = resolveSubdivision(settings.signature, els.subdivision.value);
  patternChanged(true);
});
els.accent.addEventListener('change', () => {
  settings.accent = els.accent.checked;
  patternChanged(false);
});
els.volume.addEventListener('input', () => {
  settings.volume = Number(els.volume.value);
  setText(els.volumeValue, `${settings.volume}%`);
  if (audio) audio.master.gain.setTargetAtTime(volumeToGain(settings.volume), audio.ctx.currentTime, 0.015);
  saveSettings();
});
for (const radio of els.sounds) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    settings.sound = radio.value;
    saveSettings();
    previewSound();
  });
}
els.trainerEnabled.addEventListener('change', () => {
  settings.trainer = { ...settings.trainer, enabled: els.trainerEnabled.checked };
  if (running) training = canTrain() ? { startBpm: settings.bpm, startBar: sched.bar } : null;
  saveSettings();
  renderTrainerStatus(lastBar < 0 ? 0 : lastBar);
});
for (const input of [els.trainerStep, els.trainerBars, els.trainerLimit]) {
  input.addEventListener('input', readTrainerInputs);
}

function isTextEntry(el) {
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
  return el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type);
}

document.addEventListener('keydown', (e) => {
  const action = keyAction(e);
  if (!action || isTextEntry(e.target)) return;
  const type = e.target.tagName === 'INPUT' ? e.target.type : '';
  if (action.type === 'bpm' && (type === 'range' || type === 'radio')) return; // setas nativas do controle
  if (action.type === 'toggle' && (type === 'checkbox' || type === 'radio')) return; // espaço marca a opção
  e.preventDefault();
  if (e.repeat && action.type !== 'bpm') return;
  if (action.type === 'toggle') toggle();
  else if (action.type === 'bpm') setBpm(settings.bpm + action.delta);
  else if (action.type === 'tap') doTap();
});
// Evita que o espaço "clique" o botão focado além de iniciar/parar.
document.addEventListener('keyup', (e) => {
  if ((e.key === ' ' || e.key === 'Spacebar') && e.target.tagName === 'BUTTON') e.preventDefault();
});
document.addEventListener('visibilitychange', () => {
  if (running && document.visibilityState === 'visible') requestWakeLock();
});

renderAll();
