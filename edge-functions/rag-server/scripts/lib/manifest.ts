import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const MANIFEST_FILE = '.index-manifest.json';

interface ManifestEntry {
  hash: string;
  indexed_at: string;
  chunk_count: number;
}

type Manifest = Record<string, ManifestEntry>;

/**
 * 增量索引清单管理
 * 追踪每个文件的 SHA-256 hash，只索引变更文件
 */
export class IndexManifest {
  private manifestPath: string;
  private manifest: Manifest;

  constructor(projectRoot: string) {
    this.manifestPath = path.join(projectRoot, 'edge-functions', 'rag-server', MANIFEST_FILE);
    this.manifest = this.load();
  }

  /** 检查文件是否需要重新索引 */
  needsReindex(filePath: string, fileContent: string): boolean {
    const hash = this.computeHash(fileContent);
    const entry = this.manifest[filePath];
    return !entry || entry.hash !== hash;
  }

  /** 标记文件已索引 */
  markIndexed(filePath: string, fileContent: string, chunkCount: number): void {
    this.manifest[filePath] = {
      hash: this.computeHash(fileContent),
      indexed_at: new Date().toISOString(),
      chunk_count: chunkCount,
    };
  }

  /** 获取已索引但当前不存在的文件列表（需要清理） */
  getStaleFiles(currentFiles: Set<string>): string[] {
    return Object.keys(this.manifest).filter((f) => !currentFiles.has(f));
  }

  /** 移除文件记录 */
  remove(filePath: string): void {
    delete this.manifest[filePath];
  }

  /** 保存清单到磁盘 */
  save(): void {
    const dir = path.dirname(this.manifestPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  /** 清空清单（全量重建用） */
  clear(): void {
    this.manifest = {};
  }

  /** 获取统计 */
  stats(): { files: number; totalChunks: number } {
    const files = Object.keys(this.manifest).length;
    const totalChunks = Object.values(this.manifest).reduce((sum, e) => sum + e.chunk_count, 0);
    return { files, totalChunks };
  }

  private load(): Manifest {
    try {
      if (fs.existsSync(this.manifestPath)) {
        return JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
      }
    } catch {
      // corrupt manifest, start fresh
    }
    return {};
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}
