#!/usr/bin/env node

/**
 * Zotero-Headless MCP Server
 *
 * Exposes a virtual filesystem tool over the Model Context Protocol (MCP).
 * AI clients (Claude Code, Cursor, etc.) can use the `zotero_shell` tool
 * to explore a Zotero library with shell commands.
 *
 * Usage:
 *   npx @zotero-headless/mcp-server
 *
 * MCP config (claude_desktop_config.json / .claude/settings.json):
 *   {
 *     "mcpServers": {
 *       "zotero": {
 *         "command": "npx",
 *         "args": ["@zotero-headless/mcp-server"],
 *         "env": {
 *           "ZOTERO_API_KEY": "your-api-key",
 *           "ZOTERO_USER_ID": "your-user-id"
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSession, TOOL_DEFINITION } from '@zotero-headless/virtual-fs';
import { z } from 'zod';

const server = new McpServer({
  name: 'zotero-headless',
  version: '1.0.0',
});

// One session per MCP connection (cwd persists across tool calls)
const session = createSession();

// Register the shell tool
server.tool(
  TOOL_DEFINITION.name,
  TOOL_DEFINITION.description,
  {
    command: z.string().describe('Shell command to execute against the Zotero virtual filesystem'),
  },
  async ({ command }) => {
    const result = await session.execute(command);
    const isError = result.exitCode !== 0;

    // Build output: stdout + stderr (if any). On error, always include exit code.
    const parts: string[] = [];
    if (result.stdout) parts.push(result.stdout);
    if (result.stderr) parts.push(isError ? `Error: ${result.stderr}` : result.stderr);
    if (isError && !result.stdout && !result.stderr) {
      parts.push(`Command failed with exit code ${result.exitCode}`);
    }

    return {
      content: [{
        type: 'text' as const,
        text: parts.join('\n') || '(no output)',
      }],
      isError,
    };
  },
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
