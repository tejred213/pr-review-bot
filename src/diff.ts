/**
 * Minimal unified-diff (GitHub "patch") parser.
 *
 * GitHub only accepts an inline review comment if it targets a line that is part
 * of the diff. If we let the model comment on an arbitrary line, the ENTIRE
 * review request is rejected. So for each changed file we compute:
 *
 *  - `commentableLines`: the set of new-file line numbers the model may anchor a
 *    comment to (added `+` lines and unchanged context lines on the RIGHT side).
 *  - `annotated`: the hunk text re-rendered with real new-file line numbers, so
 *    the model can cite exact lines instead of guessing.
 */

export interface ParsedPatch {
  annotated: string;
  commentableLines: Set<number>;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatch(patch: string): ParsedPatch {
  const commentableLines = new Set<number>();
  const out: string[] = [];
  let newLine = 0;

  for (const line of patch.split("\n")) {
    const header = line.match(HUNK_HEADER);
    if (header) {
      newLine = Number(header[1]);
      out.push(line); // keep the @@ header for context
      continue;
    }

    const marker = line[0];
    const text = line.slice(1);

    if (marker === "+") {
      commentableLines.add(newLine);
      out.push(`${newLine}\t+ ${text}`);
      newLine++;
    } else if (marker === " ") {
      commentableLines.add(newLine);
      out.push(`${newLine}\t  ${text}`);
      newLine++;
    } else if (marker === "-") {
      // Removed line — no new-file line number, not commentable on RIGHT side.
      out.push(`\t- ${text}`);
    }
    // Anything else ("\ No newline at end of file", empty tail) is skipped.
  }

  return { annotated: out.join("\n"), commentableLines };
}
