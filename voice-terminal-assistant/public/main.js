// Voice Terminal Assistant - Frontend
// Handles WebRTC connection, audio streaming, and UI updates

let pc = null;
let localStream = null;
let connectionId = null;
let isMuted = true;
let isAiMuted = true;
let servicesRunning = false;

const $ = (id) => document.getElementById(id);
const startBtn = $('startBtn');
const stopBtn = $('stopBtn');
const muteBtn = $('muteBtn');
const muteAiBtn = $('muteAiBtn');
const statusDot = $('statusDot');
const statusText = $('statusText');
const remoteAudio = $('remoteAudio');
const transcriptOutput = $('transcriptOutput');
const terminalOutput = $('terminalOutput');

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(`tab-${tab}`).classList.add('active');
  });
});

// Update status
function setStatus(text, isActive = false) {
  statusText.textContent = text;
  if (isActive) {
    statusDot.classList.add('active');
  } else {
    statusDot.classList.remove('active');
  }
}

// Add transcript line
function addTranscriptLine(role, text) {
  // Remove empty message if present
  const empty = transcriptOutput.querySelector('.empty');
  if (empty) empty.remove();

  const line = document.createElement('div');
  line.className = `line ${role}`;
  line.innerHTML = `<div class="line-label">${role}</div>${escapeHtml(text)}`;
  transcriptOutput.appendChild(line);
  transcriptOutput.parentElement.scrollTop = transcriptOutput.parentElement.scrollHeight;
}

// Add terminal line
function addTerminalLine(type, content) {
  // Remove empty message if present
  const empty = terminalOutput.querySelector('.empty');
  if (empty) empty.remove();

  const line = document.createElement('div');
  line.className = `line ${type}`;

  if (type === 'command') {
    line.innerHTML = `<div class="line-label">Command</div>$ ${escapeHtml(content)}`;
  } else if (type === 'output') {
    line.innerHTML = `<div class="line-label">Output</div>${escapeHtml(content)}`;
  } else if (type === 'error') {
    line.innerHTML = `<div class="line-label">Error</div>${escapeHtml(content)}`;
  }

  terminalOutput.appendChild(line);
  terminalOutput.parentElement.scrollTop = terminalOutput.parentElement.scrollHeight;
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Start services
async function startServices() {
  try {
    setStatus('Starting services...', false);
    const res = await fetch('/services/start', { method: 'POST' });
    const data = await res.json();

    if (data.status === 'ok') {
      servicesRunning = true;
      setStatus('Services running', true);
      startBtn.disabled = true;
      stopBtn.disabled = false;

      // Start WebRTC connection
      await connect();
    } else {
      throw new Error(data.error || 'Failed to start services');
    }
  } catch (err) {
    console.error('Failed to start services:', err);
    setStatus('Failed to start services', false);
    alert('Failed to start services: ' + err.message);
  }
}

// Stop services
async function stopServices() {
  try {
    // Close WebRTC connection first
    if (pc) {
      pc.close();
      pc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    const res = await fetch('/services/stop', { method: 'POST' });
    const data = await res.json();

    servicesRunning = false;
    setStatus('Services stopped', false);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    muteBtn.disabled = true;
    muteAiBtn.disabled = true;
  } catch (err) {
    console.error('Failed to stop services:', err);
    setStatus('Failed to stop services', false);
  }
}

// Connect WebRTC
async function connect() {
  try {
    setStatus('Requesting microphone access...', false);

    // Get user media
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

    setStatus('Connecting to server...', false);

    // Create peer connection
    pc = new RTCPeerConnection();

    // Add local audio track
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    // Handle remote track (AI audio)
    pc.ontrack = (event) => {
      console.log('Received remote track');
      remoteAudio.srcObject = event.streams[0];
      // Start muted
      remoteAudio.muted = true;
      isAiMuted = true;
    };

    // Connection state monitoring
    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'connected') {
        setStatus('Connected - Ready to speak', true);
        muteBtn.disabled = false;
        muteAiBtn.disabled = false;
      } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
        setStatus('Connection lost', false);
      }
    };

    // Create offer
    const offer = await pc.createOffer({ offerToReceiveAudio: true });
    await pc.setLocalDescription(offer);

    // Send offer to server
    const response = await fetch('/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: pc.localDescription.sdp }),
    });

    const { answer, connectionId: connId } = await response.json();
    connectionId = connId;
    console.log('Connection ID:', connectionId);

    // Set remote description
    await pc.setRemoteDescription({ type: 'answer', sdp: answer });

    // Start muted
    localStream.getTracks().forEach(track => track.enabled = false);
    isMuted = true;
    muteBtn.textContent = 'Unmute Mic';

    setStatus('Connected - Mic and AI muted', true);

    // Subscribe to events
    subscribeToEvents();
  } catch (err) {
    console.error('Connection error:', err);
    setStatus('Connection failed: ' + err.message, false);
    alert('Failed to connect: ' + err.message);
  }
}

// Subscribe to SSE events
function subscribeToEvents() {
  const eventSource = new EventSource('/events');

  eventSource.onmessage = (e) => {
    const event = JSON.parse(e.data);

    // Transcript events
    if (event.type === 'transcript_done' && event.role === 'assistant') {
      addTranscriptLine('assistant', event.text);
    } else if (event.type === 'user_transcript_done') {
      addTranscriptLine('user', event.text);
    }

    // Terminal events
    if (event.type === 'terminal_command') {
      addTerminalLine('command', event.command);
    } else if (event.type === 'terminal_output') {
      if (event.output) {
        addTerminalLine('output', event.output);
      }
      if (event.error) {
        addTerminalLine('error', event.error);
      }
    } else if (event.type === 'terminal_error') {
      addTerminalLine('error', event.error);
    }
  };

  eventSource.onerror = (err) => {
    console.error('SSE error:', err);
    eventSource.close();
  };
}

// Toggle microphone mute
function toggleMute() {
  if (!localStream) return;

  isMuted = !isMuted;
  localStream.getTracks().forEach(track => {
    track.enabled = !isMuted;
  });

  muteBtn.textContent = isMuted ? 'Unmute Mic' : 'Mute Mic';
  console.log('Microphone', isMuted ? 'muted' : 'unmuted');
}

// Toggle AI audio mute
function toggleAiMute() {
  isAiMuted = !isAiMuted;
  remoteAudio.muted = isAiMuted;
  muteAiBtn.textContent = isAiMuted ? 'Unmute AI' : 'Mute AI';
  console.log('AI audio', isAiMuted ? 'muted' : 'unmuted');
}

// Event listeners
startBtn.addEventListener('click', startServices);
stopBtn.addEventListener('click', stopServices);
muteBtn.addEventListener('click', toggleMute);
muteAiBtn.addEventListener('click', toggleAiMute);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  if (connectionId) {
    navigator.sendBeacon('/disconnect', JSON.stringify({ connectionId }));
  }
});

console.log('Voice Terminal Assistant loaded');
setStatus('Ready to start', false);
