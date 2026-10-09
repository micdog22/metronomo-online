import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BPM_MIN, BPM_MAX, TIMER_INTERVAL_MS, LOOKAHEAD_S, TEMPO_MARKINGS, DEFAULT_SETTINGS,
  clampBpm, buildPattern, subdivisionOptions, resolveSubdivision, tickDuration, scheduleTicks,
  createTapTempo, bpmFromTaps, tempoMarking, validateTrainer, trainerBpm, trainerStatus,
  keyAction, soundParams, sanitizeSettings,
} from '../src/metronome-core.js';

const levels = (p) => p.ticks.map((t) => t.level);

test('limita o BPM entre 30 e 300', () => {
  assert.equal(clampBpm(29), 30);
  assert.equal(clampBpm(301), 300);
  assert.equal(clampBpm(120.4), 120);
  assert.equal(clampBpm('95'), 95);
  assert.equal(clampBpm('abc'), null);
  assert.equal(clampBpm(''), null);
  assert.equal(clampBpm(null), null);
  assert.equal(BPM_MIN, 30);
  assert.equal(BPM_MAX, 300);
});

test('compassos simples: um pulso por tempo e acento no 1', () => {
  assert.deepEqual(levels(buildPattern('2/4')), ['accent', 'beat']);
  assert.deepEqual(levels(buildPattern('3/4')), ['accent', 'beat', 'beat']);
  assert.deepEqual(levels(buildPattern('4/4')), ['accent', 'beat', 'beat', 'beat']);
  assert.deepEqual(levels(buildPattern('5/4')), ['accent', 'beat', 'beat', 'beat', 'beat']);
});

test('acento desligado deixa todos os tempos iguais', () => {
  assert.deepEqual(levels(buildPattern('4/4', 'none', false)), ['beat', 'beat', 'beat', 'beat']);
});

test('subdivisões em compassos simples', () => {
  const eighths = buildPattern('4/4', 'eighths');
  assert.equal(eighths.ticks.length, 8);
  assert.equal(eighths.perBeat, 2);
  assert.deepEqual(levels(eighths).slice(0, 4), ['accent', 'sub', 'beat', 'sub']);
  const triplets = buildPattern('3/4', 'triplets');
  assert.equal(triplets.ticks.length, 9);
  assert.deepEqual(levels(triplets), ['accent', 'sub', 'sub', 'beat', 'sub', 'sub', 'beat', 'sub', 'sub']);
  const sixteenths = buildPattern('2/4', 'sixteenths');
  assert.equal(sixteenths.ticks.length, 8);
  assert.deepEqual(sixteenths.ticks.map((t) => t.beat), [0, 0, 0, 0, 1, 1, 1, 1]);
});

test('6/8 e 12/8 são compostos: tempos de três colcheias', () => {
  const six = buildPattern('6/8', 'eighths');
  assert.equal(six.beats, 2);
  assert.equal(six.perBeat, 3);
  assert.deepEqual(levels(six), ['accent', 'sub', 'sub', 'beat', 'sub', 'sub']);
  const twelve = buildPattern('12/8', 'eighths');
  assert.equal(twelve.ticks.length, 12);
  const beatStarts = twelve.ticks.map((t, i) => (t.sub === 0 ? i : null)).filter((i) => i !== null);
  assert.deepEqual(beatStarts, [0, 3, 6, 9]);
  assert.deepEqual(levels(buildPattern('6/8', 'none')), ['accent', 'beat']);
  assert.equal(buildPattern('6/8', 'sixteenths').ticks.length, 12);
});

test('7/8 agrupado em 2+2+3', () => {
  assert.deepEqual(levels(buildPattern('7/8')), ['accent', 'beat', 'strong', 'beat', 'strong', 'beat', 'beat']);
  assert.deepEqual(levels(buildPattern('7/8', 'none', false)), ['strong', 'beat', 'strong', 'beat', 'strong', 'beat', 'beat']);
  assert.equal(buildPattern('7/8', 'sixteenths').ticks.length, 14);
});

