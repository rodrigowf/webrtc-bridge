// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('[FRONTEND] Service Worker registered:', registration.scope);
      })
      .catch((err) => {
        console.log('[FRONTEND] Service Worker registration failed:', err);
      });
  });
}

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
  conversationSelect: document.getElementById('conversationSelect'),
  newConversationBtn: document.getElementById('newConversation'),
  deleteConversationBtn: document.getElementById('deleteConversation'),
  innerThoughtsToggle: document.getElementById('innerThoughtsToggle'),
};

const state = {
  pc: null,
  localStream: null,
  connectionId: null, // Track our connection ID for multi-frontend support
  isMuted: true, // Start muted
  isAIMuted: true, // Start with AI muted
  isActive: false,
  showInnerThoughts: false, // Start with inner thoughts hidden
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

    state.pc.oniceconnectionstatechange = () => {
      console.log('[FRONTEND] ICE connection state:', state.pc.iceConnectionState);
      if (state.pc.iceConnectionState === 'disconnected' || state.pc.iceConnectionState === 'failed') {
        setStatus('Disconnected', 'Connection lost', 'error');
      }
    };
    state.pc.onconnectionstatechange = () => {
      console.log('[FRONTEND] Connection state:', state.pc.connectionState);
      if (state.pc.connectionState === 'disconnected' || state.pc.connectionState === 'failed') {
        setStatus('Disconnected', 'Connection lost', 'error');
      }
    };

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
    setStatus('Connected', 'Both Mic and AI are muted', 'live');
    state.isActive = true;
    ui.muteButton.disabled = false;
    ui.muteAIButton.disabled = false;
    updateConversationControlsState();
    console.log('[FRONTEND] ✅ WebRTC connection established successfully (starting muted)!');
  } catch (err) {
    console.error('[FRONTEND] Error during connection setup:', err);
    setStatus('Error', err.message || String(err), 'error');
    state.isActive = false;
    updateConversationControlsState();
  }
}

