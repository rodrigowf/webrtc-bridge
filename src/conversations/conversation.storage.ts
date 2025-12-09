import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Conversations are stored in a 'conversations' directory in the working directory
function getConversationsDir(): string {
  return path.join(process.cwd(), 'conversations');
}

export type TranscriptEntry = {
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
};

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  transcript: TranscriptEntry[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
};

// Current active conversation ID
let currentConversationId: string | null = null;

/**
 * Ensure conversations directory exists
 */
async function ensureConversationsDir(): Promise<void> {
  const dir = getConversationsDir();
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    console.log('[CONVERSATIONS] Created conversations directory:', dir);
  }
}

/**
 * Generate a unique conversation ID
 */
function generateConversationId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Get the file path for a conversation
 */
function getConversationPath(conversationId: string): string {
  return path.join(getConversationsDir(), `${conversationId}.json`);
}

/**
 * Generate a title from the first user message
 */
function generateTitle(transcript: TranscriptEntry[]): string {
  const firstUserMessage = transcript.find(t => t.role === 'user');
  if (firstUserMessage) {
    const text = firstUserMessage.text.trim();
    // Take first 50 chars or first sentence, whichever is shorter
    const firstSentence = text.split(/[.!?]/)[0];
    const title = firstSentence.length <= 50 ? firstSentence : text.slice(0, 47) + '...';
    return title || 'New Conversation';
  }
  return 'New Conversation';
}

/**
 * Create a new conversation
 */
export async function createConversation(): Promise<Conversation> {
  await ensureConversationsDir();

  const id = generateConversationId();
  const now = Date.now();

  const conversation: Conversation = {
    id,
    title: 'New Conversation',
    createdAt: now,
    updatedAt: now,
    transcript: [],
  };

  await saveConversation(conversation);
  currentConversationId = id;

  console.log('[CONVERSATIONS] Created new conversation:', id);
  return conversation;
}

/**
 * Save a conversation to disk
 */
export async function saveConversation(conversation: Conversation): Promise<void> {
  await ensureConversationsDir();

  const filePath = getConversationPath(conversation.id);
  await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf8');
}

/**
 * Load a conversation from disk
 */
export async function loadConversation(conversationId: string): Promise<Conversation | null> {
  try {
    const filePath = getConversationPath(conversationId);
    const content = await fs.readFile(filePath, 'utf8');
    const conversation = JSON.parse(content) as Conversation;
    currentConversationId = conversationId;
    console.log('[CONVERSATIONS] Loaded conversation:', conversationId);
    return conversation;
  } catch (err) {
    console.error('[CONVERSATIONS] Failed to load conversation:', conversationId, err);
    return null;
  }
}

/**
 * Get the current active conversation, creating one if none exists
 */
export async function getCurrentConversation(): Promise<Conversation> {
  if (currentConversationId) {
    const conversation = await loadConversation(currentConversationId);
    if (conversation) {
      return conversation;
    }
  }

  // No current conversation, create a new one
  return createConversation();
}

/**
 * Get the current conversation ID
 */
export function getCurrentConversationId(): string | null {
  return currentConversationId;
}

/**
 * Set the current conversation ID
 */
export function setCurrentConversationId(id: string | null): void {
  currentConversationId = id;
}

/**
 * Add a transcript entry to the current conversation
 */
export async function addTranscriptEntry(entry: TranscriptEntry): Promise<void> {
  const conversation = await getCurrentConversation();

  conversation.transcript.push(entry);
  conversation.updatedAt = Date.now();

  // Auto-generate title from first user message if still default
  if (conversation.title === 'New Conversation' && entry.role === 'user') {
    conversation.title = generateTitle(conversation.transcript);
  }

  await saveConversation(conversation);
}

/**
 * List all conversations (sorted by most recent first)
 */
export async function listConversations(): Promise<ConversationSummary[]> {
  await ensureConversationsDir();

  const dir = getConversationsDir();

  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const summaries: ConversationSummary[] = [];

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(dir, file), 'utf8');
        const conversation = JSON.parse(content) as Conversation;
        summaries.push({
          id: conversation.id,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          messageCount: conversation.transcript.length,
        });
      } catch (err) {
        console.error('[CONVERSATIONS] Failed to read conversation file:', file, err);
      }
    }

    // Sort by most recently updated
    summaries.sort((a, b) => b.updatedAt - a.updatedAt);

    return summaries;
  } catch {
    return [];
  }
}

/**
 * Delete a conversation
 */
export async function deleteConversation(conversationId: string): Promise<boolean> {
  try {
    const filePath = getConversationPath(conversationId);
    await fs.unlink(filePath);

    // If this was the current conversation, clear it
    if (currentConversationId === conversationId) {
      currentConversationId = null;
    }

    console.log('[CONVERSATIONS] Deleted conversation:', conversationId);
    return true;
  } catch (err) {
    console.error('[CONVERSATIONS] Failed to delete conversation:', conversationId, err);
    return false;
  }
}

/**
 * Format conversation history for the OpenAI Realtime system prompt
 */
export function formatConversationHistory(conversation: Conversation): string {
  if (conversation.transcript.length === 0) {
    return '';
  }

  const lines = conversation.transcript.map(entry => {
    const role = entry.role === 'user' ? 'User' : 'Assistant';
    const time = new Date(entry.timestamp).toLocaleTimeString();
    return `[${time}] ${role}: ${entry.text}`;
  });

  return `Previous conversation (${conversation.title}):\n${lines.join('\n')}`;
}
