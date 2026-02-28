import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { parseTeamMembers } from './parser.js';
import type { TeamDefinition, TeamSummary } from './types.js';

export class TeamManager {
  private teamsDir: string;

  constructor(projectRoot: string) {
    this.teamsDir = path.join(projectRoot, '.claude', 'teams');
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.teamsDir, { recursive: true });
  }

  async listTeams(): Promise<TeamSummary[]> {
    await this.ensureDir();
    const files = await fs.readdir(this.teamsDir);
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    const summaries: TeamSummary[] = [];
    for (const file of mdFiles) {
      const filePath = path.join(this.teamsDir, file);
      const raw = await fs.readFile(filePath, 'utf-8');
      const { data } = matter(raw);
      summaries.push({
        name: (data.name as string) || path.basename(file, '.md'),
        description: (data.description as string) || '',
      });
    }

    return summaries;
  }

  async getTeam(name: string): Promise<TeamDefinition | null> {
    const filePath = path.join(this.teamsDir, `${name}.md`);
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const { data, content } = matter(raw);
      const members = parseTeamMembers(content);
      return {
        name: (data.name as string) || name,
        description: (data.description as string) || '',
        content: raw,
        members,
      };
    } catch {
      return null;
    }
  }

  async saveTeam(name: string, content: string): Promise<void> {
    await this.ensureDir();
    const filePath = path.join(this.teamsDir, `${name}.md`);
    await fs.writeFile(filePath, content, 'utf-8');
  }

  async deleteTeam(name: string): Promise<boolean> {
    const filePath = path.join(this.teamsDir, `${name}.md`);
    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
