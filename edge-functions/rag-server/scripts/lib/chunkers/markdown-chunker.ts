import type { ChunkInput, ChunkType } from '../../../src/lib/types';

const MAX_CHUNK_TOKENS_APPROX = 2000;
// 粗略估算: 1 token ≈ 3 chars (中英混合)
const CHARS_PER_TOKEN = 3;
const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS_APPROX * CHARS_PER_TOKEN;

interface MarkdownSection {
  title: string;
  level: number;
  content: string;
}

/**
 * Markdown 分块器
 * - 按 ## 标题分块
 * - 超长节按 ### 子标题再分
 * - CLAUDE.md 错误规则按 `### 规则` 单独分块
 */
export function chunkMarkdown(
  content: string,
  filePath: string,
  chunkType: ChunkType,
  lastModified?: string,
): ChunkInput[] {
  const sections = splitBySections(content);
  const chunks: ChunkInput[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sectionText = section.title
      ? `${'#'.repeat(section.level)} ${section.title}\n\n${section.content}`
      : section.content;

    if (sectionText.length <= MAX_CHUNK_CHARS) {
      chunks.push(makeChunk(filePath, chunkIndex++, sectionText, chunkType, section.title, lastModified));
    } else {
      // 超长节：尝试按 ### 子标题分割
      const subSections = splitBySubSections(sectionText, section.level + 1);
      for (const sub of subSections) {
        const subText = sub.title
          ? `${'#'.repeat(sub.level)} ${sub.title}\n\n${sub.content}`
          : sub.content;

        if (subText.length <= MAX_CHUNK_CHARS) {
          chunks.push(makeChunk(filePath, chunkIndex++, subText, chunkType, sub.title || section.title, lastModified));
        } else {
          // 仍然超长：按段落硬分割
          const parts = splitByParagraphs(subText, MAX_CHUNK_CHARS);
          for (const part of parts) {
            chunks.push(makeChunk(filePath, chunkIndex++, part, chunkType, sub.title || section.title, lastModified));
          }
        }
      }
    }
  }

  return chunks;
}

function splitBySections(content: string): MarkdownSection[] {
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];
  let currentTitle = '';
  let currentLevel = 0;
  let currentLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch && headingMatch[1].length <= 2) {
      // 遇到 # 或 ## 标题，保存当前节
      if (currentLines.length > 0 || currentTitle) {
        sections.push({
          title: currentTitle,
          level: currentLevel,
          content: currentLines.join('\n').trim(),
        });
      }
      currentLevel = headingMatch[1].length;
      currentTitle = headingMatch[2].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // 最后一节
  if (currentLines.length > 0 || currentTitle) {
    sections.push({
      title: currentTitle,
      level: currentLevel || 1,
      content: currentLines.join('\n').trim(),
    });
  }

  return sections;
}

function splitBySubSections(content: string, level: number): MarkdownSection[] {
  const marker = '#'.repeat(level) + ' ';
  const lines = content.split('\n');
  const sections: MarkdownSection[] = [];
  let currentTitle = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(marker)) {
      if (currentLines.length > 0 || currentTitle) {
        sections.push({ title: currentTitle, level, content: currentLines.join('\n').trim() });
      }
      currentTitle = line.slice(marker.length).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0 || currentTitle) {
    sections.push({ title: currentTitle, level, content: currentLines.join('\n').trim() });
  }

  return sections;
}

function splitByParagraphs(text: string, maxChars: number): string[] {
  const paragraphs = text.split(/\n\n+/);
  const parts: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 > maxChars && current.length > 0) {
      parts.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function makeChunk(
  filePath: string,
  index: number,
  content: string,
  chunkType: ChunkType,
  sectionTitle: string,
  lastModified?: string,
): ChunkInput {
  return {
    id: `${filePath}::${index}`,
    content,
    file_path: filePath,
    chunk_type: chunkType,
    section_title: sectionTitle,
    last_modified: lastModified,
  };
}
