// Lógica pura do metrônomo: compassos, subdivisões, acentos, tap tempo,
// andamentos, treino progressivo e a matemática do agendamento. Sem DOM e sem áudio.

export const BPM_MIN = 30;
export const BPM_MAX = 300;
export const TIMER_INTERVAL_MS = 25; // de quanto em quanto tempo o agendador roda
export const LOOKAHEAD_S = 0.1; // quanto à frente as batidas são agendadas
export const MAX_LATENESS_S = 0.2; // atraso tolerado antes de pular batidas perdidas

// unit: figura que o BPM conta. 6/8 e 12/8 são compostos: cada tempo vale três colcheias.
// 7/8 é contado em colcheias, agrupadas 2+2+3.
export const SIGNATURES = {
  '2/4': { beats: 2, unit: 'quarter' },
  '3/4': { beats: 3, unit: 'quarter' },
  '4/4': { beats: 4, unit: 'quarter' },
  '5/4': { beats: 5, unit: 'quarter' },
  '6/8': { beats: 2, unit: 'dotted-quarter' },
  '7/8': { beats: 7, unit: 'eighth', groups: [2, 2, 3] },
  '12/8': { beats: 4, unit: 'dotted-quarter' },
};

export const UNIT_LABELS = {
  quarter: { symbol: '♩', name: 'semínima' },
  'dotted-quarter': { symbol: '♩.', name: 'semínima pontuada' },
  eighth: { symbol: '♪', name: 'colcheia' },
};

const SUBDIVISION_TABLE = {
  quarter: [
    { id: 'none', perBeat: 1, label: 'Nenhuma' },
    { id: 'eighths', perBeat: 2, label: 'Colcheias (2 por tempo)' },
    { id: 'triplets', perBeat: 3, label: 'Tercinas (3 por tempo)' },
    { id: 'sixteenths', perBeat: 4, label: 'Semicolcheias (4 por tempo)' },
  ],
  'dotted-quarter': [
    { id: 'none', perBeat: 1, label: 'Nenhuma (só os tempos)' },
    { id: 'eighths', perBeat: 3, label: 'Colcheias (3 por tempo)' },
    { id: 'sixteenths', perBeat: 6, label: 'Semicolcheias (6 por tempo)' },
  ],
  eighth: [
    { id: 'none', perBeat: 1, label: 'Nenhuma (só as colcheias)' },
    { id: 'sixteenths', perBeat: 2, label: 'Semicolcheias (2 por colcheia)' },
  ],
};

export const SUBDIVISION_IDS = ['none', 'eighths', 'triplets', 'sixteenths'];
export const SOUNDS = { click: 'Clique', beep: 'Bip', wood: 'Madeira' };

export const TEMPO_MARKINGS = [
  { name: 'Largo', min: BPM_MIN, max: 59, description: 'muito lento e amplo' },
  { name: 'Larghetto', min: 60, max: 65, description: 'lento, um pouco menos que o largo' },
  { name: 'Adagio', min: 66, max: 75, description: 'lento e expressivo' },
  { name: 'Andante', min: 76, max: 107, description: 'no passo de uma caminhada' },
  { name: 'Moderato', min: 108, max: 119, description: 'moderado' },
  { name: 'Allegro', min: 120, max: 155, description: 'rápido e animado' },
  { name: 'Vivace', min: 156, max: 175, description: 'vivo e rápido' },
  { name: 'Presto', min: 176, max: 199, description: 'muito rápido' },
  { name: 'Prestissimo', min: 200, max: BPM_MAX, description: 'o mais rápido possível' },
];

export const DEFAULT_SETTINGS = {
  bpm: 100,
  signature: '4/4',
  subdivision: 'none',
  accent: true,
  sound: 'click',
  volume: 80,
  trainer: { enabled: false, step: 5, everyBars: 4, limit: 140 },
};

export function clampBpm(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(n)));
}

export function getSignature(id) {
  return SIGNATURES[id] || SIGNATURES['4/4'];
}

export function subdivisionOptions(signature) {
  return SUBDIVISION_TABLE[getSignature(signature).unit];
}

