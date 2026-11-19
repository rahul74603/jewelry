// Some system print services only offer predefined sheets. For explicit roll
// export send the *already rendered snapshot*, never current settings or a
// second invoice calculation, to Android's vector PDF writer.
export type RollBlock = { kind: string; text: string; label?: string };
export function rollContent(root: HTMLElement) {
  const get = (s: string) =>
    root.querySelector<HTMLElement>(s)?.innerText.trim() ?? "";
  const blocks: RollBlock[] = [];
  const add = (kind: string, text: string, label?: string) => {
    if (text.trim())
      blocks.push({ kind, text: text.trim(), ...(label ? { label } : {}) });
  };
  add("brand", get(".receipt-brand h2"));
  root
    .querySelectorAll<HTMLElement>(".receipt-brand p")
    .forEach((p) => add("center", p.innerText));
  add("title", get(".paper-title h3"));
  add("text", get(".paper-title span"));
  root
    .querySelectorAll<HTMLElement>(".paper-info section,.advance-purpose")
    .forEach((section) => {
      const [title, ...fields] = Array.from(section.children) as HTMLElement[];
      add("section", title.innerText);
      fields.forEach((e) => add("text", e.innerText));
    });
  const rows = root.querySelectorAll<HTMLTableRowElement>(
    ".paper-items tbody tr",
  );
  if (rows.length) add("section", "Jewellery items");
  rows.forEach((row) =>
    Array.from(row.cells).forEach((c, i) => {
      if (i === 0) add("item", c.innerText);
      else add("row", c.innerText, c.dataset.label);
    }),
  );
  root.querySelectorAll<HTMLElement>(".receipt-totals section").forEach((s) => {
    add("section", s.querySelector("h3")!.innerText);
    s.querySelectorAll<HTMLElement>("dl>div").forEach((r) =>
      add(
        r.classList.contains("paper-total") ? "total" : "row",
        r.querySelector("dd")!.innerText,
        r.querySelector("dt")!.innerText,
      ),
    );
  });
  root
    .querySelectorAll<HTMLElement>(".paper-words,.paper-policy")
    .forEach((s) => {
      add("section", s.querySelector("h4")!.innerText);
      add("text", s.querySelector("p")!.innerText);
    });
  add("sign", get(".paper-sign"));
  add("footer", get(".paper-thanks"));
  const image = (s: string) =>
    root.querySelector<HTMLImageElement>(s)?.src ?? "";
  return {
    blocks,
    logo: image(".receipt-brand img:not(.approved-mark)"),
    mark: image(".approved-mark"),
  };
}
