import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/** 安全黑名单：含敏感内容的文件跳过 */
const SENSITIVE_PATTERNS = [
  '.env',
  'credentials',
  'secret',
  'cookie',
  'token',
  'moomoo-proxy/src/index.js', // 含 cookies
];

/** 包含的文件模式（glob） */
const INCLUDE_PATTERNS = [
  'docs/**/*.md',
  'api/src/services/**/*.ts',
  'api/src/routes/**/*.ts',
  'api/src/utils/**/*.ts',
  'api/src/config/**/*.ts',
  'api/src/middleware/**/*.ts',
  'api/migrations/**/*.sql',
  'CLAUDE.md',
  'PROJECT_STATUS.md',
  'CHANGELOG.md',
  'CODE_MAP.md',
  '.claude/agents/*.md',
  '.claude/teams/*.md',
];

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  lastModified: string;
}

/**
 * 扫描项目文件，遵守 .gitignore，排除敏感文件
 */
export function scanProjectFiles(projectRoot: string): ScannedFile[] {
  const files: ScannedFile[] = [];

  for (const pattern of INCLUDE_PATTERNS) {
    // 使用 git ls-files 来遵守 .gitignore
    try {
      const output = execSync(
        `git -c core.quotePath=false ls-files --cached --others --exclude-standard "${pattern}"`,
        { cwd: projectRoot, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
      ).trim();

      if (!output) continue;

      for (const relativePath of output.split('\n')) {
        if (!relativePath) continue;

        // 安全过滤
        if (isSensitive(relativePath)) continue;

        const absolutePath = path.join(projectRoot, relativePath);
        if (!fs.existsSync(absolutePath)) continue;

        const stat = fs.statSync(absolutePath);
        files.push({
          relativePath,
          absolutePath,
          lastModified: stat.mtime.toISOString(),
        });
      }
    } catch {
      // git ls-files 可能对某些 pattern 报错，跳过
    }
  }

  // 去重
  const seen = new Set<string>();
  return files.filter((f) => {
    if (seen.has(f.relativePath)) return false;
    seen.add(f.relativePath);
    return true;
  });
}

function isSensitive(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return SENSITIVE_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}
