import fs from 'node:fs/promises';
import path from 'node:path';
import type { ActiveTeamState } from './types.js';

export class StateManager {
  private statePath: string;

  constructor(projectRoot: string) {
    this.statePath = path.join(projectRoot, 'mcp-servers', 'role-memory', '.active-team.json');
  }

  async getActiveTeam(): Promise<ActiveTeamState | null> {
    try {
      const raw = await fs.readFile(this.statePath, 'utf-8');
      return JSON.parse(raw) as ActiveTeamState;
    } catch {
      return null;
    }
  }

  async setActiveTeam(name: string): Promise<ActiveTeamState> {
    const state: ActiveTeamState = {
      name,
      activatedAt: new Date().toISOString(),
    };
    await fs.writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
    return state;
  }

  async clearActiveTeam(): Promise<boolean> {
    try {
      await fs.unlink(this.statePath);
      return true;
    } catch {
      return false;
    }
  }
}
