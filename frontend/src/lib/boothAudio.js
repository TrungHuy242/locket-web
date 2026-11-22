// Lightweight Web Audio feedback for Photobooth countdown ticks and shutter click (no audio files needed).
let audioCtx = null;

function ctx() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function playBeep(final = false) {
  try {
    const ac = ctx();
    if (!ac) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(final ? 1046 : 660, now);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(final ? 0.16 : 0.1, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + (final ? 0.18 : 0.1));
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(now);
    osc.stop(now + (final ? 0.2 : 0.12));
  } catch { /* ignore blocked audio */ }
}

export function playShutter() {
  try {
    const ac = ctx();
    if (!ac) return;
    const now = ac.currentTime;
    const len = Math.floor(ac.sampleRate * 0.065);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.24));
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1900, now);
    filter.Q.setValueAtTime(1.1, now);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ac.destination);
    src.start(now);
  } catch { /* ignore */ }
}
