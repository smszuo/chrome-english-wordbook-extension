import "@/lib/style.css";
import type { Sighting, Word, WordStatus } from "@wordbook/shared";
import { api, getToken } from "@/lib/api";
import { h } from "@/lib/dom";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const list = $<HTMLUListElement>("list");
const search = $<HTMLInputElement>("search");
const status = $<HTMLSelectElement>("status");
const more = $<HTMLButtonElement>("more");
const PAGE = 50;
let offset = 0;

// Run an action and show its error; a 401 clears the token, so switch to the logged-out view.
async function run(fn: () => Promise<void>) {
  $("msg").textContent = "";
  try {
    await fn();
  } catch (err) {
    $("msg").textContent = (err as Error).message;
    if (!(await getToken())) showLoggedIn(false);
  }
}

function showLoggedIn(yes: boolean) {
  $("book").hidden = !yes;
  $("logged-out").hidden = yes;
}

async function load(reset: boolean) {
  if (reset) offset = 0;
  const res = await api.listWords({
    q: search.value,
    status: (status.value || undefined) as WordStatus | undefined,
    limit: PAGE,
    offset,
  });
  if (reset) list.replaceChildren();
  list.append(...res.words.map(wordItem));
  offset += res.words.length;
  $("count").textContent = `${res.total} ${res.total === 1 ? "word" : "words"}`;
  more.hidden = offset >= res.total;
}

function wordItem(w: Word): HTMLLIElement {
  const li: HTMLLIElement = h("li", { className: `word ${w.status}` });
  const replace = (next: Word) => li.replaceWith(wordItem(next));
  const nextStatus: WordStatus = w.status === "learning" ? "known" : "learning";

  const definition = w.definition
    ? h(
        "div",
        {},
        w.definition.phonetic ? h("span", { className: "muted" }, w.definition.phonetic) : null,
        ...w.definition.meanings.map((m) =>
          h("div", {}, h("em", {}, m.partOfSpeech), h("ol", {}, ...m.definitions.map((d) => h("li", {}, d)))),
        ),
      )
    : h("p", { className: "muted" }, "No definition found.");

  const note = h("textarea", { value: w.note, maxLength: 5000 });
  note.addEventListener("change", () =>
    run(async () => {
      await api.patchWord(w.id, { note: note.value });
    }),
  );

  const sightingsList = h("div", {});
  const details = h("details", {}, h("summary", {}, "Where I saw it"), sightingsList);
  details.addEventListener("toggle", () => {
    if (!details.open || sightingsList.childElementCount) return;
    void run(async () => {
      const full = await api.getWord(w.id);
      sightingsList.append(
        ...(full.sightings.length ? full.sightings.map(sightingItem) : [h("p", { className: "muted" }, "No pages saved.")]),
      );
    });
  });

  li.append(
    h(
      "div",
      { className: "row head" },
      h("h2", {}, w.text),
      h(
        "div",
        { className: "row" },
        h(
          "button",
          { type: "button", on: { click: () => run(async () => replace(await api.patchWord(w.id, { status: nextStatus }))) } },
          nextStatus === "known" ? "Mark as known" : "Mark as learning",
        ),
        h(
          "button",
          {
            type: "button",
            "aria-label": `Delete ${w.text}`,
            on: {
              click: () =>
                run(async () => {
                  if (!confirm(`Delete "${w.text}" and all its saved pages?`)) return;
                  await api.deleteWord(w.id);
                  li.remove();
                }),
            },
          },
          "Delete",
        ),
      ),
    ),
    definition,
    h("label", {}, "Note", note),
    details,
  );
  return li;
}

function sightingItem(s: Sighting): HTMLElement {
  const div = h(
    "div",
    { className: "sighting" },
    h("a", { href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.title || s.url),
    " ",
    h("span", { className: "muted" }, new Date(s.createdAt).toLocaleDateString()),
    s.sentence ? h("blockquote", {}, s.sentence) : null,
  );
  div.append(
    h(
      "button",
      {
        type: "button",
        className: "link",
        on: {
          click: () =>
            run(async () => {
              await api.deleteSighting(s.id);
              div.remove();
            }),
        },
      },
      "Remove this page",
    ),
  );
  return div;
}

let timer: ReturnType<typeof setTimeout> | undefined;
search.addEventListener("input", () => {
  clearTimeout(timer);
  timer = setTimeout(() => run(() => load(true)), 250);
});
status.addEventListener("change", () => run(() => load(true)));
more.addEventListener("click", () => run(() => load(false)));

void (async () => {
  const loggedIn = Boolean(await getToken());
  showLoggedIn(loggedIn);
  if (loggedIn) await run(() => load(true));
})();
