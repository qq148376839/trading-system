import type { TeamMember } from './types.js';

/**
 * Parse team members from the "# Team Structure" section of a team markdown file.
 *
 * Extracts members from patterns like:
 *   - **@Options-Scientist**: description...
 *   - **Lead (你)**: description...
 *   1. **@Backend-Quant-Integrator**: description...
 */
export function parseTeamMembers(content: string): TeamMember[] {
  const members: TeamMember[] = [];

  // Find the "Team Structure" section
  const sectionRegex = /^#\s+Team\s+Structure\b/im;
  const sectionMatch = sectionRegex.exec(content);
  if (!sectionMatch) {
    return members;
  }

  // Extract content from Team Structure section until the next heading
  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const nextHeadingRegex = /^#\s+/m;
  const remainingContent = content.slice(sectionStart);
  const nextHeading = nextHeadingRegex.exec(remainingContent);
  const sectionContent = nextHeading
    ? remainingContent.slice(0, nextHeading.index)
    : remainingContent;

  // Parse list items with bold member names
  // Matches: "- **@Name**: desc" or "1. **Name (你)**: desc" or "- **Name**: desc"
  const memberRegex = /(?:^|\n)\s*(?:\d+\.\s*|-\s*)\*\*@?([\w-]+(?:\s*\([^)]*\))?)\*\*[：:]\s*(.*)/g;
  let match: RegExpExecArray | null;

  while ((match = memberRegex.exec(sectionContent)) !== null) {
    const rawName = match[1].trim();
    // Remove parenthetical like "(你)" for the member name key
    const name = rawName.replace(/\s*\([^)]*\)$/, '').trim();
    const description = match[2].trim();
    members.push({ name, description });
  }

  return members;
}

/**
 * Extract a specific section from markdown content by heading.
 */
export function extractSection(content: string, heading: string): string | null {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sectionRegex = new RegExp(`^(#+)\\s+${escapedHeading}\\b[^\n]*\n`, 'im');
  const sectionMatch = sectionRegex.exec(content);
  if (!sectionMatch) {
    return null;
  }

  const level = sectionMatch[1].length;
  const sectionStart = sectionMatch.index + sectionMatch[0].length;
  const remaining = content.slice(sectionStart);

  // Find next heading of same or higher level
  const nextHeadingRegex = new RegExp(`^#{1,${level}}\\s+`, 'm');
  const nextHeading = nextHeadingRegex.exec(remaining);
  const sectionContent = nextHeading
    ? remaining.slice(0, nextHeading.index)
    : remaining;

  return sectionContent.trim();
}
