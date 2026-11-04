// Cut the sentence that contains text[start, end) out of a paragraph.
// shortcut: splits on . ! ? only, so "e.g." or "Mr." ends a sentence early; use Intl.Segmenter if that matters.
export function cutSentence(text: string, start: number, end: number, maxLength = 1000): string {
  const before = text.slice(0, start);
  const from = before.search(/[.!?][^.!?]*$/) + 1; // -1 + 1 = 0 when no earlier boundary
  const afterEnd = text.slice(end).search(/[.!?]/);
  const to = afterEnd === -1 ? text.length : end + afterEnd + 1;
  return text.slice(from, to).replace(/\s+/g, " ").trim().slice(0, maxLength);
}

// Runs inside the web page via chrome.scripting.executeScript, so it must not use any outer variables.
export function readSelectionContext(): { text: string; start: number; end: number } | null {
  const sel = getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  let el: Element | null =
    range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  // Climb from inline elements (<a>, <b>, <span>) up to the containing block, e.g. <p>.
  while (el?.parentElement && getComputedStyle(el).display.startsWith("inline")) el = el.parentElement;
  if (!el) return null;
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { text: el.textContent ?? "", start, end: start + range.toString().length };
}
