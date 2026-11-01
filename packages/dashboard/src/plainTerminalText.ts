/** Render terminal output as text, keeping labels and line breaks. */
export function plainTerminalText(text: string): string {
  return text
    // OSC sequences include terminal titles and hyperlink wrappers.
    .replace(/(?:\u001b\]|\u009d)[\s\S]*?(?:\u0007|\u001b\\|\u009c)/g, "")
    // CSI sequences include colors, cursor movement, and erase commands.
    .replace(/(?:\u001b\[|\u009b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[ -/]*[@-Z\\-_]/g, "");
}
