const ui = {
  startButton: document.getElementById('start'),
  muteButton: document.getElementById('mute'),
  statusEl: document.getElementById('status'),
  subStatusEl: document.getElementById('subStatus'),
  statusDot: document.getElementById('statusDot'),
  meterOutgoing: document.getElementById('meterOutgoing'),
  meterIncoming: document.getElementById('meterIncoming'),
  transcriptEl: document.getElementById('transcript'),
  transcriptEmpty: document.getElementById('transcriptEmpty'),
  remoteAudio: document.getElementById('remoteAudio'),
};

const state = {
  pc: null,
  localStream: null,
  isMuted: false,
  isActive: false,
};

const audioState = {
  ctx: null,
  analyserOut: null,
  analyserIn: null,
  meterLoop: null,
};

console.log('[FRONTEND] Script loaded and initialized');

function setStatus(main, sub, tone = 'idle') {
  ui.statusEl.textContent = main;
  ui.subStatusEl.textContent = sub;
  const toneMap = { idle: 'var(--muted)', live: 'var(--accent)', error: '#ff9a8b' };
  ui.statusDot.style.background = toneMap[tone] || 'var(--muted)';
}

function appendTranscript(text, role = 'assistant') {
  if (ui.transcriptEmpty) ui.transcriptEmpty.remove();
  const line = document.createElement('div');
  line.className = 'line';
  line.textContent = (role === 'user' ? 'You: ' : 'Assistant: ') + text;
  ui.transcriptEl.appendChild(line);
  ui.transcriptEl.scrollTop = ui.transcriptEl.scrollHeight;
}

async function ensureAudioContext() {
  if (!audioState.ctx) {
    audioState.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioState.ctx.state === 'suspended') {
    await audioState.ctx.resume();
  }
}

function attachOutgoingAnalyser(stream) {
  audioState.analyserOut = audioState.ctx.createAnalyser();
  audioState.analyserOut.fftSize = 256;
  audioState.analyserOut.smoothingTimeConstant = 0.4;
  const outSource = audioState.ctx.createMediaStreamSource(stream);
  outSource.connect(audioState.analyserOut);
}

function attachIncomingAnalyser(stream) {
  if (!audioState.analyserIn) {
    audioState.analyserIn = audioState.ctx.createAnalyser();
    audioState.analyserIn.fftSize = 256;
    audioState.analyserIn.smoothingTimeConstant = 0.5;
  }
  const inSource = audioState.ctx.createMediaStreamSource(stream);
  inSource.connect(audioState.analyserIn);
}

async function startCall() {
  console.log('[FRONTEND] startCall() function invoked');
  try {
    ui.startButton.disabled = true;
    setStatus('Requesting microphone...', 'Grant access to begin', 'idle');

    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[FRONTEND] Microphone access granted, stream tracks:', state.localStream.getTracks().length);

    await ensureAudioContext();
    attachOutgoingAnalyser(state.localStream);

    setStatus('Connecting...', 'Opening bridge', 'idle');
    state.pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    console.log('[FRONTEND] RTCPeerConnection created');

    state.localStream.getTracks().forEach((track) => {
      console.log('[FRONTEND] Adding track to peer connection:', track.kind, track.label);
      state.pc.addTrack(track, state.localStream);
    });

    state.pc.ontrack = (event) => {
      console.log('[FRONTEND] ontrack event received!', event.track.kind);
      const remoteStream = event.streams?.[0] || new MediaStream([event.track]);
      ui.remoteAudio.srcObject = remoteStream;
      ui.remoteAudio.volume = 1.0;

      event.track.onunmute = () => console.log('[FRONTEND] ✅ Remote track UNMUTED - audio should now be audible!');

      attachIncomingAnalyser(remoteStream);

      ui.remoteAudio
        .play()
        .then(() => console.log('[FRONTEND] ✅ Remote audio playback started successfully'))
        .catch((err) => console.error('[FRONTEND] ❌ Failed to start audio playback:', err));

      startMeters();
    };

    state.pc.oniceconnectionstatechange = () => console.log('[FRONTEND] ICE connection state:', state.pc.iceConnectionState);
    state.pc.onconnectionstatechange = () => console.log('[FRONTEND] Connection state:', state.pc.connectionState);

    const offer = await state.pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    await state.pc.setLocalDescription(offer);

    setStatus('Signaling...', 'Syncing peers', 'idle');
    const res = await fetch('/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: offer.sdp }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[FRONTEND] Signaling failed:', data.error);
      throw new Error(data.error || 'Signaling failed');
    }

    await state.pc.setRemoteDescription({ type: 'answer', sdp: data.answer });
    setStatus('Connected', 'Speak freely.', 'live');
    state.isActive = true;
    ui.startButton.textContent = 'Stop';
    ui.startButton.classList.remove('primary');
    ui.startButton.classList.add('danger');
    ui.muteButton.disabled = false;
    console.log('[FRONTEND] ✅ WebRTC connection established successfully!');
  } catch (err) {
    console.error('[FRONTEND] Error during connection setup:', err);
    setStatus('Error', err.message || String(err), 'error');
    ui.startButton.disabled = false;
    state.isActive = false;
  }
}