// Garante uma subdivisão válida para o compasso (tercinas em compasso composto
// viram as colcheias naturais do tempo; o que não existe vira "nenhuma").
export function resolveSubdivision(signature, id) {
  const options = subdivisionOptions(signature);
  if (options.some((o) => o.id === id)) return id;
  if (id === 'triplets' && options.some((o) => o.id === 'eighths' && o.perBeat === 3)) return 'eighths';
  return 'none';
}

function groupStarts(sig) {
  if (!sig.groups) return null;
  const starts = new Set();
  let beat = 0;
  for (const size of sig.groups) {
    starts.add(beat);
    beat += size;
  }
  return starts;
}

/**
 * Padrão de um compasso: lista de pulsos com nível de acento.
 * Níveis: 'accent' (1º tempo), 'strong' (início de grupo no 7/8), 'beat' e 'sub' (subdivisão).
 */
export function buildPattern(signature, subdivision = 'none', accentFirst = true) {
  const sig = getSignature(signature);
  const subId = resolveSubdivision(signature, subdivision);
  const { perBeat } = subdivisionOptions(signature).find((o) => o.id === subId);
  const starts = groupStarts(sig);
  const ticks = [];
  for (let beat = 0; beat < sig.beats; beat++) {
    for (let sub = 0; sub < perBeat; sub++) {
      let level = 'beat';
      if (sub > 0) level = 'sub';
      else if (beat === 0 && accentFirst) level = 'accent';
      else if (starts && starts.has(beat)) level = 'strong';
      ticks.push({ beat, sub, level });
    }
  }
  return { signature: SIGNATURES[signature] ? signature : '4/4', subdivision: subId, beats: sig.beats, perBeat, ticks };
}

export function tickDuration(bpm, perBeat = 1) {
  return 60 / bpm / perBeat;
}

/**
 * Agenda os pulsos que caem antes de now + lookahead.
 * state: { nextTime, tickIndex, bar }, com nextTime em segundos do relógio de áudio.
 * getBpm(bar): BPM do compasso (permite o treino progressivo).
 */
export function scheduleTicks(state, now, pattern, getBpm, lookahead = LOOKAHEAD_S) {
  let { nextTime, tickIndex, bar } = state;
  if (nextTime < now - MAX_LATENESS_S) nextTime = now + 0.05; // aba ficou parada: não dispara uma rajada
  if (tickIndex >= pattern.ticks.length) {
    tickIndex = 0;
    bar += 1;
  }
  const notes = [];
  const horizon = now + lookahead;
  while (nextTime < horizon && notes.length < 1000) {
    const bpm = getBpm(bar);
    notes.push({ time: nextTime, tickIndex, bar, bpm, ...pattern.ticks[tickIndex] });
    nextTime += tickDuration(bpm, pattern.perBeat);
    tickIndex += 1;
    if (tickIndex >= pattern.ticks.length) {
      tickIndex = 0;
      bar += 1;
    }
  }
  return { notes, state: { nextTime, tickIndex, bar } };
}

export function createTapTempo({ resetMs = 2000, maxTaps = 8 } = {}) {
  let taps = [];
  return {
    tap(now) {
      const last = taps[taps.length - 1];
      if (last !== undefined && now - last > resetMs) taps = [];
      if (taps.length && now <= taps[taps.length - 1]) return bpmFromTaps(taps);
      taps.push(now);
      if (taps.length > maxTaps) taps.shift();
      return bpmFromTaps(taps);
    },
    reset() {
      taps = [];
    },
    get count() {
      return taps.length;
    },
  };
}

// Média dos intervalos entre toques (em ms) convertida em BPM.
export function bpmFromTaps(taps) {
  if (taps.length < 2) return null;
  const total = taps[taps.length - 1] - taps[0];
  return clampBpm(60000 / (total / (taps.length - 1)));
}

export function tempoMarking(bpm) {
  const value = clampBpm(bpm);
  if (value === null) return null;
  return TEMPO_MARKINGS.find((m) => value >= m.min && value <= m.max);
}

