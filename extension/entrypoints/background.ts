import { api, pageInfo, refreshHighlights } from "@/lib/api";
import { cutSentence, readSelectionContext } from "@/lib/sentence";
import { showResult } from "@/lib/badge";

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({ id: "add-word", title: 'Add "%s" to wordbook', contexts: ["selection"] });
    startHighlightRefresh();
  });
  browser.runtime.onStartup.addListener(startHighlightRefresh);
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "refresh-highlights") void refreshHighlights();
  });

  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "add-word" || !info.selectionText) return;

    // Pages like chrome://, the PDF viewer and the Web Store block scripts: save without a sentence.
    let sentence: string | undefined;
    if (tab?.id !== undefined) {
      try {
        const [res] = await browser.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
          func: readSelectionContext,
        });
        const ctx = res?.result;
        if (ctx) sentence = cutSentence(ctx.text, ctx.start, ctx.end) || undefined;
      } catch {
        // no sentence
      }
    }

    try {
      const word = await api.saveWord({ text: info.selectionText, sentence, ...pageInfo(tab) });
      await showResult(true, `Saved "${word.text}"`);
    } catch (e) {
      await showResult(false, (e as Error).message);
    }
  });
});

// Only on install and browser start: creating the alarm on every service-worker wake would
// reset its timer, so it might never fire.
function startHighlightRefresh() {
  void browser.alarms.create("refresh-highlights", { periodInMinutes: 30 });
  void refreshHighlights();
}
