import { effect, Scroll, signal, Text, View } from "nsh";
import { appearance, tc, tg } from "./theme";
import { WebView } from "nsh/webview";
import { mermaidUrl, openLightbox } from "./lightbox";
import { chatScrolling } from "./scroll";

// Minimal native markdown renderer — no webview, no JS libs.
// Blocks: #/##/### headings, ``` fenced code (with copy), - / 1. lists, > quotes, paragraphs.
// Inline: **bold**, *ital*, `code`, $math$ (latex-lite → unicode).

const GEN = "http://127.0.0.1:8787";
const copy = (text: string) =>
  fetch(`${GEN}/copy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => null);

const GREEK: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", iota: "ι", kappa: "κ", lambda: "λ",
  mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ",
  phi: "φ", chi: "χ", psi: "ψ", omega: "ω", Delta: "Δ", Theta: "Θ",
  Lambda: "Λ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Omega: "Ω",
};
const OPS: Record<string, string> = {
  sqrt: "√", sum: "∑", prod: "∏", int: "∫", infty: "∞", pm: "±",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠",
  approx: "≈", times: "×", div: "÷", cdot: "·", to: "→",
  rightarrow: "→", leftarrow: "←", partial: "∂", nabla: "∇",
  in: "∈", forall: "∀", exists: "∃", cup: "∪", cap: "∩",
  subset: "⊂", oplus: "⊕", otimes: "⊗",
};
const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵",
  "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻",
  "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅",
  "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋",
  "=": "₌", "(": "₍", ")": "₎", a: "ₐ", i: "ᵢ", n: "ₙ", x: "ₓ",
};

// latex-lite: $E = mc^2$, $\frac{a}{b} \le \sqrt{x_i}$ → readable unicode math.
function tex(src: string): string {
  let s = src;
  s = s.replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
  s = s.replace(/\\([A-Za-z]+)/g, (m, name) => GREEK[name] ?? OPS[name] ?? name);
  s = s.replace(/\^\{([^{}]*)\}/g, (_m, g) =>
    [...g].map((c) => SUP[c] ?? c).join(""),
  );
  s = s.replace(/\^([A-Za-z0-9+\-])/g, (_m, g) => SUP[g] ?? `^${g}`);
  s = s.replace(/_\{([^{}]*)\}/g, (_m, g) =>
    [...g].map((c) => SUB[c] ?? c).join(""),
  );
  s = s.replace(/_([A-Za-z0-9])/g, (_m, g) => SUB[g] ?? `_${g}`);
  return s.replace(/[{}]/g, "");
}

type Seg = { t: string; b?: boolean; i?: boolean; code?: boolean };

// Inline tokenizer: **b** *i* `code` $math$ — first match wins, left to right.
function inline(src: string): Seg[] {
  const segs: Seg[] = [];
  const re = /(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)|(`[^`]+`)|(\$[^$]+\$)/g;
  let last = 0;
  for (const m of src.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) segs.push({ t: src.slice(last, i) });
    const t = m[0];
    if (t.startsWith("**")) segs.push({ t: t.slice(2, -2), b: true });
    else if (t.startsWith("*") || t.startsWith("_"))
      segs.push({ t: t.slice(1, -1), i: true });
    else if (t.startsWith("`")) segs.push({ t: t.slice(1, -1), code: true });
    else segs.push({ t: tex(t.slice(1, -1)) });
    last = i + t.length;
  }
  if (last < src.length) segs.push({ t: src.slice(last) });
  return segs.length ? segs : [{ t: "" }];
}

function Segs({ text }: { text: string }) {
  return (
    <Text style={{ color: tc("#f5f5f5"), fontSize: 14, lineHeight: 21 }}>
      {inline(text).map((s) =>
        s.code ? (
          <Text
            style={{
              fontFamily: "Menlo",
              fontSize: 12.5,
              color: "#e8b339",
            }}
          >
            {s.t}
          </Text>
        ) : (
          <Text
            style={{
              color: tc("#f5f5f5"),
              fontSize: 14,
              fontWeight: s.b ? "700" : undefined,
              fontStyle: s.i ? "italic" : undefined,
            }}
          >
            {s.t}
          </Text>
        ),
      )}
    </Text>
  );
}

