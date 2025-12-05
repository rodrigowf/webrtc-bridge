const ui = {
  muteButton: document.getElementById('mute'),
  muteAIButton: document.getElementById('muteAI'),
  statusEl: document.getElementById('status'),
  subStatusEl: document.getElementById('subStatus'),
  statusDot: document.getElementById('statusDot'),
  meterOutgoing: document.getElementById('meterOutgoing'),
  meterIncoming: document.getElementById('meterIncoming'),
  transcriptEl: document.getElementById('transcript'),
  transcriptEmpty: document.getElementById('transcriptEmpty'),
  remoteAudio: document.getElementById('remoteAudio'),
  codexOutput: document.getElementById('codexOutput'),
  codexEmpty: document.getElementById('codexEmpty'),
  codexStatus: document.getElementById('codexStatus'),
  claudeOutput: document.getElementById('claudeOutput'),
  claudeEmpty: document.getElementById('claudeEmpty'),
  claudeStatus: document.getElementById('claudeStatus'),
  tabButtons: document.querySelectorAll('.tab-btn'),
  tabTranscript: document.getElementById('tabTranscript'),
  tabCodex: document.getElementById('tabCodex'),
  tabClaude: document.getElementById('tabClaude'),
};

const state = {
  pc: null,
  localStream: null,
  connectionId: null, // Track our connection ID for multi-frontend support
  isMuted: true, // Start muted
  isAIMuted: true, // Start with AI muted
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
  console.log('[FRONTEND] startCall() function invoked - auto-connecting');
  try {
    setStatus('Requesting microphone...', 'Grant access to begin', 'idle');

    state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[FRONTEND] Microphone access granted, stream tracks:', state.localStream.getTracks().length);

    // Start with mic muted
    state.localStream.getAudioTracks().forEach((t) => (t.enabled = false));

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
      // Start with AI muted
      ui.remoteAudio.muted = true;

      event.track.onunmute = () => console.log('[FRONTEND] ✅ Remote track UNMUTED - audio should now be audible!');

      attachIncomingAnalyser(remoteStream);

      ui.remoteAudio
        .play()
        .then(() => console.log('[FRONTEND] ✅ Remote audio playback started successfully (muted)'))
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

    // Store connection ID for multi-frontend support
    state.connectionId = data.connectionId;
    console.log('[FRONTEND] Connection ID:', state.connectionId);

    await state.pc.setRemoteDescription({ type: 'answer', sdp: data.answer });
    setStatus('Connected', 'Both mic and AI are muted. Click to unmute.', 'live');
    state.isActive = true;
    ui.muteButton.disabled = false;
    ui.muteAIButton.disabled = false;
    console.log('[FRONTEND] ✅ WebRTC connection established successfully (starting muted)!');
  } catch (err) {
    console.error('[FRONTEND] Error during connection setup:', err);
    setStatus('Error', err.message || String(err), 'error');
    state.isActive = false;
  }
}

function cleanup() {
  console.log('[FRONTEND] cleanup() invoked');
  state.isActive = false;
  stopMeters();

  // Notify backend to cleanup this connection
  if (state.connectionId) {
    console.log('[FRONTEND] Notifying backend of disconnect:', state.connectionId);
    fetch('/disconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectionId: state.connectionId }),
    }).catch((err) => console.error('[FRONTEND] Error notifying disconnect:', err));
    state.connectionId = null;
  }

  if (state.pc) {
    state.pc.getSenders().forEach((sender) => sender.track?.stop());
    state.pc.close();
    state.pc = null;
  }
  if (state.localStream) {
    state.localStream.getTracks().forEach((t) => t.stop());
    state.localStream = null;
  }
}

function toggleMute() {
  if (!state.localStream) return;
  state.isMuted = !state.isMuted;
  state.localStream.getAudioTracks().forEach((t) => (t.enabled = !state.isMuted));
  ui.muteButton.classList.toggle('muted', state.isMuted);
  updateStatusText();
}

function toggleAIMute() {
  state.isAIMuted = !state.isAIMuted;
  // Mute/unmute the remote audio element
  ui.remoteAudio.muted = state.isAIMuted;
  ui.muteAIButton.classList.toggle('muted', state.isAIMuted);
  updateStatusText();
}

