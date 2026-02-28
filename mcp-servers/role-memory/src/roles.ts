import fs from 'node:fs/promises';
import path from 'node:path';
import type { RoleDefinition, RoleSummary } from './types.js';

export class RoleManager {
  private agentsDir: string;

  constructor(projectRoot: string) {
    this.agentsDir = path.join(projectRoot, '.claude', 'agents');
  }

  async listRoles(): Promise<RoleSummary[]> {
    try {
      const files = await fs.readdir(this.agentsDir);
      return files
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .map((f) => ({ name: path.basename(f, '.md') }));
    } catch {
      return [];
    }
  }

  async getRole(name: string): Promise<RoleDefinition | null> {
    const filePath = path.join(this.agentsDir, `${name}.md`);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return { name, content };
    } catch {
      return null;
    }
  }
}