test('opções de subdivisão dependem do compasso', () => {
  assert.deepEqual(subdivisionOptions('4/4').map((o) => o.id), ['none', 'eighths', 'triplets', 'sixteenths']);
  assert.deepEqual(subdivisionOptions('6/8').map((o) => o.id), ['none', 'eighths', 'sixteenths']);
  assert.deepEqual(subdivisionOptions('7/8').map((o) => o.id), ['none', 'sixteenths']);
  assert.equal(resolveSubdivision('6/8', 'triplets'), 'eighths');
  assert.equal(resolveSubdivision('7/8', 'eighths'), 'none');
  assert.equal(resolveSubdivision('7/8', 'triplets'), 'none');
  assert.equal(resolveSubdivision('4/4', 'triplets'), 'triplets');
  assert.equal(resolveSubdivision('4/4', 'qualquer'), 'none');
  assert.equal(buildPattern('9/9').signature, '4/4');
});

test('tap tempo faz a média dos toques recentes', () => {
  const tap = createTapTempo();
  assert.equal(tap.tap(0), null);
  assert.equal(tap.tap(500), 120);
  assert.equal(tap.tap(1000), 120);
  // Toques irregulares: média de 500, 600 e 400 ms = 500 ms.
  const t2 = createTapTempo();
  [0, 500, 1100, 1500].forEach((ms, i) => {
    const bpm = t2.tap(ms);
    if (i === 3) assert.equal(bpm, 120);
  });
  assert.equal(bpmFromTaps([0, 1000]), 60);
  assert.equal(bpmFromTaps([0, 100]), 300); // limitado ao máximo
  assert.equal(bpmFromTaps([0, 5000]), 30); // limitado ao mínimo
});

test('tap tempo recomeça depois de 2 s parado', () => {
  const tap = createTapTempo();
  tap.tap(0);
  tap.tap(1000);
  assert.equal(tap.count, 2);
  assert.equal(tap.tap(3001), null); // passou de 2 s: recomeça a contagem
  assert.equal(tap.count, 1);
  assert.equal(tap.tap(3501), 120);
  // Exatamente 2 s ainda conta.
  const t2 = createTapTempo();
  t2.tap(0);
  assert.equal(t2.tap(2000), 30);
});

test('tap tempo usa só os toques mais recentes', () => {
  const tap = createTapTempo({ maxTaps: 4 });
  // Começa lento (1 s) e acelera (0,5 s): a janela de 4 toques esquece o início.
  [0, 1000, 2000, 2500, 3000, 3500].forEach((ms) => tap.tap(ms));
  assert.equal(tap.count, 4);
  assert.equal(tap.tap(4000), 120);
  // Toque repetido no mesmo instante é ignorado.
  assert.equal(tap.tap(4000), 120);
  tap.reset();
  assert.equal(tap.count, 0);
});

test('andamentos italianos por faixa de BPM', () => {
  const cases = [
    [30, 'Largo'], [59, 'Largo'], [60, 'Larghetto'], [65, 'Larghetto'], [66, 'Adagio'],
    [75, 'Adagio'], [76, 'Andante'], [107, 'Andante'], [108, 'Moderato'], [119, 'Moderato'],
    [120, 'Allegro'], [155, 'Allegro'], [156, 'Vivace'], [175, 'Vivace'], [176, 'Presto'],
    [199, 'Presto'], [200, 'Prestissimo'], [300, 'Prestissimo'],
  ];
  for (const [bpm, name] of cases) assert.equal(tempoMarking(bpm).name, name, `${bpm} BPM`);
  // Cada BPM possível cai em exatamente uma faixa.
  for (let bpm = BPM_MIN; bpm <= BPM_MAX; bpm++) {
    assert.equal(TEMPO_MARKINGS.filter((m) => bpm >= m.min && bpm <= m.max).length, 1, `${bpm} BPM`);
  }
  assert.equal(tempoMarking('x'), null);
});

