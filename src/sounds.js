// Sons sintetizados com Web Audio (nenhum arquivo de áudio).
import { soundParams } from './metronome-core.js';

function envelope(ctx, output, time, peak, decay, nodes) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(peak, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + decay);
  gain.connect(output);
  nodes.push(gain);
  return gain;
}

function tone(ctx, destination, time, type, frequency, stopAt, nodes, endFrequency) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, time);
  if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, stopAt);
  osc.connect(destination);
  osc.start(time);
  osc.stop(stopAt + 0.01);
  nodes.push(osc);
  return osc;
}

// Desconecta tudo quando o último oscilador terminar, para não acumular nós.
function cleanupAfter(osc, nodes) {
  osc.onended = () => {
    for (const node of nodes) node.disconnect();
  };
}

// Toca um pulso no instante `time` (relógio do AudioContext).
export function playTick(ctx, output, time, sound, level) {
  const { frequency, gain, decay } = soundParams(sound, level);
  const nodes = [];
  if (sound === 'beep') {
    const env = envelope(ctx, output, time, gain * 0.6, decay, nodes);
    cleanupAfter(tone(ctx, env, time, 'sine', frequency, time + decay, nodes), nodes);
    return;
  }
  if (sound === 'wood') {
    // Bloco de madeira: tom com queda rápida de afinação + parcial inarmônico curto.
    const knock = envelope(ctx, output, time, gain * 0.25, decay * 0.4, nodes);
    tone(ctx, knock, time, 'triangle', frequency * 2.6, time + decay * 0.4, nodes);
    const body = envelope(ctx, output, time, gain * 0.8, decay, nodes);
    cleanupAfter(tone(ctx, body, time, 'sine', frequency, time + decay, nodes, frequency * 0.7), nodes);
    return;
  }
  // Clique: pulso curto de onda quadrada, sem graves.
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 900;
  filter.connect(output);
  nodes.push(filter);
  const env = envelope(ctx, filter, time, gain * 0.35, decay, nodes);
  cleanupAfter(tone(ctx, env, time, 'square', frequency, time + decay, nodes), nodes);
}

// Volume de 0 a 100 em ganho, com curva quadrática (mais natural ao ouvido).
export function volumeToGain(volume) {
  const v = Math.min(100, Math.max(0, Number(volume) || 0)) / 100;
  return v * v;
}