function updateStatusText() {
  if (state.isMuted && state.isAIMuted) {
    ui.subStatusEl.textContent = 'Both mic and AI are muted. Click to unmute.';
  } else if (state.isMuted) {
    ui.subStatusEl.textContent = 'Your mic is muted';
  } else if (state.isAIMuted) {
    ui.subStatusEl.textContent = 'AI audio is muted';
  } else {
    ui.subStatusEl.textContent = 'Speak freely — we are listening.';
  }
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
  const base = level * 14 + 4;
  bars.forEach((bar, idx) => {
    const jitter = (idx % 2 === 0 ? 1 : -1) * 2;
    const height = Math.max(4, Math.min(18, base + jitter));
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

ui.muteButton.addEventListener('click', () => {
  console.log('[FRONTEND] Mute/Unmute toggled');
  toggleMute();
});

ui.muteAIButton.addEventListener('click', () => {
  console.log('[FRONTEND] Mute AI toggled');
  toggleAIMute();
});

// Notify backend when page is closed/refreshed
window.addEventListener('beforeunload', () => {
  if (state.connectionId) {
    // Use sendBeacon for reliable delivery during unload
    navigator.sendBeacon('/disconnect', JSON.stringify({ connectionId: state.connectionId }));
  }
});

// Auto-connect on page load
console.log('[FRONTEND] Auto-connecting on page load...');
void startCall();

console.log('[FRONTEND] Event listeners attached');

// --- Codex SSE Event Stream ---
let codexEventSource = null;

function connectCodexEvents() {
  if (codexEventSource) {
    codexEventSource.close();
  }

  console.log('[FRONTEND] Connecting to Codex SSE stream...');
  codexEventSource = new EventSource('/codex/events');

  codexEventSource.onopen = () => {
    console.log('[FRONTEND] Codex SSE connected');
    setCodexStatus('connected', 'Listening for Codex events...');
  };

  codexEventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log('[FRONTEND] Codex event:', data.type, data);
      handleCodexEvent(data);
    } catch (err) {
      console.error('[FRONTEND] Failed to parse Codex event:', err);
    }
  };

  codexEventSource.onerror = (err) => {
    console.error('[FRONTEND] Codex SSE error:', err);
    setCodexStatus('error', 'Connection lost. Reconnecting...');
  };
}

function setCodexStatus(state, text) {
  if (!ui.codexStatus) return;
  ui.codexStatus.textContent = text;
  ui.codexStatus.className = 'tab-status ' + state;
}

function handleCodexEvent(data) {
  if (data.type === 'connected') {
    setCodexStatus('connected', 'Codex');
    setClaudeStatus('connected', 'Claude');
    return;
  }

  // Handle Claude-specific events (they have source: 'claude')
  if (data.source === 'claude') {
    handleClaudeEvent(data);
    return;
  }

  if (data.type === 'thread_reset') {
    clearCodexOutput();
    setCodexStatus('idle', 'Reset');
    return;
  }

  if (data.type === 'turn_aborted') {
    appendCodexLine('⚠️ Aborted: ' + (data.payload?.reason || 'cancelled'), 'warning');
    setCodexStatus('idle', 'Aborted');
    return;
  }

  if (data.type === 'turn_error') {
    appendCodexLine('❌ Error: ' + (data.payload?.message || 'unknown error'), 'error');
    setCodexStatus('error', 'Error');
    return;
  }

  if (data.type === 'thread_event') {
    handleThreadEvent(data.payload);
    return;
  }

  // Handle transcript events
  if (data.type === 'transcript_delta' || data.type === 'transcript_done') {
    handleTranscriptEvent(data);
    return;
  }

  if (data.type === 'user_transcript_done') {
    handleTranscriptEvent(data);
    return;
  }
}

// --- Claude Event Handling ---
function setClaudeStatus(state, text) {
  if (!ui.claudeStatus) return;
  ui.claudeStatus.textContent = text;
  ui.claudeStatus.className = 'tab-status ' + state;
}

function handleClaudeEvent(data) {
  if (data.type === 'session_started') {
    setClaudeStatus('running', 'Running...');
    appendClaudeLine('🚀 Session started: ' + (data.payload?.session_id || '...'), 'info');
    return;
  }

  if (data.type === 'session_completed') {
    setClaudeStatus('connected', 'Ready');
    return;
  }

  if (data.type === 'session_reset') {
    clearClaudeOutput();
    setClaudeStatus('idle', 'Reset');
    return;
  }

  if (data.type === 'turn_aborted') {
    appendClaudeLine('⚠️ Aborted: ' + (data.payload?.reason || 'cancelled'), 'warning');
    setClaudeStatus('idle', 'Aborted');
    return;
  }

  if (data.type === 'turn_error') {
    appendClaudeLine('❌ Error: ' + (data.payload?.message || 'unknown error'), 'error');
    setClaudeStatus('error', 'Error');
    return;
  }

  if (data.type === 'message') {
    handleClaudeMessage(data.payload);
    return;
  }
}

let currentClaudeStreamingEl = null;

function handleClaudeMessage(message) {
  if (!message) return;

  switch (message.type) {
    case 'user':
      // User message - show the prompt
      const userText = message.message?.content?.[0]?.text || '';
      if (userText) {
        appendClaudeLine('👤 ' + userText.slice(0, 200) + (userText.length > 200 ? '...' : ''), 'info');
      }
      break;

    case 'assistant':
      // Assistant message with content blocks
      setClaudeStatus('running', 'Thinking...');
      const content = message.message?.content || [];
      for (const block of content) {
        if (block.type === 'text') {
          finalizeClaudeStreamingMessage(block.text);
        } else if (block.type === 'tool_use') {
          appendClaudeLine('⚙️ Tool: ' + block.name, 'function');
          if (block.input) {
            const inputStr = typeof block.input === 'string' ? block.input : JSON.stringify(block.input);
            if (inputStr.length > 100) {
              appendClaudeLine('📥 ' + inputStr.slice(0, 100) + '...', 'output', '📥 ' + inputStr);
            }
          }
        }
      }
      break;

    case 'result':
      // Final result
      setClaudeStatus('connected', 'Ready');
      if (message.result) {
        const resultText = typeof message.result === 'string' ? message.result : JSON.stringify(message.result);
        if (resultText.length > 300) {
          appendClaudeLine('✅ ' + resultText.slice(0, 300) + '...', 'success', '✅ ' + resultText);
        } else {
          appendClaudeLine('✅ ' + resultText, 'success');
        }
      }
      break;

    default:
      console.log('[FRONTEND] Unhandled Claude message type:', message.type, message);
  }
}

function updateClaudeStreamingMessage(text) {
  if (!currentClaudeStreamingEl) {
    currentClaudeStreamingEl = document.createElement('div');
    currentClaudeStreamingEl.className = 'codex-line streaming agent';
    if (ui.claudeEmpty) ui.claudeEmpty.remove();
    ui.claudeOutput.appendChild(currentClaudeStreamingEl);
  }
  currentClaudeStreamingEl.textContent = '💭 ' + text;
  ui.claudeOutput.scrollTop = ui.claudeOutput.scrollHeight;
}

function finalizeClaudeStreamingMessage(text) {
  if (currentClaudeStreamingEl) {
    currentClaudeStreamingEl.classList.remove('streaming');
    currentClaudeStreamingEl = null;
  }

  const truncateAt = 300;
  if (text.length > truncateAt) {
    const truncated = '🤖 ' + text.slice(0, truncateAt) + '...';
    const full = '🤖 ' + text;
    appendClaudeLine(truncated, 'agent', full);
  } else {
    appendClaudeLine('🤖 ' + text, 'agent');
  }
}

function appendClaudeLine(text, type = 'info', fullText = null) {
  if (!ui.claudeOutput) return;
  if (ui.claudeEmpty) ui.claudeEmpty.remove();

  // Finalize any streaming element first
  if (currentClaudeStreamingEl) {
    currentClaudeStreamingEl.classList.remove('streaming');
    currentClaudeStreamingEl = null;
  }

  const line = document.createElement('div');
  line.className = 'codex-line ' + type;
  line.textContent = text;

  // If fullText is provided and different from text, make it expandable
  if (fullText && fullText !== text) {
    line.classList.add('expandable');
    line.dataset.truncated = text;
    line.dataset.full = fullText;
    line.dataset.expanded = 'false';
    line.addEventListener('click', () => {
      const isExpanded = line.dataset.expanded === 'true';
      if (isExpanded) {
        line.textContent = line.dataset.truncated;
        line.dataset.expanded = 'false';
        line.classList.remove('expanded');
      } else {
        line.textContent = line.dataset.full;
        line.dataset.expanded = 'true';
        line.classList.add('expanded');
      }
    });
  }

  ui.claudeOutput.appendChild(line);
  ui.claudeOutput.scrollTop = ui.claudeOutput.scrollHeight;
}

function clearClaudeOutput() {
  if (!ui.claudeOutput) return;
  ui.claudeOutput.innerHTML = '<div class="codex-line empty" id="claudeEmpty">Waiting for Claude activity...</div>';
  currentClaudeStreamingEl = null;
}

// Transcript handling
let currentTranscriptEl = null;
let currentTranscriptRole = null;

function handleTranscriptEvent(data) {
  const { type, text, role } = data;

  if (type === 'transcript_delta') {
    // Streaming assistant transcript
    if (!currentTranscriptEl || currentTranscriptRole !== role) {
      if (ui.transcriptEmpty) ui.transcriptEmpty.remove();
      currentTranscriptEl = document.createElement('div');
      currentTranscriptEl.className = 'line streaming';
      currentTranscriptEl.textContent = 'Assistant: ';
      ui.transcriptEl.appendChild(currentTranscriptEl);
      currentTranscriptRole = role;
    }
    currentTranscriptEl.textContent += text;
    ui.transcriptEl.scrollTop = ui.transcriptEl.scrollHeight;
  } else if (type === 'transcript_done') {
    // Final assistant transcript
    if (currentTranscriptEl && currentTranscriptRole === 'assistant') {
      currentTranscriptEl.classList.remove('streaming');
      currentTranscriptEl.textContent = 'Assistant: ' + text;
    } else {
      appendTranscript(text, 'assistant');
    }
    currentTranscriptEl = null;
    currentTranscriptRole = null;
  } else if (type === 'user_transcript_done') {
    // User's speech transcribed
    appendTranscript(text, 'user');
    currentTranscriptEl = null;
    currentTranscriptRole = null;
  }
}

function handleThreadEvent(event) {
  if (!event) return;

  switch (event.type) {
    case 'thread.started':
      setCodexStatus('running', 'Thread: ' + (event.thread_id || '...').slice(0, 12));
      appendCodexLine('🚀 Thread started', 'info');
      break;

    case 'turn.started':
      setCodexStatus('running', 'Processing...');
      break;

    case 'turn.completed':
      setCodexStatus('connected', 'Ready');
      break;

    case 'item.started':
      if (event.item?.type === 'function_call') {
        appendCodexLine('⚙️ Calling: ' + (event.item.name || 'function'), 'function');
      } else if (event.item?.type === 'agent_message') {
        setCodexStatus('running', 'Agent thinking...');
      } else if (event.item?.type === 'command_execution') {
        const cmd = event.item.command || 'command';
        appendCodexLine('💻 Running: ' + cmd, 'function');
      }
      break;

    case 'item.streaming':
      // Update streaming content
      if (event.item?.type === 'agent_message' && event.item.text) {
        updateStreamingMessage(event.item.text);
      } else if (event.item?.type === 'function_call') {
        updateStreamingFunction(event.item);
      }
      break;

    case 'item.completed':
      if (event.item?.type === 'agent_message') {
        finalizeStreamingMessage(event.item.text || '');
        setCodexStatus('connected', 'Ready');
      } else if (event.item?.type === 'function_call') {
        appendCodexLine('✅ ' + (event.item.name || 'function') + ' completed', 'success');
      } else if (event.item?.type === 'function_call_output') {
        const output = event.item.output || '';
        if (output.length > 200) {
          appendCodexLine('📤 Output: ' + output.slice(0, 200) + '...', 'output', '📤 Output: ' + output);
        } else if (output) {
          appendCodexLine('📤 Output: ' + output, 'output');
        }
      } else if (event.item?.type === 'reasoning') {
        const text = event.item.text || '';
        if (text) {
          const truncated = '💭 ' + text.slice(0, 200) + (text.length > 200 ? '...' : '');
          const full = '💭 ' + text;
          appendCodexLine(truncated, 'agent', text.length > 200 ? full : null);
        }
      } else if (event.item?.type === 'command_execution') {
        const cmd = event.item.command || 'command';
        const output = event.item.aggregated_output || '';
        const exitCode = event.item.exit_code;
        const status = exitCode === 0 ? 'success' : (exitCode === null ? 'info' : 'error');
        appendCodexLine('✅ ' + cmd, status);
        if (output) {
          const truncated = output.length > 300 ? '📤 ' + output.slice(0, 300) + '...' : '📤 ' + output;
          const full = '📤 ' + output;
          appendCodexLine(truncated, 'output', output.length > 300 ? full : null);
        }
      }
      break;

    default:
      // Log other events for debugging
      console.log('[FRONTEND] Unhandled thread event:', event.type, event);
  }
}

let currentStreamingEl = null;

function updateStreamingMessage(text) {
  if (!currentStreamingEl) {
    currentStreamingEl = document.createElement('div');
    currentStreamingEl.className = 'codex-line streaming agent';
    if (ui.codexEmpty) ui.codexEmpty.remove();
    ui.codexOutput.appendChild(currentStreamingEl);
  }
  currentStreamingEl.textContent = '💭 ' + text;
  ui.codexOutput.scrollTop = ui.codexOutput.scrollHeight;
}

function updateStreamingFunction(item) {
  if (!currentStreamingEl || !currentStreamingEl.classList.contains('function-stream')) {
    currentStreamingEl = document.createElement('div');
    currentStreamingEl.className = 'codex-line streaming function-stream';
    if (ui.codexEmpty) ui.codexEmpty.remove();
    ui.codexOutput.appendChild(currentStreamingEl);
  }
  let display = '⚙️ ' + (item.name || 'function');
  if (item.arguments) {
    try {
      const args = typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments);
      if (args.length > 100) {
        display += ': ' + args.slice(0, 100) + '...';
      } else {
        display += ': ' + args;
      }
    } catch (e) {
      // ignore
    }
  }
  currentStreamingEl.textContent = display;
  ui.codexOutput.scrollTop = ui.codexOutput.scrollHeight;
}

