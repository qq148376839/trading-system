import type { ChunkInput, ChunkType } from '../../../src/lib/types';

const MAX_CHUNK_CHARS = 6000;

/**
 * SQL 分块器
 * - 按 CREATE TABLE / ALTER TABLE / DO $$ 块分割
 * - CREATE INDEX 归入对应 TABLE 的 chunk
 */
export function chunkSQL(
  content: string,
  filePath: string,
  lastModified?: string,
): ChunkInput[] {
  const chunks: ChunkInput[] = [];
  let chunkIndex = 0;
  const chunkType: ChunkType = 'sql';

  // 按 SQL 语句块分割
  const blocks = splitSQLBlocks(content);

  for (const block of blocks) {
    if (block.content.trim().length < 10) continue;

    if (block.content.length <= MAX_CHUNK_CHARS) {
      chunks.push({
        id: `${filePath}::${chunkIndex++}`,
        content: block.content,
        file_path: filePath,
        chunk_type: chunkType,
        symbol_name: block.tableName,
        last_modified: lastModified,
      });
    } else {
      // 超长块：按语句分割
      const parts = splitLongBlock(block.content, MAX_CHUNK_CHARS);
      for (const part of parts) {
        chunks.push({
          id: `${filePath}::${chunkIndex++}`,
          content: part,
          file_path: filePath,
          chunk_type: chunkType,
          symbol_name: block.tableName,
          last_modified: lastModified,
        });
      }
    }
  }

  return chunks;
}

interface SQLBlock {
  tableName?: string;
  content: string;
}

function splitSQLBlocks(content: string): SQLBlock[] {
  const blocks: SQLBlock[] = [];
  const lines = content.split('\n');
  let currentLines: string[] = [];
  let currentTable: string | undefined;

  const tablePattern = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/i;
  const alterPattern = /^ALTER\s+TABLE\s+(\w+)/i;
  const doBlockPattern = /^DO\s+\$\$/i;
  const indexPattern = /^CREATE\s+(?:UNIQUE\s+)?INDEX/i;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // 检查是否是新的 DDL 块开始
    const tableMatch = trimmed.match(tablePattern);
    const alterMatch = trimmed.match(alterPattern);
    const isDoBlock = doBlockPattern.test(trimmed);

    if ((tableMatch || alterMatch || isDoBlock) && currentLines.length > 0) {
      // 保存当前块（不含当前行）
      const blockContent = currentLines.join('\n').trim();
      if (blockContent) {
        blocks.push({ tableName: currentTable, content: blockContent });
      }
      currentLines = [lines[i]];
      currentTable = tableMatch?.[1] || alterMatch?.[1];
    } else if (indexPattern.test(trimmed) && !currentTable) {
      // 独立 index 块
      if (currentLines.length > 0) {
        blocks.push({ tableName: currentTable, content: currentLines.join('\n').trim() });
      }
      currentLines = [lines[i]];
      currentTable = undefined;
    } else {
      currentLines.push(lines[i]);
    }
  }

  // 最后一个块
  if (currentLines.length > 0) {
    const blockContent = currentLines.join('\n').trim();
    if (blockContent) {
      blocks.push({ tableName: currentTable, content: blockContent });
    }
  }

  return blocks;
}

function splitLongBlock(content: string, maxChars: number): string[] {
  // 按分号分割 SQL 语句
  const statements = content.split(/;\s*\n/);
  const parts: string[] = [];
  let current = '';

  for (const stmt of statements) {
    const stmtWithSemicolon = stmt.trim() ? stmt.trim() + ';' : '';
    if (!stmtWithSemicolon) continue;

    if (current.length + stmtWithSemicolon.length + 1 > maxChars && current) {
      parts.push(current);
      current = stmtWithSemicolon;
    } else {
      current += (current ? '\n' : '') + stmtWithSemicolon;
    }
  }

  if (current.trim()) {
    parts.push(current);
  }

  return parts;
}
