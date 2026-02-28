import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { TeamManager } from './teams.js';
import { RoleManager } from './roles.js';
import { StateManager } from './state.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();

const teamManager = new TeamManager(PROJECT_ROOT);
const roleManager = new RoleManager(PROJECT_ROOT);
const stateManager = new StateManager(PROJECT_ROOT);

const server = new McpServer({
  name: 'rm',
  version: '1.0.0',
});

// ─── Team Management Tools ───

server.tool('list_teams', 'List all team configurations (name + description)', {}, async () => {
  const teams = await teamManager.listTeams();
  if (teams.length === 0) {
    return { content: [{ type: 'text', text: 'No teams found. Create one with save_team.' }] };
  }
  const text = teams.map((t) => `- **${t.name}**: ${t.description || '(no description)'}`).join('\n');
  return { content: [{ type: 'text', text }] };
});

server.tool(
  'get_team',
  'Get full Markdown definition of a team',
  { name: z.string().describe('Team name') },
  async ({ name }) => {
    const team = await teamManager.getTeam(name);
    if (!team) {
      return { content: [{ type: 'text', text: `Team "${name}" not found.` }], isError: true };
    }
    return { content: [{ type: 'text', text: team.content }] };
  },
);

server.tool(
  'activate_team',
  'Activate a team (persisted to .active-team.json)',
  { name: z.string().describe('Team name to activate') },
  async ({ name }) => {
    const team = await teamManager.getTeam(name);
    if (!team) {
      return { content: [{ type: 'text', text: `Team "${name}" not found.` }], isError: true };
    }
    const state = await stateManager.setActiveTeam(name);
    return {
      content: [
        { type: 'text', text: `Team "${name}" activated at ${state.activatedAt}.\n\n${team.content}` },
      ],
    };
  },
);

server.tool(
  'get_active_team',
  'Get the currently active team definition. Use this after context compression to recover identity.',
  {},
  async () => {
    const state = await stateManager.getActiveTeam();
    if (!state) {
      return { content: [{ type: 'text', text: 'No active team. Use activate_team to set one.' }] };
    }
    const team = await teamManager.getTeam(state.name);
    if (!team) {
      return {
        content: [
          { type: 'text', text: `Active team "${state.name}" file not found. It may have been deleted.` },
        ],
        isError: true,
      };
    }
    return { content: [{ type: 'text', text: team.content }] };
  },
);

server.tool('deactivate_team', 'Clear the active team', {}, async () => {
  const cleared = await stateManager.clearActiveTeam();
  return {
    content: [{ type: 'text', text: cleared ? 'Active team cleared.' : 'No active team to clear.' }],
  };
});

server.tool(
  'save_team',
  'Create or update a team configuration file',
  {
    name: z.string().describe('Team name (used as filename)'),
    content: z.string().describe('Full Markdown content including YAML front matter'),
  },
  async ({ name, content }) => {
    await teamManager.saveTeam(name, content);
    return { content: [{ type: 'text', text: `Team "${name}" saved to .claude/teams/${name}.md` }] };
  },
);

server.tool(
  'delete_team',
  'Delete a team configuration file',
  { name: z.string().describe('Team name to delete') },
  async ({ name }) => {
    // Clear active team if it matches
    const activeState = await stateManager.getActiveTeam();
    if (activeState?.name === name) {
      await stateManager.clearActiveTeam();
    }
    const deleted = await teamManager.deleteTeam(name);
    if (!deleted) {
      return { content: [{ type: 'text', text: `Team "${name}" not found.` }], isError: true };
    }
    return { content: [{ type: 'text', text: `Team "${name}" deleted.` }] };
  },
);

// ─── Team Member Tools ───

