/**
 * Pretty log formatters for Claude and Codex events.
 * Matches the frontend display style for consistency.
 */

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  bold: '\x1b[1m',
};

function shortenPath(filePath: string): string {
  if (!filePath) return '';
  const parts = filePath.split('/');
  if (parts.length <= 3) return filePath;
  return '.../' + parts.slice(-2).join('/');
}

function truncate(text: string, maxLen: number): string {
  if (!text) return '';
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

function getToolDetail(toolName: string, input: Record<string, unknown> | undefined): string {
  if (!input) return '';

  switch (toolName) {
    case 'Read':
      return input.file_path ? shortenPath(input.file_path as string) : '';
    case 'Write':
      return input.file_path ? shortenPath(input.file_path as string) : '';
    case 'Edit':
      return input.file_path ? shortenPath(input.file_path as string) : '';
    case 'Glob':
      return (input.pattern as string) || '';
    case 'Grep': {
      const pattern = input.pattern ? `"${input.pattern}"` : '';
      const glob = input.glob ? ` in ${input.glob}` : '';
      return pattern + glob;
    }
    case 'Bash': {
      const cmd = (input.command as string) || '';
      return truncate(cmd, 60);
    }
    case 'Task':
      return (input.description as string) || '';
    case 'WebFetch':
      return (input.url as string) || '';
    case 'WebSearch':
      return input.query ? `"${input.query}"` : '';
    default:
      return '';
  }
}

/**
 * Format a Claude message for console output
 */
export function formatClaudeMessage(message: Record<string, unknown>): string {
  const type = message.type as string;
  const lines: string[] = [];

  switch (type) {
    case 'user': {
      const content = (message.message as Record<string, unknown>)?.content as Array<{ type: string; text?: string }>;
      const text = content?.[0]?.text || '';
      lines.push(`${colors.cyan}[CLAUDE]${colors.reset} ${colors.blue}👤 User:${colors.reset} ${truncate(text, 200)}`);
      break;
    }

    case 'assistant': {
      const content = (message.message as Record<string, unknown>)?.content as Array<Record<string, unknown>>;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'text') {
            const text = block.text as string;
            lines.push(`${colors.cyan}[CLAUDE]${colors.reset} ${colors.green}🤖 Assistant:${colors.reset} ${truncate(text, 300)}`);
          } else if (block.type === 'tool_use') {
            const toolName = block.name as string;
            const toolInput = block.input as Record<string, unknown>;
            const detail = getToolDetail(toolName, toolInput);
            lines.push(`${colors.cyan}[CLAUDE]${colors.reset} ${colors.yellow}⚙️  Tool:${colors.reset} ${toolName}${detail ? ` ${colors.dim}→ ${detail}${colors.reset}` : ''}`);
          }
        }
      }
      break;
    }

    case 'tool': {
      const toolUseId = message.tool_use_id as string;
      const content = message.content as string;
      const truncated = truncate(content || '', 150);
      lines.push(`${colors.cyan}[CLAUDE]${colors.reset} ${colors.magenta}📤 Tool Result${colors.reset} ${colors.dim}(${toolUseId?.slice(0, 12)}...)${colors.reset}: ${truncated}`);
      break;
    }

    case 'result': {
      const result = message.result as string;
      lines.push(`${colors.cyan}[CLAUDE]${colors.reset} ${colors.green}✅ Result:${colors.reset} ${truncate(result || '', 300)}`);
      break;
    }

    default:
      lines.push(`${colors.cyan}[CLAUDE]${colors.reset} ${colors.dim}${type}${colors.reset}`);
  }

  return lines.join('\n');
}

/**
 * Format a Codex thread event for console output
 */
export function formatCodexEvent(event: Record<string, unknown>): string {
  const type = event.type as string;
  const item = event.item as Record<string, unknown> | undefined;
  const lines: string[] = [];

  switch (type) {
    case 'thread.started': {
      const threadId = event.thread_id as string;
      lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.green}🚀 Thread started${colors.reset} ${colors.dim}(${threadId?.slice(0, 12)}...)${colors.reset}`);
      break;
    }

    case 'turn.started':
      lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.blue}▶  Turn started${colors.reset}`);
      break;

    case 'turn.completed':
      lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.green}✓  Turn completed${colors.reset}`);
      break;

    case 'item.started': {
      if (item?.type === 'function_call') {
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.yellow}⚙️  Calling:${colors.reset} ${item.name || 'function'}`);
      } else if (item?.type === 'agent_message') {
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.blue}💭 Agent thinking...${colors.reset}`);
      } else if (item?.type === 'command_execution') {
        const cmd = (item.command as string) || 'command';
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.yellow}💻 Running:${colors.reset} ${truncate(cmd, 80)}`);
      } else {
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.dim}item.started: ${item?.type || 'unknown'}${colors.reset}`);
      }
      break;
    }

    case 'item.streaming': {
      if (item?.type === 'agent_message' && item.text) {
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.dim}💭 ${truncate(item.text as string, 100)}${colors.reset}`);
      }
      // Skip noisy streaming updates for other types
      break;
    }

    case 'item.completed': {
      if (item?.type === 'agent_message') {
        const text = (item.text as string) || '';
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.green}🤖 Agent:${colors.reset} ${truncate(text, 300)}`);
      } else if (item?.type === 'function_call') {
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.green}✅ ${item.name || 'function'}${colors.reset} completed`);
      } else if (item?.type === 'function_call_output') {
        const output = (item.output as string) || '';
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.magenta}📤 Output:${colors.reset} ${truncate(output, 200)}`);
      } else if (item?.type === 'reasoning') {
        const text = (item.text as string) || '';
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.blue}💭 Reasoning:${colors.reset} ${truncate(text, 200)}`);
      } else if (item?.type === 'command_execution') {
        const cmd = (item.command as string) || 'command';
        const exitCode = item.exit_code as number | null;
        const output = (item.aggregated_output as string) || '';
        const status = exitCode === 0 ? colors.green + '✅' : (exitCode === null ? colors.blue + 'ℹ️' : colors.red + '❌');
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${status}${colors.reset} ${cmd}`);
        if (output) {
          lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.dim}📤 ${truncate(output, 200)}${colors.reset}`);
        }
      } else {
        lines.push(`${colors.magenta}[CODEX]${colors.reset} ${colors.dim}item.completed: ${item?.type || 'unknown'}${colors.reset}`);
      }
      break;
    }

    default:
      // Skip unknown event types silently to reduce noise
      break;
  }

  return lines.filter(l => l).join('\n');
}
