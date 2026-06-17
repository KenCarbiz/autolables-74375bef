// html2canvas renders <input>/<select>/<textarea> text on the wrong baseline
// and clips it at the bottom of the generated PDF. Use this as the html2canvas
// `onclone` callback: it replaces each field in the CLONED document with a
// plain <div> carrying the same classes + the field's value, so the text flows
// normally. Checkbox/radio inputs and <canvas> (signatures) are left untouched.
export function replaceInputsForCanvas(doc: Document) {
  const swap = (el: Element, text: string) => {
    const d = doc.createElement("div");
    d.textContent = text;
    d.className = (el as HTMLElement).className;
    d.setAttribute(
      "style",
      `${el.getAttribute("style") || ""};white-space:pre-wrap;display:flex;align-items:center;`,
    );
    el.parentNode?.replaceChild(d, el);
  };
  doc.querySelectorAll("input").forEach((el) => {
    const i = el as HTMLInputElement;
    if (i.type === "checkbox" || i.type === "radio") return;
    swap(i, i.value || "");
  });
  doc.querySelectorAll("textarea").forEach((el) => swap(el, (el as HTMLTextAreaElement).value || ""));
  doc.querySelectorAll("select").forEach((el) => {
    const s = el as HTMLSelectElement;
    const o = s.options[s.selectedIndex];
    swap(el, o ? o.text : "");
  });
}