test('treino progressivo sobe X BPM a cada N compassos até o limite', () => {
  const trainer = { step: 5, everyBars: 4, limit: 120 };
  assert.equal(trainerBpm(100, trainer, 0), 100);
  assert.equal(trainerBpm(100, trainer, 3), 100);
  assert.equal(trainerBpm(100, trainer, 4), 105);
  assert.equal(trainerBpm(100, trainer, 8), 110);
  assert.equal(trainerBpm(100, trainer, 16), 120);
  assert.equal(trainerBpm(100, trainer, 400), 120);
  // Limite que não cai num múltiplo do passo.
  assert.equal(trainerBpm(100, { step: 7, everyBars: 1, limit: 110 }, 2), 110);
  // Limite abaixo do início não diminui o andamento.
  assert.equal(trainerBpm(150, trainer, 8), 150);
});

test('situação do treino: próximo aumento e fim', () => {
  const trainer = { step: 5, everyBars: 4, limit: 110 };
  assert.deepEqual(trainerStatus(100, trainer, 0), { bpm: 100, done: false, nextIn: 4 });
  assert.deepEqual(trainerStatus(100, trainer, 3), { bpm: 100, done: false, nextIn: 1 });
  assert.deepEqual(trainerStatus(100, trainer, 5), { bpm: 105, done: false, nextIn: 3 });
  assert.deepEqual(trainerStatus(100, trainer, 8), { bpm: 110, done: true, nextIn: null });
});

test('valida o treino com mensagens claras', () => {
  assert.equal(validateTrainer({ step: 5, everyBars: 4, limit: 140 }).ok, true);
  const bad = validateTrainer({ step: 0, everyBars: 'x', limit: 400 });
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 3);
  assert.match(bad.errors[0], /aumento/);
});

test('duração dos pulsos', () => {
  assert.equal(tickDuration(60), 1);
  assert.equal(tickDuration(120), 0.5);
  assert.equal(tickDuration(120, 2), 0.25);
  assert.ok(Math.abs(tickDuration(90, 3) - 2 / 9) < 1e-12);
});

test('agendador: pulsos espaçados pelo BPM até o horizonte', () => {
  const pattern = buildPattern('4/4');
  const { notes, state } = scheduleTicks({ nextTime: 0, tickIndex: 0, bar: 0 }, 0, pattern, () => 120, 2);
  assert.deepEqual(notes.map((n) => n.time), [0, 0.5, 1, 1.5]);
  assert.deepEqual(notes.map((n) => n.level), ['accent', 'beat', 'beat', 'beat']);
  assert.deepEqual(state, { nextTime: 2, tickIndex: 0, bar: 1 });
  // Só agenda o que cai dentro da janela de 100 ms.
  const step = scheduleTicks({ nextTime: 2, tickIndex: 0, bar: 1 }, 1.95, pattern, () => 120);
  assert.equal(step.notes.length, 1);
  assert.equal(step.notes[0].bar, 1);
  const none = scheduleTicks(step.state, 2.0, pattern, () => 120);
  assert.equal(none.notes.length, 0);
});

test('agendador: subdivisões e compassos compostos', () => {
  const pattern = buildPattern('6/8', 'eighths');
  const { notes } = scheduleTicks({ nextTime: 0, tickIndex: 0, bar: 0 }, 0, pattern, () => 60, 1);
  assert.equal(notes.length, 3);
  assert.ok(Math.abs(notes[1].time - 1 / 3) < 1e-9);
  assert.deepEqual(notes.map((n) => n.level), ['accent', 'sub', 'sub']);
});

