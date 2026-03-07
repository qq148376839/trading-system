import type { ChunkInput, ChunkType } from '../../../src/lib/types';

const MAX_CHUNK_CHARS = 6000; // ~2000 tokens
const MIN_CHUNK_CHARS = 100;

/**
 * TypeScript 分块器
 * - 按函数/类边界分块
 * - 每个 chunk 包含 import 头作为类型上下文
 * - 超长函数按空行子分块
 */
export function chunkTypeScript(
  content: string,
  filePath: string,
  chunkType: ChunkType,
  lastModified?: string,
): ChunkInput[] {
  const lines = content.split('\n');
  const chunks: ChunkInput[] = [];
  let chunkIndex = 0;

  // 提取 import 块
  const importBlock = extractImportBlock(lines);

  // 寻找函数/类/接口边界
  const boundaries = findBoundaries(lines);

  if (boundaries.length === 0) {
    // 没有找到函数边界，整体作为一个 chunk
    if (content.length > MAX_CHUNK_CHARS) {
      const parts = splitByLines(content, MAX_CHUNK_CHARS);
      for (const part of parts) {
        chunks.push(makeChunk(filePath, chunkIndex++, part, chunkType, undefined, lastModified));
      }
    } else {
      chunks.push(makeChunk(filePath, chunkIndex++, content, chunkType, undefined, lastModified));
    }
    return chunks;
  }

  // 处理 import 块之后、第一个函数之前的代码（常量、类型定义等）
  const firstBoundary = boundaries[0];
  if (firstBoundary.startLine > 0) {
    const preamble = lines.slice(0, firstBoundary.startLine).join('\n').trim();
    if (preamble.length > MIN_CHUNK_CHARS) {
      chunks.push(makeChunk(filePath, chunkIndex++, preamble, chunkType, undefined, lastModified));
    }
  }

  // 按边界分块
  for (const boundary of boundaries) {
    const blockLines = lines.slice(boundary.startLine, boundary.endLine + 1);
    let blockContent = blockLines.join('\n');

    // 如果 chunk 不含 import 且有 importBlock，添加简化的 import 上下文
    if (importBlock && !blockContent.includes('import ')) {
      blockContent = `// [imports from ${filePath}]\n${importBlock}\n\n${blockContent}`;
    }

    if (blockContent.length <= MAX_CHUNK_CHARS) {
      chunks.push(makeChunk(filePath, chunkIndex++, blockContent, chunkType, boundary.name, lastModified));
    } else {
      // 超长函数：按空行子分块
      const parts = splitByLines(blockContent, MAX_CHUNK_CHARS);
      for (const part of parts) {
        chunks.push(makeChunk(filePath, chunkIndex++, part, chunkType, boundary.name, lastModified));
      }
    }
  }

  return chunks;
}

interface Boundary {
  name: string;
  startLine: number;
  endLine: number;
}

function findBoundaries(lines: string[]): Boundary[] {
  const boundaries: Boundary[] = [];

  // 正则匹配函数/类/接口声明
  const patterns = [
    /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
    /^(?:export\s+)?class\s+(\w+)/,
    /^(?:export\s+)?interface\s+(\w+)/,
    /^(?:export\s+)?type\s+(\w+)\s*=/,
    /^(?:export\s+)?const\s+(\w+)\s*(?::\s*\S+\s*)?=\s*(?:async\s+)?\(/,
    /^(?:export\s+)?const\s+(\w+)\s*(?::\s*\S+\s*)?=\s*(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    // 跳过 import 行
    if (trimmed.startsWith('import ')) continue;

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const name = match[1];
        const endLine = findBlockEnd(lines, i);
        boundaries.push({ name, startLine: i, endLine });

        // 检查前一行是否是注释/装饰器，往前扩展
        let commentStart = i;
        while (commentStart > 0) {
          const prevLine = lines[commentStart - 1].trim();
          if (prevLine.startsWith('//') || prevLine.startsWith('*') || prevLine.startsWith('/*') || prevLine.startsWith('@') || prevLine === '') {
            commentStart--;
          } else {
            break;
          }
        }
        if (commentStart < i) {
          boundaries[boundaries.length - 1].startLine = commentStart;
        }

        // 跳到块结束
        i = endLine;
        break;
      }
    }
  }

  return boundaries;
}

function findBlockEnd(lines: string[], startLine: number): number {
  let depth = 0;
  let foundOpen = false;

  for (let i = startLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') {
        depth++;
        foundOpen = true;
      } else if (ch === '}') {
        depth--;
        if (foundOpen && depth === 0) {
          return i;
        }
      }
    }
  }

  // 没有大括号（可能是 type alias 或单行 export）
  // 找到下一个空行或文件末尾
  for (let i = startLine + 1; i < lines.length; i++) {
    if (lines[i].trim() === '' && i > startLine + 1) {
      return i - 1;
    }
  }

  return lines.length - 1;
}

function extractImportBlock(lines: string[]): string | null {
  const importLines: string[] = [];
  for (const line of lines) {
    if (line.trimStart().startsWith('import ') || (importLines.length > 0 && line.trimStart().startsWith('}'))) {
      importLines.push(line);
    } else if (importLines.length > 0 && !line.trim()) {
      // import 块后的空行，停止
      break;
    } else if (importLines.length > 0) {
      // import 块中的续行
      importLines.push(line);
    }
  }

  if (importLines.length === 0) return null;

  // 简化：只保留前 10 行 import
  const simplified = importLines.slice(0, 10);
  if (importLines.length > 10) {
    simplified.push(`// ... ${importLines.length - 10} more imports`);
  }

  return simplified.join('\n');
}

function splitByLines(text: string, maxChars: number): string[] {
  const lines = text.split('\n');
  const parts: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  for (const line of lines) {
    if (currentLen + line.length + 1 > maxChars && current.length > 0) {
      parts.push(current.join('\n'));
      current = [line];
      currentLen = line.length;
    } else {
      current.push(line);
      currentLen += line.length + 1;
    }
  }

  if (current.length > 0) {
    parts.push(current.join('\n'));
  }

  return parts;
}

function makeChunk(
  filePath: string,
  index: number,
  content: string,
  chunkType: ChunkType,
  symbolName?: string,
  lastModified?: string,
): ChunkInput {
  return {
    id: `${filePath}::${index}`,
    content,
    file_path: filePath,
    chunk_type: chunkType,
    symbol_name: symbolName,
    last_modified: lastModified,
  };
}
