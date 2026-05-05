/**
 * Generate a unified diff between old and new text.
 * Returns a color-free unified diff string suitable for terminal display.
 */
export function unifiedDiff(oldStr, newStr, filepath = "file") {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  // If nothing changed
  if (oldStr === newStr) return `(no changes in ${filepath})`;

  // Find the single change region (common prefix + suffix)
  let start = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (start < minLen && oldLines[start] === newLines[start]) start++;

  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (
    oldEnd > start && newEnd > start &&
    oldLines[oldEnd - 1] === newLines[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }

  const contextLines = 3;

  // Expand start to include context
  const hunkStart = Math.max(0, start - contextLines);
  const oldCount = oldEnd - start;
  const newCount = newEnd - start;

  let output = `--- a/${filepath}\n+++ b/${filepath}\n`;
  output += `@@ -${start + 1},${oldEnd - start} +${start + 1},${newEnd - start} @@\n`;

  // Context before change
  for (let i = hunkStart; i < start; i++) {
    output += ` ${oldLines[i]}\n`;
  }

  // Removed lines
  for (let i = start; i < oldEnd; i++) {
    output += `-${oldLines[i]}\n`;
  }

  // Added lines
  for (let i = start; i < newEnd; i++) {
    output += `+${newLines[i]}\n`;
  }

  // Context after change
  for (let i = oldEnd; i < Math.min(oldLines.length, oldEnd + contextLines); i++) {
    output += ` ${oldLines[i]}\n`;
  }

  // Stats summary
  const added = Math.max(0, newEnd - oldEnd + (oldEnd === oldLines.length ? 0 : 0));
  const removed = Math.max(0, oldEnd - newEnd + (newEnd === newLines.length ? 0 : 0));
  const actualAdded = newCount;
  const actualRemoved = oldEnd - start;

  if (actualRemoved === 0 && actualAdded > 0) {
    output += `\n+${actualAdded} line(s) added`;
  } else if (actualAdded === 0 && actualRemoved > 0) {
    output += `\n-${actualRemoved} line(s) removed`;
  } else {
    output += `\n-${actualRemoved} +${actualAdded} line(s) changed`;
  }

  return output;
}