export function validateTrainer(input) {
  const step = Math.round(Number(input.step));
  const everyBars = Math.round(Number(input.everyBars));
  const limit = Math.round(Number(input.limit));
  const errors = [];
  if (!Number.isFinite(step) || step < 1 || step > 50) errors.push('O aumento deve ficar entre 1 e 50 BPM.');
  if (!Number.isFinite(everyBars) || everyBars < 1 || everyBars > 64) errors.push('O intervalo deve ficar entre 1 e 64 compassos.');
  if (!Number.isFinite(limit) || limit < BPM_MIN || limit > BPM_MAX) errors.push(`O limite deve ficar entre ${BPM_MIN} e ${BPM_MAX} BPM.`);
  return { ok: errors.length === 0, errors, value: { step, everyBars, limit } };
}

// BPM do treino no compasso `barsElapsed` (0 = primeiro compasso do treino).
export function trainerBpm(startBpm, trainer, barsElapsed) {
  const raised = startBpm + Math.floor(Math.max(0, barsElapsed) / trainer.everyBars) * trainer.step;
  return Math.max(startBpm, Math.min(trainer.limit, raised));
}

export function trainerStatus(startBpm, trainer, barsElapsed) {
  const bpm = trainerBpm(startBpm, trainer, barsElapsed);
  const done = bpm >= trainer.limit || startBpm >= trainer.limit;
  const nextIn = done ? null : trainer.everyBars - (Math.max(0, barsElapsed) % trainer.everyBars);
  return { bpm, done, nextIn };
}

// Atalhos de teclado: espaço, setas (Shift = 5 BPM) e T.
export function keyAction(event) {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const step = event.shiftKey ? 5 : 1;
  switch (event.key) {
    case ' ':
    case 'Spacebar':
      return { type: 'toggle' };
    case 'ArrowUp':
    case 'ArrowRight':
      return { type: 'bpm', delta: step };
    case 'ArrowDown':
    case 'ArrowLeft':
      return { type: 'bpm', delta: -step };
    case 't':
    case 'T':
      return { type: 'tap' };
    default:
      return null;
  }
}

// Frequência (Hz), ganho e duração (s) de cada som por nível de acento.
export function soundParams(sound, level) {
  const base = { click: 2000, beep: 880, wood: 1000 }[sound] || 2000;
  const decay = { click: 0.03, beep: 0.07, wood: 0.05 }[sound] || 0.03;
  const levels = {
    accent: { pitch: 1.5, gain: 1 },
    strong: { pitch: 1.25, gain: 0.85 },
    beat: { pitch: 1, gain: 0.7 },
    sub: { pitch: 0.8, gain: 0.38 },
  };
  const l = levels[level] || levels.beat;
  return { frequency: Math.round(base * l.pitch), gain: l.gain, decay };
}

// Lê configurações salvas com segurança, caindo nos padrões quando algo é inválido.
export function sanitizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const signature = SIGNATURES[s.signature] ? s.signature : DEFAULT_SETTINGS.signature;
  const subdivision = SUBDIVISION_IDS.includes(s.subdivision)
    ? resolveSubdivision(signature, s.subdivision)
    : DEFAULT_SETTINGS.subdivision;
  const volume = Number.isFinite(Number(s.volume)) && s.volume !== null && s.volume !== ''
    ? Math.min(100, Math.max(0, Math.round(Number(s.volume))))
    : DEFAULT_SETTINGS.volume;
  const t = s.trainer && typeof s.trainer === 'object' ? s.trainer : {};
  const checked = validateTrainer({ ...DEFAULT_SETTINGS.trainer, ...t });
  return {
    bpm: clampBpm(s.bpm) ?? DEFAULT_SETTINGS.bpm,
    signature,
    subdivision,
    accent: typeof s.accent === 'boolean' ? s.accent : DEFAULT_SETTINGS.accent,
    sound: SOUNDS[s.sound] ? s.sound : DEFAULT_SETTINGS.sound,
    volume,
    trainer: checked.ok
      ? { enabled: t.enabled === true, ...checked.value }
      : { ...DEFAULT_SETTINGS.trainer },
  };
}