function cleanup() {
  console.log('[FRONTEND] cleanup() invoked');
  state.isActive = false;
  updateConversationControlsState();
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
    ui.subStatusEl.textContent = 'Both Mic and AI are muted';
  } else if (state.isMuted) {
    ui.subStatusEl.textContent = 'Your mic is muted';
  } else if (state.isAIMuted) {
    ui.subStatusEl.textContent = 'AI audio is muted';
  } else {
    ui.subStatusEl.textContent = 'Speak freely — we are listening';
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
    setCodexStatus('error', 'Offline');
    setClaudeStatus('error', 'Offline');
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

function getToolDetail(toolName, input) {
  if (!input) return '';

  switch (toolName) {
    case 'Read':
      return input.file_path ? shortenPath(input.file_path) : '';
    case 'Write':
      return input.file_path ? shortenPath(input.file_path) : '';
    case 'Edit':
      return input.file_path ? shortenPath(input.file_path) : '';
    case 'Glob':
      return input.pattern || '';
    case 'Grep':
      const pattern = input.pattern ? `"${input.pattern}"` : '';
      const glob = input.glob ? ` in ${input.glob}` : '';
      return pattern + glob;
    case 'Bash':
      const cmd = input.command || '';
      return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
    case 'Task':
      return input.description || '';
    case 'WebFetch':
      return input.url || '';
    case 'WebSearch':
      return input.query ? `"${input.query}"` : '';
    case 'TodoWrite':
      return input.todos ? `${input.todos.length} items` : '';
    default:
      return '';
  }
}

function shortenPath(filePath) {
  if (!filePath) return '';
  const parts = filePath.split('/');
  if (parts.length <= 3) return filePath;
  return '.../' + parts.slice(-2).join('/');
}

// --- Structured Output Rendering ---

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function shortenCommand(cmd) {
  if (!cmd) return '';
  const shortCmd = cmd.split(' ')[0].split('/').pop();
  return cmd.length > 40 ? shortCmd + ' ...' : cmd;
}

function createOutputSection(type, title, detail, content, collapsed = false) {
  const section = document.createElement('div');
  section.className = `output-section ${type}-section${collapsed ? ' collapsed' : ''}`;

  const header = document.createElement('div');
  header.className = 'output-section-header';
  header.innerHTML = `
    <span class="section-title">${escapeHtml(title)}</span>
    ${detail ? `<span class="section-detail">${escapeHtml(detail)}</span>` : ''}
  `;
  header.addEventListener('click', () => section.classList.toggle('collapsed'));

  const contentEl = document.createElement('div');
  contentEl.className = 'output-section-content';
  if (typeof content === 'string') {
    contentEl.innerHTML = content;
  } else {
    contentEl.appendChild(content);
  }

  section.appendChild(header);
  section.appendChild(contentEl);
  return section;
}

function renderTodoSection(todos) {
  const list = document.createElement('ul');
  list.className = 'todo-list';

  todos.forEach(todo => {
    const item = document.createElement('li');
    item.className = `todo-item ${todo.status || 'pending'}`;
    item.innerHTML = `
      <span class="todo-checkbox"></span>
      <span class="todo-text">${escapeHtml(todo.content || todo.text || '')}</span>
    `;
    list.appendChild(item);
  });

  return createOutputSection('todo', 'Update Todos', null, list);
}

function renderBashSection(command, output, description, isRunning = false) {
  const content = document.createElement('div');

  // Input block
  const inputBlock = document.createElement('div');
  inputBlock.className = 'bash-input';
  inputBlock.innerHTML = `<span class="bash-label">IN</span>${escapeHtml(command)}`;
  content.appendChild(inputBlock);

  // Output block (if any)
  if (output || isRunning) {
    const outputBlock = document.createElement('div');
    outputBlock.className = 'bash-output';
    if (isRunning) {
      outputBlock.innerHTML = `<span class="bash-label">OUT</span><span class="bash-status">&lt;status&gt;running&lt;/status&gt;</span>\n\n<span class="bash-status">&lt;stdout&gt;</span>\n${output ? escapeHtml(output) : ''}`;
    } else {
      outputBlock.innerHTML = `<span class="bash-label">OUT</span>${escapeHtml(output || '')}`;
    }
    content.appendChild(outputBlock);
  }

  return createOutputSection('bash', 'Bash', description || shortenCommand(command), content);
}

function renderEditSection(filename, oldString, newString, addedLines, removedLines) {
  const content = document.createElement('div');

  // Filename with stats
  const filenameEl = document.createElement('div');
  filenameEl.className = 'edit-filename';
  const shortName = filename.split('/').pop();
  const stats = [];
  if (addedLines) stats.push(`Added ${addedLines} lines`);
  if (removedLines) stats.push(`Removed ${removedLines} lines`);
  filenameEl.innerHTML = `${escapeHtml(shortName)}${stats.length ? ` <span class="edit-stats">${stats.join(', ')}</span>` : ''}`;
  content.appendChild(filenameEl);

  // Diff content
  if (oldString || newString) {
    const diffEl = document.createElement('div');
    diffEl.className = 'diff-content';

    // Generate simple diff visualization
    const oldLines = (oldString || '').split('\n');
    const newLines = (newString || '').split('\n');

    let diffHtml = '';

    // Show removed lines
    oldLines.forEach(line => {
      if (line.trim() && !newLines.includes(line)) {
        diffHtml += `<div class="diff-line removed">${escapeHtml(line)}</div>`;
      }
    });

    // Show added lines
    newLines.forEach(line => {
      if (line.trim()) {
        if (!oldLines.includes(line)) {
          diffHtml += `<div class="diff-line added">${escapeHtml(line)}</div>`;
        } else {
          diffHtml += `<div class="diff-line context">${escapeHtml(line)}</div>`;
        }
      }
    });

    diffEl.innerHTML = diffHtml || '<div class="diff-line context">(no visible changes)</div>';
    content.appendChild(diffEl);
  }

  return createOutputSection('edit', 'Edit', shortName, content);
}

function renderReadSection(filename, lineCount) {
  const content = document.createElement('div');
  content.innerHTML = `<span style="color: var(--accent-2);">${escapeHtml(filename)}</span>`;
  return createOutputSection('read', 'Read', lineCount ? `${lineCount} lines` : null, content, true);
}

function renderSearchSection(type, pattern, results, glob) {
  const content = document.createElement('div');
  content.className = 'search-results';

  if (Array.isArray(results) && results.length > 0) {
    results.slice(0, 10).forEach(result => {
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = `<span class="search-result-path">${escapeHtml(typeof result === 'string' ? result : result.path || result)}</span>`;
      content.appendChild(item);
    });
    if (results.length > 10) {
      const more = document.createElement('div');
      more.className = 'search-result-item';
      more.style.fontStyle = 'italic';
      more.textContent = `... and ${results.length - 10} more`;
      content.appendChild(more);
    }
  } else {
    content.innerHTML = '<span style="color: var(--muted); font-style: italic;">No results</span>';
  }

  const detail = glob ? `"${pattern}" in ${glob}` : `"${pattern}"`;
  return createOutputSection('search', type, detail, content);
}

function renderTaskSection(description, status) {
  const content = document.createElement('div');
  content.innerHTML = `<span style="color: var(--text);">${escapeHtml(description)}</span>`;
  return createOutputSection('task', 'Task', status || 'spawned', content, true);
}

function renderWebSection(type, query) {
  const content = document.createElement('div');
  content.innerHTML = `<span style="color: var(--text);">${escapeHtml(query)}</span>`;
  return createOutputSection('web', type, null, content, true);
}

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
          renderClaudeToolUse(block.name, block.input);
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

function renderClaudeToolUse(toolName, input) {
  if (!ui.claudeOutput) return;
  if (ui.claudeEmpty) ui.claudeEmpty.remove();

  // Finalize any streaming element first
  if (currentClaudeStreamingEl) {
    currentClaudeStreamingEl.classList.remove('streaming');
    currentClaudeStreamingEl = null;
  }

  let section = null;

  switch (toolName) {
    case 'TodoWrite':
      if (input?.todos) {
        section = renderTodoSection(input.todos);
      }
      break;

    case 'Bash':
      section = renderBashSection(input?.command || '', null, input?.description, true);
      break;

    case 'Edit':
      const addedLines = input?.new_string ? input.new_string.split('\n').length : 0;
      const removedLines = input?.old_string ? input.old_string.split('\n').length : 0;
      section = renderEditSection(
        input?.file_path || 'unknown',
        input?.old_string,
        input?.new_string,
        addedLines,
        removedLines
      );
      break;

    case 'Read':
      section = renderReadSection(input?.file_path || 'unknown', input?.limit);
      break;

    case 'Glob':
      section = renderSearchSection('Glob', input?.pattern || '', [], input?.path);
      break;

    case 'Grep':
      section = renderSearchSection('Grep', input?.pattern || '', [], input?.glob || input?.path);
      break;

    case 'Task':
      section = renderTaskSection(input?.description || 'Agent task', input?.subagent_type);
      break;

    case 'WebFetch':
      section = renderWebSection('WebFetch', input?.url || '');
      break;

    case 'WebSearch':
      section = renderWebSection('WebSearch', input?.query || '');
      break;

    case 'Write':
      const writeLines = input?.content ? input.content.split('\n').length : 0;
      section = renderEditSection(input?.file_path || 'unknown', '', input?.content, writeLines, 0);
      break;

    default:
      // Fallback to simple line for unknown tools
      const toolDetail = getToolDetail(toolName, input);
      appendClaudeLine('⚙️ ' + toolName + (toolDetail ? ' - ' + toolDetail : ''), 'function');
      return;
  }

  if (section) {
    ui.claudeOutput.appendChild(section);
    ui.claudeOutput.scrollTop = ui.claudeOutput.scrollHeight;
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
        renderCodexToolUse(event.item.name, event.item.arguments);
      } else if (event.item?.type === 'agent_message') {
        setCodexStatus('running', 'Agent thinking...');
      } else if (event.item?.type === 'command_execution') {
        const cmd = event.item.command || 'command';
        renderCodexBashSection(cmd, null, true);
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
        // Function completed - could update the section if needed
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
        // Render structured bash section with output
        renderCodexBashSection(cmd, output, false, exitCode);
      }
      break;

    default:
      // Log other events for debugging
      console.log('[FRONTEND] Unhandled thread event:', event.type, event);
  }
}