// ```mermaid: drawn by mermaid.js in a web view sized to the diagram (the page
// reports it); a tap opens it in the lightbox with Grok's zoom pill
// measured diagram sizes, so a thread opened again lays out at its final
// height at once (a growing diagram shifts the transcript)
const mermaidSizes = new Map<string, { w: number, h: number }>();
function MermaidBlock({ code }: { code: string }) {
  const size = signal(mermaidSizes.get(code) ?? { w: 0, h: 60 });
  // a recycled list cell built mid-scroll mounts light: the WebView (a full
  // WebKit page render, ~50-150ms) waits for the scroll to settle, and once
  // mounted never unmounts (a live diagram must not vanish mid-scroll)
  const show = signal(!chatScrolling());
  effect(() => {
    if (!chatScrolling()) show.set(true);
  });
  return (
    <View style={{ width: size().w || "100%", maxWidth: "100%", height: size().h }}>
      <If when={show()}>
        <WebView
          source={{ uri: mermaidUrl(code, "inline") }}
          scrollEnabled={false}
          onMessage={(e) => {
            try {
              const d = JSON.parse(e.data);
              if (d.h && (d.w !== size().w || d.h !== size().h)) {
                mermaidSizes.set(code, { w: d.w, h: d.h });
                size.set({ w: d.w, h: d.h });
              }
            } catch {}
          }}
          style={{ width: "100%", height: "100%", backgroundColor: "transparent" }}
        />
      </If>
      <View
        onPress={() => openLightbox([{ kind: "diagram", code, name: "Diagram" }])}
        accessibilityLabel="Open diagram"
        style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
      />
    </View>
  );
}

// Shiki tokens in Grok's cursor-dark / cursor-light palettes, from the server
const tokCache = new Map<string, [string, string, string][][]>();
function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const copied = signal(false);
  const key = lang + "\u0000" + code;
  const toks = signal<[string, string, string][][] | null>(tokCache.get(key) ?? null);
  if (!toks() && lang)
    fetch("http://127.0.0.1:8787/highlight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, lang }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.lines) {
          tokCache.set(key, d.lines);
          toks.set(d.lines);
        }
      })
      .catch(() => {});
  const onCopy = () => {
    copy(code);
    copied.set(true);
    setTimeout(() => copied.set(false), 1200);
  };
  return (
    <View
      style={{
        borderRadius: 10,
        backgroundColor: tc("#121212"),
        borderWidth: 1,
        borderColor: tc("#f5f5f514"),
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 10,
          paddingVertical: 6,
          backgroundColor: tc("#f5f5f50f"),
        }}
      >
        <Text style={{ color: tc("#f5f5f585"), fontSize: 11, fontFamily: "Menlo" }}>
          {lang || "code"}
        </Text>
        <View onPress={onCopy} activeOpacity={0.7}>
          <Text style={{ color: tc("#f5f5f585"), fontSize: 11 }}>
            {copied() ? "✓ copied" : "⧉ copy"}
          </Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 10, paddingVertical: 8 }}>
        <Text
          style={{ fontFamily: "Menlo", fontSize: 12, color: tc("#f5f5f5"), lineHeight: 18 }}
        >
          {toks()
            ? toks()!.map((line, i) => (
                <Text>
                  {line.map(([t, d, l]) => (
                    <Text style={{ color: (appearance() === "dark" ? d : l) || tc("#f5f5f5") }}>{t}</Text>
                  ))}
                  {i < toks()!.length - 1 ? "\n" : ""}
                </Text>
              ))
            : code}
        </Text>
      </View>
    </View>
  );
}

type Block =
  | { kind: "h"; level: number; text: string }
  | { kind: "code"; code: string; lang: string }
  | { kind: "list"; items: string[]; ordered: boolean }
  | { kind: "quote"; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "p"; text: string };

