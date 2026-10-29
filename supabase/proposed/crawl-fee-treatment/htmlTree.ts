// PROPOSED, NOT DEPLOYED. A small, dependency-free HTML element tree for the
// price-stack reader: element ranges over the raw page, so a price can be
// attributed to the page component that contains it rather than to whatever
// VIN happens to be nearest in the text. Tolerant of unclosed tags; it never
// throws on malformed markup.

export interface El {
  tag: string;
  attrs: string;
  start: number;
  /** Exclusive end, after the closing tag (or the page end when unclosed). */
  end: number;
  parent: El | null;
  children: El[];
}

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

export function parseTree(html: string): El {
  const root: El = { tag: "#root", attrs: "", start: 0, end: html.length, parent: null, children: [] };
  const open: El[] = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (closing) {
      const i = open.map((e) => e.tag).lastIndexOf(tag);
      if (i <= 0) continue;
      while (open.length > i) {
        const e = open.pop() as El;
        e.end = re.lastIndex;
      }
      continue;
    }
    const parent = open[open.length - 1];
    const el: El = { tag, attrs: m[3] ?? "", start: m.index, end: html.length, parent, children: [] };
    parent.children.push(el);
    if (VOID.has(tag) || /\/\s*$/.test(m[3] ?? "")) { el.end = re.lastIndex; continue; }
    if (RAW_TEXT.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, "ig");
      close.lastIndex = re.lastIndex;
      const c = close.exec(html);
      el.end = c ? close.lastIndex : html.length;
      re.lastIndex = el.end;
      continue;
    }
    open.push(el);
  }
  return root;
}

/** The deepest element whose range contains `pos`. */
export function deepestAt(root: El, pos: number): El {
  let cur = root;
  for (;;) {
    const next = cur.children.find((c) => c.start <= pos && pos < c.end);
    if (!next) return cur;
    cur = next;
  }
}

export const ancestorsOf = (el: El): El[] => {
  const out: El[] = [];
  for (let e: El | null = el; e; e = e.parent) out.push(e);
  return out;
};

export const contains = (outer: El, inner: El) => outer.start <= inner.start && inner.end <= outer.end;
