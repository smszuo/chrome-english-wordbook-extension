import type { HighlightWord } from "@wordbook/shared";
import { buildPattern, hintText, normalize, splitMatches } from "@/lib/highlight";

const CLASS = "wordbook-hl";
// Never change text inside these: editors and code would break, and our own marks are already done.
const SKIP = `script, style, noscript, textarea, input, select, code, pre, svg, mark.${CLASS}`;
const skipped = (el: Element) => el.matches(SKIP) || (el as HTMLElement).isContentEditable === true;

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  main() {
    if (!document.body) return; // e.g. raw XML pages
    let pattern: RegExp | null = null;
    let hints = new Map<string, string>();

    const style = document.createElement("style");
    // Fixed dark text on yellow keeps contrast on both light and dark sites.
    style.textContent = `mark.${CLASS}{background:#fde68a!important;color:#111827!important;border-radius:2px;padding:0 1px}`;
    (document.head ?? document.documentElement).append(style);

    function scan(root: Node) {
      if (!pattern) return;
      const start = root instanceof Element ? root : root.parentElement;
      if (!start || start.closest(SKIP) || (start as HTMLElement).isContentEditable) return;

      const texts: Text[] = [];
      if (root instanceof Text) texts.push(root);
      else {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
          acceptNode: (n) =>
            n instanceof Element
              ? skipped(n)
                ? NodeFilter.FILTER_REJECT // skips the whole subtree
                : NodeFilter.FILTER_SKIP
              : NodeFilter.FILTER_ACCEPT,
        });
        while (walker.nextNode()) texts.push(walker.currentNode as Text);
      }

      // Collect first, then replace: changing nodes during the walk confuses the walker.
      for (const node of texts) {
        const parts = node.nodeValue ? splitMatches(node.nodeValue, pattern) : null;
        if (!parts) continue;
        node.replaceWith(
          ...parts.map((p) => {
            if (typeof p === "string") return p;
            const mark = document.createElement("mark");
            mark.className = CLASS;
            mark.textContent = p.match;
            mark.title = hints.get(normalize(p.match)) ?? "In your wordbook";
            return mark;
          }),
        );
      }
    }

    function clear() {
      for (const mark of document.querySelectorAll(`mark.${CLASS}`)) {
        const parent = mark.parentNode;
        mark.replaceWith(mark.textContent ?? "");
        parent?.normalize(); // merge the split text nodes back together
      }
    }

    // Our own DOM changes must not trigger the observer, so pause it while we change the page.
    // New page content is scanned at most once every 500 ms.
    let pending: Node[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    function queue(records: MutationRecord[]) {
      for (const r of records) pending.push(...r.addedNodes);
      if (pending.length) timer ??= setTimeout(flush, 500);
    }
    function flush() {
      timer = undefined;
      const nodes = pending;
      pending = [];
      change(() => nodes.forEach((n) => n.isConnected && scan(n)));
    }
    const observer = new MutationObserver(queue);
    function change(fn: () => void) {
      queue(observer.takeRecords()); // keep page changes that are not delivered yet
      observer.disconnect();
      fn();
      observer.observe(document.body, { childList: true, subtree: true });
    }

    async function load() {
      const { highlightWords = [] } = (await browser.storage.local.get("highlightWords")) as {
        highlightWords?: HighlightWord[];
      };
      hints = new Map(highlightWords.map((w) => [w.text, hintText(w)]));
      pattern = buildPattern(highlightWords.map((w) => w.text));
      change(() => {
        clear();
        scan(document.body);
      });
    }

    browser.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.highlightWords) void load();
    });
    void load();
  },
});
