/**
 * Inner thoughts configuration for agent event streaming.
 *
 * When inner thoughts are shown (ON):
 * - Voice assistant sees all inner thoughts, tool calls, and intermediate messages
 * - Full transparency into agent reasoning
 *
 * When inner thoughts are hidden (OFF):
 * - Voice assistant only sees final responses and essential status updates
 * - Cleaner, less noisy experience
 */

type InnerThoughtsListener = (show: boolean) => void;

let showInnerThoughts = false;
const listeners = new Set<InnerThoughtsListener>();

/**
 * Get current inner thoughts visibility setting
 */
export function getShowInnerThoughts(): boolean {
  return showInnerThoughts;
}

/**
 * Set inner thoughts visibility for both agents
 */
export function setShowInnerThoughts(show: boolean): { status: 'ok'; showInnerThoughts: boolean } {
  const wasShowing = showInnerThoughts;
  showInnerThoughts = show;

  if (wasShowing !== show) {
    console.log(`[INNER-THOUGHTS] Mode changed: ${show ? 'showing' : 'hidden'}`);
    // Notify all listeners
    for (const listener of listeners) {
      try {
        listener(show);
      } catch (err) {
        console.error('[INNER-THOUGHTS] Listener error', err);
      }
    }
  }

  return { status: 'ok', showInnerThoughts };
}

/**
 * Toggle inner thoughts visibility
 */
export function toggleShowInnerThoughts(): { status: 'ok'; showInnerThoughts: boolean } {
  return setShowInnerThoughts(!showInnerThoughts);
}

/**
 * Subscribe to inner thoughts visibility changes
 */
export function subscribeInnerThoughtsChanges(listener: InnerThoughtsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Event types that should always be sent regardless of inner thoughts setting.
 * These are essential status updates.
 */
const ESSENTIAL_EVENT_TYPES = new Set([
  // Session lifecycle
  'session_started',
  'turn_completed',
  'turn_error',

  // Control events
  'reset',
  'paused',
  'compact_completed',
  'compact_error',

  // Transcript events (user should always see what was said)
  'transcript_delta',
  'transcript_done',
  'user_transcript_done',

  // Connection status
  'connected',
]);

/**
 * Event types that are inner thoughts (detailed progress info).
 * Only sent when inner thoughts are shown.
 */
const INNER_THOUGHT_EVENT_TYPES = new Set([
  // Detailed execution progress
  'turn_started',
  'turn_paused',
  'thread_event',
  'message',

  // Compaction progress
  'compact_started',
]);

/**
 * Determine if an event should be sent based on inner thoughts setting.
 *
 * @param eventType - The type of the event
 * @param showInnerThoughts - Whether inner thoughts are visible
 * @returns true if the event should be sent
 */
export function shouldSendEvent(eventType: string, showInnerThoughts: boolean): boolean {
  // Essential events always go through
  if (ESSENTIAL_EVENT_TYPES.has(eventType)) {
    return true;
  }

  // Inner thought events only when showing inner thoughts
  if (INNER_THOUGHT_EVENT_TYPES.has(eventType)) {
    return showInnerThoughts;
  }

  // Unknown events: default to sending only when inner thoughts are shown
  // This is conservative - new event types won't spam unless inner thoughts are on
  return showInnerThoughts;
}
