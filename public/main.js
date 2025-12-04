const startButton = document.getElementById('start');
const statusEl = document.getElementById('status');
const remoteAudio = document.getElementById('remoteAudio');

let pc = null;

console.log('[FRONTEND] Script loaded and initialized');

async function startCall() {
  console.log('[FRONTEND] startCall() function invoked');
  try {
    startButton.disabled = true;
    statusEl.textContent = 'Requesting microphone permission...';
    console.log('[FRONTEND] Requesting microphone access...');

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[FRONTEND] Microphone access granted, stream tracks:', stream.getTracks().length);

    statusEl.textContent = 'Creating WebRTC connection...';
    console.log('[FRONTEND] Creating RTCPeerConnection...');

    pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    console.log('[FRONTEND] RTCPeerConnection created');

    stream.getTracks().forEach((track) => {
      console.log('[FRONTEND] Adding track to peer connection:', track.kind, track.label);
      pc.addTrack(track, stream);
    });
    console.log('[FRONTEND] All local tracks added to peer connection');

    console.log('[FRONTEND] Setting up ontrack event handler...');
    pc.ontrack = (event) => {
      console.log('[FRONTEND] ontrack event received!');
      console.log('[FRONTEND] Remote track kind:', event.track.kind);
      console.log('[FRONTEND] Remote streams:', event.streams.length);
      console.log('[FRONTEND] Track enabled:', event.track.enabled);
      console.log('[FRONTEND] Track muted:', event.track.muted);
      console.log('[FRONTEND] Track readyState:', event.track.readyState);

      // Handle case where track is not associated with a stream
      let remoteStream;
      if (event.streams && event.streams.length > 0) {
        console.log('[FRONTEND] Using stream from event.streams');
        remoteStream = event.streams[0];
      } else {
        console.log('[FRONTEND] No stream in event - creating new MediaStream with track');
        remoteStream = new MediaStream([event.track]);
      }

      // Set audio element properties
      remoteAudio.srcObject = remoteStream;
      remoteAudio.volume = 1.0;
      console.log('[FRONTEND] Remote audio element srcObject set, volume:', remoteAudio.volume);
      console.log('[FRONTEND] Audio element muted:', remoteAudio.muted);
      console.log('[FRONTEND] Audio element paused:', remoteAudio.paused);

      // Monitor track activity BEFORE attempting to play
      event.track.onmute = () => {
        console.log('[FRONTEND] Remote track MUTED');
      };

      event.track.onunmute = () => {
        console.log('[FRONTEND] ✅ Remote track UNMUTED - audio should now be audible!');
      };

      event.track.onended = () => {
        console.log('[FRONTEND] Remote track ENDED');
      };

      // Attempt to play immediately (autoplay should handle it)
      // Even if track is muted initially, it will unmute shortly after
      remoteAudio.play()
        .then(() => {
          console.log('[FRONTEND] ✅ Remote audio playback started successfully');
          console.log('[FRONTEND] Audio element is now playing, paused:', remoteAudio.paused);
          console.log('[FRONTEND] Current track muted state:', event.track.muted);

          // If track is still muted, we'll get an unmute event soon
          if (event.track.muted) {
            console.log('[FRONTEND] ⚠️  Track is currently muted, waiting for unmute event...');
          } else {
            console.log('[FRONTEND] ✅ Track is unmuted, audio should be playing!');
          }
        })
        .catch((err) => {
          console.error('[FRONTEND] ❌ Failed to start audio playback:', err);
          console.error('[FRONTEND] Error name:', err.name);
          console.error('[FRONTEND] Error message:', err.message);
        });
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[FRONTEND] ICE connection state:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('[FRONTEND] Connection state:', pc.connectionState);
    };

    statusEl.textContent = 'Creating SDP offer...';
    console.log('[FRONTEND] Creating SDP offer...');
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false });
    console.log('[FRONTEND] Offer created, SDP length:', offer.sdp.length);
    await pc.setLocalDescription(offer);
    console.log('[FRONTEND] Local description set');

    statusEl.textContent = 'Sending offer to backend...';
    console.log('[FRONTEND] Sending offer to /signal endpoint...');
    const res = await fetch('/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offer: offer.sdp }),
    });
    console.log('[FRONTEND] Response received, status:', res.status);

    const data = await res.json();
    console.log('[FRONTEND] Response data parsed');
    if (!res.ok) {
      console.error('[FRONTEND] Signaling failed:', data.error);
      throw new Error(data.error || 'Signaling failed');
    }

    statusEl.textContent = 'Applying answer from backend...';
    console.log('[FRONTEND] Setting remote description with answer, SDP length:', data.answer.length);
    await pc.setRemoteDescription({ type: 'answer', sdp: data.answer });
    console.log('[FRONTEND] Remote description set successfully');

    statusEl.textContent = 'Connected. Start speaking!';
    console.log('[FRONTEND] ✅ WebRTC connection established successfully!');
  } catch (err) {
    console.error('[FRONTEND] Error during connection setup:', err);
    statusEl.textContent = 'Error: ' + (err.message || err);
    startButton.disabled = false;
  }
}

startButton.addEventListener('click', () => {
  console.log('[FRONTEND] Start button clicked');
  if (!pc) {
    console.log('[FRONTEND] No existing connection - starting new call');
    void startCall();
  } else {
    console.log('[FRONTEND] Connection already exists - ignoring click');
  }
});

console.log('[FRONTEND] Event listener attached to start button');