function finalizeStreamingMessage(text) {
  if (currentStreamingEl) {
    currentStreamingEl.classList.remove('streaming');
    const truncateAt = 300;
    if (text.length > truncateAt) {
      const truncated = '🤖 ' + text.slice(0, truncateAt) + '...';
      const full = '🤖 ' + text;
      currentStreamingEl.textContent = truncated;
      currentStreamingEl.classList.add('expandable');
      currentStreamingEl.dataset.truncated = truncated;
      currentStreamingEl.dataset.full = full;
      currentStreamingEl.dataset.expanded = 'false';
      currentStreamingEl.addEventListener('click', function handler() {
        const isExpanded = this.dataset.expanded === 'true';
        if (isExpanded) {
          this.textContent = this.dataset.truncated;
          this.dataset.expanded = 'false';
          this.classList.remove('expanded');
        } else {
          this.textContent = this.dataset.full;
          this.dataset.expanded = 'true';
          this.classList.add('expanded');
        }
      });
    } else {
      currentStreamingEl.textContent = '🤖 ' + text;
    }
  }
  currentStreamingEl = null;
}

function appendCodexLine(text, type = 'info', fullText = null) {
  if (!ui.codexOutput) return;
  if (ui.codexEmpty) ui.codexEmpty.remove();

  // Finalize any streaming element first
  if (currentStreamingEl) {
    currentStreamingEl.classList.remove('streaming');
    currentStreamingEl = null;
  }

  const line = document.createElement('div');
  line.className = 'codex-line ' + type;
  line.textContent = text;

  // If fullText is provided and different from text, make it expandable
  if (fullText && fullText !== text) {
    line.classList.add('expandable');
    line.dataset.truncated = text;
    line.dataset.full = fullText;
    line.dataset.expanded = 'false';
    line.addEventListener('click', () => {
      const isExpanded = line.dataset.expanded === 'true';
      if (isExpanded) {
        line.textContent = line.dataset.truncated;
        line.dataset.expanded = 'false';
        line.classList.remove('expanded');
      } else {
        line.textContent = line.dataset.full;
        line.dataset.expanded = 'true';
        line.classList.add('expanded');
      }
    });
  }

  ui.codexOutput.appendChild(line);
  ui.codexOutput.scrollTop = ui.codexOutput.scrollHeight;
}

function clearCodexOutput() {
  if (!ui.codexOutput) return;
  ui.codexOutput.innerHTML = '<div class="codex-line empty" id="codexEmpty">Waiting for Codex activity...</div>';
  currentStreamingEl = null;
}

// Auto-connect to Codex events on page load
connectCodexEvents();

// --- Tab Switching ---
function switchTab(tabName) {
  // Update button states
  ui.tabButtons.forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  // Update content visibility
  ui.tabTranscript.classList.remove('active');
  ui.tabCodex.classList.remove('active');
  ui.tabClaude.classList.remove('active');

  if (tabName === 'transcript') {
    ui.tabTranscript.classList.add('active');
  } else if (tabName === 'codex') {
    ui.tabCodex.classList.add('active');
  } else if (tabName === 'claude') {
    ui.tabClaude.classList.add('active');
  }
}

// Add click listeners to tab buttons
ui.tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    switchTab(btn.dataset.tab);
  });
});

console.log('[FRONTEND] Tab switching initialized');