function stopCall() {
  console.log('[FRONTEND] stopCall() invoked');
  state.isActive = false;
  stopMeters();
  if (state.pc) {
    state.pc.getSenders().forEach((sender) => sender.track?.stop());
    state.pc.close();
    state.pc = null;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }
  ui.startButton.textContent = 'Start';
  ui.startButton.classList.add('primary');
  ui.startButton.classList.remove('danger');
  ui.startButton.disabled = false;
  ui.muteButton.disabled = true;
  ui.muteButton.textContent = 'Mute';
  state.isMuted = false;
  setStatus('Idle', 'Ready when you are.', 'idle');
}

function toggleMute() {
  if (!state.localStream) return;
  state.isMuted = !state.isMuted;
  state.localStream.getAudioTracks().forEach((t) => (t.enabled = !state.isMuted));
  ui.muteButton.textContent = state.isMuted ? 'Unmute' : 'Mute';
  ui.subStatusEl.textContent = state.isMuted ? 'You are muted' : 'Speak freely — we are listening.';
}

function computeLevel(analyser) {
  if (!analyser) return 0;
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / data.length) / 255;
  return Math.min(1, rms * 1.8);
}

function renderMeter(el, level) {
  if (!el) return;
  const bars = el.querySelectorAll('span');
  const base = level * 16 + 3;
  bars.forEach((bar, idx) => {
    const jitter = (idx % 2 === 0 ? 1 : -1) * 2;
    const height = Math.max(3, Math.min(16, base + jitter));
    bar.style.height = `${height}px`;
  });
}

function meterTick() {
  const outLevel = computeLevel(audioState.analyserOut);
  const inLevel = computeLevel(audioState.analyserIn);
  renderMeter(ui.meterOutgoing, outLevel);
  renderMeter(ui.meterIncoming, inLevel);
  audioState.meterLoop = requestAnimationFrame(meterTick);
}

function startMeters() {
  stopMeters();
  audioState.meterLoop = requestAnimationFrame(meterTick);
}

function stopMeters() {
  if (audioState.meterLoop) cancelAnimationFrame(audioState.meterLoop);
  audioState.meterLoop = null;
  renderMeter(ui.meterOutgoing, 0);
  renderMeter(ui.meterIncoming, 0);
}

ui.startButton.addEventListener('click', () => {
  console.log('[FRONTEND] Start/Stop button clicked');
  if (!state.isActive) {
    void startCall();
  } else {
    stopCall();
  }
});

ui.muteButton.addEventListener('click', () => {
  console.log('[FRONTEND] Mute/Unmute toggled');
  toggleMute();
});

console.log('[FRONTEND] Event listeners attached');
