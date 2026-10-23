/// <reference lib="dom" />
// Runs inside the build page only: bundled by bundleDiagramPage() and injected as a classic script.

export function sanitiseSvg(svg: string): string {
  const SVG_NS = "http://www.w3.org/2000/svg";
  const HTML_NS = "http://www.w3.org/1999/xhtml";
  const SVG_TAGS = new Set(
    ("svg g path rect circle ellipse line polyline polygon text tspan textpath defs marker style title desc " +
      "lineargradient radialgradient stop clippath mask pattern symbol use foreignobject filter fedropshadow " +
      "feflood fegaussianblur feoffset feblend fecomposite femerge femergenode fecolormatrix").split(" "),
  );
  const HTML_TAGS = new Set("div span p br b i em strong code sub sup style".split(" "));
  // Elements whose contents are not label text; removed along with their children.
  const REMOVE_WITH_CONTENT = new Set(
    "script noscript template iframe object embed audio video img image link meta base math animate set".split(" "),
  );
  const DROP_ATTRS = new Set(["src", "srcset", "background", "action", "formaction", "poster", "data", "ping"]);

  // DOM attribute values and style text are already entity-decoded exactly once, and they are what the
  // browser's CSS parser will see after the output is reparsed. Each value is judged as-is and then
  // either emitted unchanged or dropped; nothing is ever transformed after it has been judged.
  // Backslashes are refused outright: CSS escapes would decode once more than we can safely emulate.
  const BLOCKED = /[<\\]|\/\/|\/\*|@import|@font-face|attr\(|image-set\(|cross-fade\(|image\(|element\(|paint\(|src\(/i;
  const FRAGMENT_URL = /url\((["']?)#[\w-]+\1\)/gi;
  const QUOTED = /"[^"]*"?|'[^']*'?/g;
  const SCHEME = /[a-z][a-z0-9+.-]*:/i;
  const cssOk = (text: string) =>
    !BLOCKED.test(text) &&
    !/url\(/i.test(text.replace(FRAGMENT_URL, "")) &&
    !(text.match(QUOTED) ?? []).some((q) => SCHEME.test(q));
  // Keeps each declaration/selector segment verbatim or drops it; the result must pass as a whole too.
  const scrubCss = (css: string) => {
    const kept = css.replace(/[^;{}]+/g, (seg) => (cssOk(seg) ? seg : ""));
    return cssOk(kept) ? kept : "";
  };
  // The value to emit for an attribute, or null to drop it.
  const attrValue = (name: string, value: string): string | null => {
    if (name === "xmlns" || name.startsWith("xmlns:")) return value;
    if (name.startsWith("on") || DROP_ATTRS.has(name)) return null;
    if (name === "href" || name.endsWith(":href")) return value.trim().startsWith("#") ? value : null;
    if (name === "style") return scrubCss(value) || null;
    return /^\s*[a-z][a-z0-9+.-]*:/i.test(value) || !cssOk(value) ? null : value;
  };

  const cleanAttrs = (el: Element) => {
    for (const attr of Array.from(el.attributes)) {
      const value = attrValue(attr.name.toLowerCase(), attr.value);
      if (value === null) el.removeAttribute(attr.name);
      else if (value !== attr.value) el.setAttribute(attr.name, value);
    }
  };

  // Allowlist walk: anything not known to be inert label/diagram markup is unwrapped or removed.
  const clean = (parent: Node, inForeign: boolean) => {
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === 3) continue;
      if (node.nodeType !== 1) {
        node.parentNode?.removeChild(node);
        continue;
      }
      const el = node as Element;
      const tag = el.localName.toLowerCase();
      const ok =
        (el.namespaceURI === SVG_NS && SVG_TAGS.has(tag)) ||
        (el.namespaceURI === HTML_NS && inForeign && HTML_TAGS.has(tag));
      if (ok) {
        cleanAttrs(el);
        if (tag === "style") el.textContent = scrubCss(el.textContent ?? "");
        else clean(el, inForeign || (el.namespaceURI === SVG_NS && tag === "foreignobject"));
      } else if (REMOVE_WITH_CONTENT.has(tag)) {
        el.remove();
      } else {
        clean(el, inForeign);
        el.replaceWith(...Array.from(el.childNodes));
      }
    }
  };
  const doc = new DOMParser().parseFromString(svg, "text/html");
  clean(doc.body, false);
  // The deck sizes the diagram to its region; mermaid's inline max-width would pin it at its natural size.
  // Like every other change this only drops whole declarations, verbatim; the invariant below re-judges the rest.
  const root = doc.body.firstElementChild;
  const rootStyle = root?.localName.toLowerCase() === "svg" ? root.getAttribute("style") : null;
  if (root && rootStyle !== null) {
    const kept = rootStyle.replace(/[^;{}]+/g, (seg) => (/^\s*max-width\s*:/i.test(seg) ? "" : seg));
    if (kept !== rootStyle) {
      if (/^[\s;]*$/.test(kept)) root.removeAttribute("style");
      else root.setAttribute("style", kept);
    }
  }
  // Invariant: a second pass must change nothing. Anything it would change is dropped whole.
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      if (attrValue(attr.name.toLowerCase(), attr.value) !== attr.value) el.removeAttribute(attr.name);
    }
    if (el.localName.toLowerCase() === "style" && scrubCss(el.textContent ?? "") !== el.textContent) el.remove();
  }
  return doc.body.innerHTML;
}
