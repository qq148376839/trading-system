#!/usr/bin/env tsx
/**
 * 项目索引脚本 — 将代码库内容索引到 RAG 系统
 *
 * 用法:
 *   npx tsx scripts/index-project.ts          # 增量索引（只处理变更文件）
 *   npx tsx scripts/index-project.ts --full   # 全量重建
 *   npx tsx scripts/index-project.ts --file <path>  # 索引单个文件
 */

import * as fs from 'fs';
import * as path from 'path';
import { scanProjectFiles } from './lib/file-scanner';
import { IndexManifest } from './lib/manifest';
import { ApiClient } from './lib/api-client';
import { chunkMarkdown } from './lib/chunkers/markdown-chunker';
import { chunkTypeScript } from './lib/chunkers/typescript-chunker';
import { chunkSQL } from './lib/chunkers/sql-chunker';
import type { ChunkInput, ChunkType } from '../src/lib/types';

// ─── 配置 ───
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');
const RAG_URL = process.env.RAG_URL || 'https://rag.riowang.win';
const RAG_TOKEN = process.env.RAG_API_TOKEN;

if (!RAG_TOKEN) {
  console.error('Error: RAG_API_TOKEN environment variable is required');
  process.exit(1);
}

// ─── CLI 参数解析 ───
const args = process.argv.slice(2);
const isFullRebuild = args.includes('--full');
const fileArgIdx = args.indexOf('--file');
const singleFile = fileArgIdx >= 0 ? args[fileArgIdx + 1] : undefined;

async function main() {
  const client = new ApiClient(RAG_URL, RAG_TOKEN!);
  const manifest = new IndexManifest(PROJECT_ROOT);

  console.log(`RAG Indexer — ${isFullRebuild ? 'FULL rebuild' : singleFile ? `single file: ${singleFile}` : 'incremental'}`);
  console.log(`Target: ${RAG_URL}`);
  console.log(`Project: ${PROJECT_ROOT}`);

  // 全量重建：清空 manifest
  if (isFullRebuild) {
    manifest.clear();
    console.log('Manifest cleared for full rebuild');
  }

  // 扫描文件
  let files = scanProjectFiles(PROJECT_ROOT);
  console.log(`Scanned ${files.length} files`);

  // 单文件模式
  if (singleFile) {
    files = files.filter((f) => f.relativePath === singleFile);
    if (files.length === 0) {
      console.error(`File not found in scan: ${singleFile}`);
      process.exit(1);
    }
  }

  // 统计
  let indexed = 0;
  let skipped = 0;
  let failed = 0;
  let totalChunks = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(file.absolutePath, 'utf-8');

      // 增量检查
      if (!isFullRebuild && !manifest.needsReindex(file.relativePath, content)) {
        skipped++;
        continue;
      }

      // 分块
      const chunks = chunkFile(content, file.relativePath, file.lastModified);
      if (chunks.length === 0) {
        skipped++;
        continue;
      }

      // 先删除旧数据
      try {
        await client.deleteFile(file.relativePath);
      } catch {
        // 首次索引时可能没有旧数据
      }

      // 索引
      const result = await client.indexChunks(chunks);
      manifest.markIndexed(file.relativePath, content, result.total);
      indexed++;
      totalChunks += result.total;

      console.log(`  ✓ ${file.relativePath}: ${result.total} chunks (${result.batches} batches)`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${file.relativePath}: ${(err as Error).message}`);
    }
  }

  // 清理已删除的文件
  if (!singleFile) {
    const currentFiles = new Set(files.map((f) => f.relativePath));
    const staleFiles = manifest.getStaleFiles(currentFiles);
    for (const staleFile of staleFiles) {
      try {
        await client.deleteFile(staleFile);
        manifest.remove(staleFile);
        console.log(`  🗑 Removed stale: ${staleFile}`);
      } catch (err) {
        console.warn(`  ⚠ Failed to remove stale ${staleFile}: ${(err as Error).message}`);
      }
    }
  }

  // 保存 manifest
  manifest.save();

  // 汇总
  const stats = manifest.stats();
  console.log('\n─── Summary ───');
  console.log(`Files: ${indexed} indexed, ${skipped} skipped, ${failed} failed`);
  console.log(`Chunks: ${totalChunks} new/updated`);
  console.log(`Manifest: ${stats.files} files, ${stats.totalChunks} total chunks`);
}

/** 根据文件类型选择分块器 */
function chunkFile(content: string, filePath: string, lastModified: string): ChunkInput[] {
  const ext = path.extname(filePath).toLowerCase();
  const chunkType = getChunkType(filePath);

  switch (ext) {
    case '.md':
      return chunkMarkdown(content, filePath, chunkType, lastModified);
    case '.ts':
      return chunkTypeScript(content, filePath, chunkType, lastModified);
    case '.sql':
      return chunkSQL(content, filePath, lastModified);
    default:
      // 未知类型：整体作为一个 chunk
      return [{
        id: `${filePath}::0`,
        content,
        file_path: filePath,
        chunk_type: chunkType,
        last_modified: lastModified,
      }];
  }
}

/** 根据文件路径确定 chunk 类型 */
function getChunkType(filePath: string): ChunkType {
  // Navigation files
  if (['CLAUDE.md', 'PROJECT_STATUS.md', 'CHANGELOG.md', 'CODE_MAP.md'].includes(path.basename(filePath))) {
    return 'nav';
  }

  // Config files
  if (filePath.includes('config/') || filePath.endsWith('.config.ts')) {
    return 'config';
  }

  // SQL migrations
  if (filePath.endsWith('.sql')) {
    return 'sql';
  }

  // TypeScript code
  if (filePath.endsWith('.ts')) {
    return 'code';
  }

  // Everything else (mostly markdown docs)
  return 'docs';
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