// parsed block trees by source — a recycled list cell re-mounts its markdown
// on every rebind, and re-tokenizing a long reply each time is the kind of
// invisible work that drops a frame
const parseCache = new Map<string, Block[]>();
function parse(src: string): Block[] {
  const hit = parseCache.get(src);
  if (hit) return hit;
  const blocks: Block[] = [];
  const fence = /```(\w*)\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  const chunks: ({ md: string } | { code: string; lang: string })[] = [];
  for (const m of src.matchAll(fence)) {
    const i = m.index ?? 0;
    if (i > last) chunks.push({ md: src.slice(last, i) });
    chunks.push({ code: m[2].replace(/\n$/, ""), lang: m[1] });
    last = i + m[0].length;
  }
  if (last < src.length) chunks.push({ md: src.slice(last) });

  for (const c of chunks) {
    if ("code" in c) {
      blocks.push({ kind: "code", code: c.code, lang: c.lang });
      continue;
    }
    const lines = c.md.split("\n");
    let list: string[] | null = null;
    let ordered = false;
    let table: string[][] | null = null;
    const flush = () => {
      if (list?.length) blocks.push({ kind: "list", items: list, ordered });
      list = null;
      if (table?.length) blocks.push({ kind: "table", rows: table });
      table = null;
    };
    for (const line of lines) {
      const t = line.trim();
      // GFM table rows: | a | b |  (the |---| separator row is dropped)
      if (/^\|.*\|$/.test(t)) {
        if (list) flush();
        if (!/^\|[\s:|-]+\|$/.test(t)) (table ??= []).push(t.slice(1, -1).split("|").map((c) => c.trim()));
        continue;
      }
      if (table) flush();
      const li = /^([-*])\s+(.*)$/.exec(t) || /^(\d+)[.)]\s+(.*)$/.exec(t);
      if (li) {
        if (!list) {
          list = [];
          ordered = /^\d/.test(t);
        }
        list.push(li[2]);
        continue;
      }
      flush();
      if (!t) continue;
      const h = /^(#{1,3})\s+(.*)$/.exec(t);
      if (h) blocks.push({ kind: "h", level: h[1].length, text: h[2] });
      else if (t.startsWith(">"))
        blocks.push({ kind: "quote", text: t.replace(/^>\s?/, "") });
      else blocks.push({ kind: "p", text: t });
    }
    flush();
  }
  // bounded: the oldest entry goes first once transcripts outgrow the map
  if (parseCache.size >= 400) parseCache.delete(parseCache.keys().next().value!);
  parseCache.set(src, blocks);
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  return (
    <View class="gap-2">
      {parse(text).map((b) =>
        b.kind === "h" ? (
          <Text
            style={{
              color: tc("#f5f5f5"),
              fontSize: b.level === 1 ? 19 : b.level === 2 ? 17 : 15,
              fontWeight: "700",
              marginTop: 4,
            }}
          >
            {b.text}
          </Text>
        ) : b.kind === "table" ? (
          <Scroll horizontal contentContainerStyle={{ flexDirection: "column" }}>
            <View style={{ borderWidth: 0.5, borderColor: tc("#f5f5f51f"), borderRadius: 8, overflow: "hidden" }}>
              {b.rows.map((row, r) => (
                <View style={{ flexDirection: "row", backgroundColor: r === 0 ? tc("#f5f5f50a") : "transparent" }}>
                  {row.map((cell, c) => (
                    <View
                      style={{
                        minWidth: 96,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderLeftWidth: c > 0 ? 0.5 : 0,
                        borderTopWidth: r > 0 ? 0.5 : 0,
                        borderColor: tc("#f5f5f51a"),
                      }}
                    >
                      <Text style={{ color: tc("#f5f5f5"), fontSize: 13.5, lineHeight: 20, fontWeight: r === 0 ? "600" : "400" }}>{cell}</Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </Scroll>
        ) : b.kind === "code" ? (
          b.lang === "mermaid" ? <MermaidBlock code={b.code} /> : <CodeBlock code={b.code} lang={b.lang} />
        ) : b.kind === "list" ? (
          <View class="gap-1">
            {b.items.map((it, ix) => (
              <Text
                style={{ color: tc("#f5f5f5"), fontSize: 14, lineHeight: 21 }}
              >
                <Text style={{ color: tc("#f5f5f585"), fontSize: 14 }}>
                  {b.ordered ? `${ix + 1}.  ` : "•  "}
                </Text>
                {inline(it).map((s) =>
                  s.code ? (
                    <Text
                      style={{
                        fontFamily: "Menlo",
                        fontSize: 12.5,
                        color: "#e8b339",
                      }}
                    >
                      {s.t}
                    </Text>
                  ) : (
                    <Text
                      style={{
                        color: tc("#f5f5f5"),
                        fontSize: 14,
                        fontWeight: s.b ? "700" : undefined,
                        fontStyle: s.i ? "italic" : undefined,
                      }}
                    >
                      {s.t}
                    </Text>
                  ),
                )}
              </Text>
            ))}
          </View>
        ) : b.kind === "quote" ? (
          <View
            style={{
              borderLeftWidth: 3,
              borderLeftColor: tc("#f5f5f53d"),
              paddingLeft: 10,
            }}
          >
            <Text style={{ color: tc("#f5f5f5a8"), fontSize: 14, fontStyle: "italic" }}>
              {b.text}
            </Text>
          </View>
        ) : (
          <Segs text={b.text} />
        ),
      )}
    </View>
  );
}