server.tool(
  'get_team_member',
  'Get a specific member definition from a team (defaults to active team)',
  {
    team: z.string().optional().describe('Team name (defaults to active team)'),
    member: z.string().describe('Member name to look up'),
  },
  async ({ team: teamName, member }) => {
    let resolvedTeamName = teamName;
    if (!resolvedTeamName) {
      const state = await stateManager.getActiveTeam();
      if (!state) {
        return { content: [{ type: 'text', text: 'No team specified and no active team.' }], isError: true };
      }
      resolvedTeamName = state.name;
    }

    const team = await teamManager.getTeam(resolvedTeamName);
    if (!team) {
      return { content: [{ type: 'text', text: `Team "${resolvedTeamName}" not found.` }], isError: true };
    }

    const found = team.members.find(
      (m) => m.name.toLowerCase() === member.toLowerCase(),
    );
    if (!found) {
      const available = team.members.map((m) => m.name).join(', ');
      return {
        content: [
          {
            type: 'text',
            text: `Member "${member}" not found in team "${resolvedTeamName}".\nAvailable members: ${available || '(none parsed)'}`,
          },
        ],
        isError: true,
      };
    }

    return { content: [{ type: 'text', text: `**@${found.name}**: ${found.description}` }] };
  },
);

server.tool(
  'list_team_members',
  'List all members of a team (defaults to active team)',
  {
    team: z.string().optional().describe('Team name (defaults to active team)'),
  },
  async ({ team: teamName }) => {
    let resolvedTeamName = teamName;
    if (!resolvedTeamName) {
      const state = await stateManager.getActiveTeam();
      if (!state) {
        return { content: [{ type: 'text', text: 'No team specified and no active team.' }], isError: true };
      }
      resolvedTeamName = state.name;
    }

    const team = await teamManager.getTeam(resolvedTeamName);
    if (!team) {
      return { content: [{ type: 'text', text: `Team "${resolvedTeamName}" not found.` }], isError: true };
    }

    if (team.members.length === 0) {
      return {
        content: [
          { type: 'text', text: `No members parsed from team "${resolvedTeamName}". Ensure it has a "# Team Structure" section.` },
        ],
      };
    }

    const text = team.members
      .map((m, i) => `${i + 1}. **@${m.name}**: ${m.description}`)
      .join('\n');
    return { content: [{ type: 'text', text: `Team "${resolvedTeamName}" members:\n\n${text}` }] };
  },
);

// ─── Role Tools ───

server.tool('list_roles', 'List all individual agent roles from .claude/agents/', {}, async () => {
  const roles = await roleManager.listRoles();
  if (roles.length === 0) {
    return { content: [{ type: 'text', text: 'No roles found in .claude/agents/.' }] };
  }
  const text = roles.map((r) => `- ${r.name}`).join('\n');
  return { content: [{ type: 'text', text }] };
});

server.tool(
  'get_role',
  'Get full definition of an individual agent role',
  { name: z.string().describe('Role name (without .md extension)') },
  async ({ name }) => {
    const role = await roleManager.getRole(name);
    if (!role) {
      return { content: [{ type: 'text', text: `Role "${name}" not found.` }], isError: true };
    }
    return { content: [{ type: 'text', text: role.content }] };
  },
);

// ─── Project Context Tool ───

server.tool('get_project_context', 'Get CLAUDE.md shared project context', {}, async () => {
  const claudeMdPath = path.join(PROJECT_ROOT, 'CLAUDE.md');
  try {
    const content = await fs.readFile(claudeMdPath, 'utf-8');
    return { content: [{ type: 'text', text: content }] };
  } catch {
    return { content: [{ type: 'text', text: 'CLAUDE.md not found.' }], isError: true };
  }
});

// ─── MCP Prompts (Slash Commands) ───

server.prompt(
  'who',
  'Who am I? Recover active team identity after context compression.',
  async () => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: [
            'Please call the `get_active_team` tool to retrieve the current active team definition.',
            'Then fully adopt the role and team structure described in the result.',
            'If no team is active, let me know.',
          ].join('\n'),
        },
      },
    ],
  }),
);

server.prompt(
  'switch',
  'Switch to a different team',
  { team: z.string().describe('Team name to switch to') },
  async ({ team }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Please call the \`activate_team\` tool with name="${team}".`,
            'Then fully adopt the role and team structure from the result.',
          ].join('\n'),
        },
      },
    ],
  }),
);

server.prompt(
  'new',
  'Create a new team and activate it',
  {
    name: z.string().describe('Team name'),
    content: z.string().describe('Full team Markdown definition'),
  },
  async ({ name, content }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: [
            `Please call the \`save_team\` tool with name="${name}" and the following content, then call \`activate_team\` with name="${name}".`,
            '',
            'Team content:',
            content,
          ].join('\n'),
        },
      },
    ],
  }),
);

// ─── Start Server ───

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Role Memory MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