function renderCodexToolUse(toolName, args) {
  if (!ui.codexOutput) return;
  if (ui.codexEmpty) ui.codexEmpty.remove();

  // Finalize any streaming element first
  if (currentStreamingEl) {
    currentStreamingEl.classList.remove('streaming');
    currentStreamingEl = null;
  }

  // For now, just show a simple function line - Codex doesn't have same tool structure as Claude
  let display = '⚙️ ' + (toolName || 'function');
  if (args) {
    try {
      const argsStr = typeof args === 'string' ? args : JSON.stringify(args);
      if (argsStr.length > 60) {
        display += ': ' + argsStr.slice(0, 60) + '...';
      } else {
        display += ': ' + argsStr;
      }
    } catch (e) {
      // ignore
    }
  }
  appendCodexLine(display, 'function');
}

function renderCodexBashSection(command, output, isRunning = false, exitCode = null) {
  if (!ui.codexOutput) return;
  if (ui.codexEmpty) ui.codexEmpty.remove();

  // Finalize any streaming element first
  if (currentStreamingEl) {
    currentStreamingEl.classList.remove('streaming');
    currentStreamingEl = null;
  }

  const section = renderBashSection(command, output, null, isRunning);

  // Update styling based on exit code
  if (exitCode !== null && exitCode !== 0) {
    section.classList.add('error');
    section.style.borderLeftColor = 'var(--danger)';
  }

  ui.codexOutput.appendChild(section);
  ui.codexOutput.scrollTop = ui.codexOutput.scrollHeight;
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

// --- Conversation Management ---
let currentConversationId = null;

async function loadConversations() {
  console.log('[FRONTEND] Loading conversations...');
  try {
    const res = await fetch('/conversations');
    if (!res.ok) throw new Error('Failed to load conversations');
    const data = await res.json();

    ui.conversationSelect.innerHTML = '';

    if (data.conversations.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No conversations yet';
      ui.conversationSelect.appendChild(opt);
    } else {
      data.conversations.forEach(conv => {
        const opt = document.createElement('option');
        opt.value = conv.id;
        const date = new Date(conv.updatedAt).toLocaleDateString();
        opt.textContent = `${conv.title} (${conv.messageCount} msgs, ${date})`;
        ui.conversationSelect.appendChild(opt);
      });
    }

    // Select current conversation and load its transcript
    if (data.currentId) {
      ui.conversationSelect.value = data.currentId;
      currentConversationId = data.currentId;

      // Load the transcript for the current conversation
      const convRes = await fetch(`/conversations/${data.currentId}`);
      if (convRes.ok) {
        const conversation = await convRes.json();
        loadTranscriptFromConversation(conversation);
      }
    }

    console.log('[FRONTEND] Loaded', data.conversations.length, 'conversations, current:', data.currentId);
  } catch (err) {
    console.error('[FRONTEND] Failed to load conversations:', err);
    ui.conversationSelect.innerHTML = '<option value="">Error loading</option>';
  }
}

async function selectConversation(conversationId) {
  if (!conversationId) return;

  console.log('[FRONTEND] Selecting conversation:', conversationId);
  try {
    const res = await fetch(`/conversations/${conversationId}/select`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to select conversation');
    const data = await res.json();

    currentConversationId = conversationId;

    // Load transcript into UI
    loadTranscriptFromConversation(data.conversation);

    console.log('[FRONTEND] Selected conversation:', conversationId);
  } catch (err) {
    console.error('[FRONTEND] Failed to select conversation:', err);
  }
}

async function createNewConversation() {
  console.log('[FRONTEND] Creating new conversation...');
  try {
    const res = await fetch('/conversations', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to create conversation');
    const conversation = await res.json();

    currentConversationId = conversation.id;

    // Clear transcript UI
    clearTranscript();

    // Reload conversation list
    await loadConversations();

    console.log('[FRONTEND] Created new conversation:', conversation.id);
  } catch (err) {
    console.error('[FRONTEND] Failed to create conversation:', err);
  }
}

async function deleteCurrentConversation() {
  if (!currentConversationId) {
    console.log('[FRONTEND] No conversation to delete');
    return;
  }

  if (!confirm('Delete this conversation? This cannot be undone.')) {
    return;
  }

  console.log('[FRONTEND] Deleting conversation:', currentConversationId);
  try {
    const res = await fetch(`/conversations/${currentConversationId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete conversation');

    currentConversationId = null;

    // Clear transcript UI
    clearTranscript();

    // Reload conversation list
    await loadConversations();

    console.log('[FRONTEND] Deleted conversation');
  } catch (err) {
    console.error('[FRONTEND] Failed to delete conversation:', err);
  }
}

function loadTranscriptFromConversation(conversation) {
  if (!conversation || !conversation.transcript) return;

  // Clear existing transcript
  ui.transcriptEl.innerHTML = '';

  if (conversation.transcript.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'line';
    empty.id = 'transcriptEmpty';
    empty.textContent = 'Speak to stream transcript.';
    ui.transcriptEl.appendChild(empty);
    return;
  }

  // Add each transcript entry
  conversation.transcript.forEach(entry => {
    const line = document.createElement('div');
    line.className = 'line';
    line.textContent = (entry.role === 'user' ? 'You: ' : 'Assistant: ') + entry.text;
    ui.transcriptEl.appendChild(line);
  });

  // Scroll to bottom
  ui.transcriptEl.scrollTop = ui.transcriptEl.scrollHeight;
}

function clearTranscript() {
  ui.transcriptEl.innerHTML = '<div class="line" id="transcriptEmpty">Speak to stream transcript.</div>';
}

// Event listeners for conversation management
ui.conversationSelect.addEventListener('change', (e) => {
  const selectedId = e.target.value;
  if (selectedId && selectedId !== currentConversationId) {
    selectConversation(selectedId);
  }
});

ui.newConversationBtn.addEventListener('click', () => {
  createNewConversation();
});

ui.deleteConversationBtn.addEventListener('click', () => {
  deleteCurrentConversation();
});

// Disable conversation controls when connected (can't switch mid-session)
function updateConversationControlsState() {
  const isConnected = state.isActive;
  ui.conversationSelect.disabled = isConnected;
  ui.newConversationBtn.disabled = isConnected;
  ui.deleteConversationBtn.disabled = isConnected;

  if (isConnected) {
    ui.conversationSelect.title = 'Cannot change conversation during active session';
    ui.newConversationBtn.title = 'Cannot create new conversation during active session';
    ui.deleteConversationBtn.title = 'Cannot delete conversation during active session';
  } else {
    ui.conversationSelect.title = '';
    ui.newConversationBtn.title = '';
    ui.deleteConversationBtn.title = '';
  }
}

// Inner thoughts toggle
async function loadInnerThoughtsState() {
  try {
    const res = await fetch('/agents/inner-thoughts');
    if (res.ok) {
      const data = await res.json();
      state.showInnerThoughts = data.showInnerThoughts;
      updateInnerThoughtsUI();
    }
  } catch (err) {
    console.error('[FRONTEND] Failed to load inner thoughts state:', err);
  }
}

function updateInnerThoughtsUI() {
  if (state.showInnerThoughts) {
    ui.innerThoughtsToggle.classList.remove('muted');
  } else {
    ui.innerThoughtsToggle.classList.add('muted');
  }
}

async function toggleInnerThoughts() {
  try {
    const res = await fetch('/agents/inner-thoughts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ show: !state.showInnerThoughts }),
    });
    if (res.ok) {
      const data = await res.json();
      state.showInnerThoughts = data.showInnerThoughts;
      updateInnerThoughtsUI();
      console.log('[FRONTEND] Inner thoughts:', state.showInnerThoughts ? 'visible' : 'hidden');
    }
  } catch (err) {
    console.error('[FRONTEND] Failed to toggle inner thoughts:', err);
  }
}

ui.innerThoughtsToggle.addEventListener('click', toggleInnerThoughts);

// Load conversations on page load
loadConversations();
loadInnerThoughtsState();

console.log('[FRONTEND] Conversation management initialized');
