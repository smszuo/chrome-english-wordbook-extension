// Tiny DOM helper. Text always goes in as text nodes, never as HTML, because page titles
// and sentences come from arbitrary websites.
type Props = Record<string, unknown> & { on?: Record<string, (e: Event) => void> };

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { on, ...attrs } = props;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k in el) (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, String(v));
  }
  for (const [event, fn] of Object.entries(on ?? {})) el.addEventListener(event, fn);
  for (const c of children) if (c) el.append(c);
  return el;
}