test('agendador: andamento muda na virada do compasso', () => {
  const pattern = buildPattern('2/4');
  const getBpm = (bar) => trainerBpm(60, { step: 60, everyBars: 1, limit: 240 }, bar);
  const { notes } = scheduleTicks({ nextTime: 0, tickIndex: 0, bar: 0 }, 0, pattern, getBpm, 3.2);
  // Compasso 0 a 60 BPM (1 s por tempo), compasso 1 a 120 BPM (0,5 s).
  assert.deepEqual(notes.map((n) => n.time), [0, 1, 2, 2.5, 3]);
  assert.deepEqual(notes.map((n) => n.bpm), [60, 60, 120, 120, 180]);
});

test('agendador: pula batidas perdidas e recomeça o compasso se o padrão encolheu', () => {
  const pattern = buildPattern('3/4');
  const late = scheduleTicks({ nextTime: 1, tickIndex: 1, bar: 0 }, 10, pattern, () => 120);
  assert.equal(late.notes.length, 1);
  assert.ok(Math.abs(late.notes[0].time - 10.05) < 1e-9);
  const shrunk = scheduleTicks({ nextTime: 0, tickIndex: 7, bar: 2 }, 0, pattern, () => 120);
  assert.equal(shrunk.notes[0].tickIndex, 0);
  assert.equal(shrunk.notes[0].bar, 3);
  assert.equal(TIMER_INTERVAL_MS, 25);
  assert.equal(LOOKAHEAD_S, 0.1);
});

test('atalhos de teclado', () => {
  assert.deepEqual(keyAction({ key: ' ' }), { type: 'toggle' });
  assert.deepEqual(keyAction({ key: 'ArrowUp' }), { type: 'bpm', delta: 1 });
  assert.deepEqual(keyAction({ key: 'ArrowRight', shiftKey: true }), { type: 'bpm', delta: 5 });
  assert.deepEqual(keyAction({ key: 'ArrowDown' }), { type: 'bpm', delta: -1 });
  assert.deepEqual(keyAction({ key: 'ArrowLeft', shiftKey: true }), { type: 'bpm', delta: -5 });
  assert.deepEqual(keyAction({ key: 't' }), { type: 'tap' });
  assert.deepEqual(keyAction({ key: 'T', shiftKey: true }), { type: 'tap' });
  assert.equal(keyAction({ key: 't', ctrlKey: true }), null);
  assert.equal(keyAction({ key: 'a' }), null);
});

test('parâmetros dos sons por nível de acento', () => {
  for (const sound of ['click', 'beep', 'wood']) {
    const accent = soundParams(sound, 'accent');
    const beat = soundParams(sound, 'beat');
    const sub = soundParams(sound, 'sub');
    assert.ok(accent.frequency > beat.frequency && beat.frequency > sub.frequency, sound);
    assert.ok(accent.gain > beat.gain && beat.gain > sub.gain, sound);
    assert.ok(beat.decay > 0 && beat.decay < 0.2, sound);
  }
});

test('configurações salvas são validadas', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings('lixo'), DEFAULT_SETTINGS);
  const s = sanitizeSettings({
    bpm: 999, signature: '6/8', subdivision: 'triplets', accent: false, sound: 'wood', volume: 150,
    trainer: { enabled: true, step: 2, everyBars: 8, limit: 180 },
  });
  assert.deepEqual(s, {
    bpm: 300, signature: '6/8', subdivision: 'eighths', accent: false, sound: 'wood', volume: 100,
    trainer: { enabled: true, step: 2, everyBars: 8, limit: 180 },
  });
  const bad = sanitizeSettings({ bpm: null, signature: '9/8', sound: 'sino', volume: 'x', trainer: { step: -1 } });
  assert.equal(bad.bpm, DEFAULT_SETTINGS.bpm);
  assert.equal(bad.signature, '4/4');
  assert.equal(bad.sound, 'click');
  assert.equal(bad.volume, DEFAULT_SETTINGS.volume);
  assert.deepEqual(bad.trainer, DEFAULT_SETTINGS.trainer);
});
