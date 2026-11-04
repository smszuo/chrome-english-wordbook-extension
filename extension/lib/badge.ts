// Save feedback on the toolbar icon: green check that clears itself, or a red "!" that stays
// until the popup is opened. Hovering the icon shows the message.
export async function showResult(ok: boolean, message: string) {
  await browser.action.setBadgeBackgroundColor({ color: ok ? "#15803d" : "#b91c1c" });
  await browser.action.setBadgeText({ text: ok ? "✓" : "!" });
  await browser.action.setTitle({ title: `English Wordbook: ${message}` });
  if (ok) setTimeout(() => void clearResult(), 3000);
}

export async function clearResult() {
  await browser.action.setBadgeText({ text: "" });
  await browser.action.setTitle({ title: "English Wordbook" });
}
