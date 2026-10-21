// Reply files, Grok Bot's (extracted from its renderer, CSS resolved live):
// - FileCard: the elevated `sand-file-card` — a 44pt document illustration
//   (`Xg`: page 32×40 / landscape 40×34 for slides, radius 6, 4pt bars at
//   radius 2, a 12pt colored stripe: blue docx/keynote, red pdf, orange ppt,
//   green spreadsheet), name, "KIND · size" meta, a download button;
// - FileViewer: the fullscreen viewer per kind (`jT`) — markdown/docx as rich
//   text, text/json as Shiki-highlighted code (Grok's cursor palettes), tables
//   with sheet tabs, pdf/html in a web view, image/video/audio players, and
//   "Preview unavailable" for the rest.
import { cleanup, effect, Scroll, signal, Text, View } from "nsh";
import { keymap } from "nsh/keymap";
import { chatScrolling } from "./scroll";
import { Image } from "nsh/image";
import { Video } from "nsh/video";
import { PanResponder } from "nsh/gesture";
import { WebView } from "nsh/webview";
import { appearance, tc } from "./theme";
import { Markdown } from "./md";
import { isSvg, openLightbox, SvgView, type LightItem } from "./lightbox";

const GEN = "http://127.0.0.1:8787";
export type ReplyFile = {
  path: string; name: string; ext: string; size: number; kind: string; variant: string;
  duration?: number; peaks?: number[]; width?: number; height?: number; poster?: string;
  // ≤1120px derivative — the feed decodes this, the lightbox the original
  feed?: string;
  // multi-frame source (gif / animated webp / apng): `feed` is its first frame
  animated?: boolean;
};

// Grok: "506B", "1.4kB", "11kB", "2.3MB"
const fmtSize = (n: number) => {
  const f = (v: number, u: string) => `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)}${u}`;
  return n < 1000 ? `${n}B` : n < 1e6 ? f(n / 1000, "kB") : f(n / 1e6, "MB");
};
const fmtTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const stemExt = (name: string) => {
  const i = name.lastIndexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
};
const raw = (f: ReplyFile) => `${GEN}/file/raw/${f.path.split("/").map(encodeURIComponent).join("/")}`;
export const saveFile = (f: ReplyFile) =>
  fetch(`${GEN}/file/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: f.path }) }).catch(() => null);

// Sand tokens the illustration uses
const dark = () => appearance() === "dark";
const bgSecondary = () => (dark() ? "#f5f5f51f" : "#1c1c1c14");
const elevated = () => (dark() ? "#1f1f1f" : "#ffffff");
const STRIPE: Record<string, () => string> = {
  docx: () => (dark() ? "#116dd2" : "#126fd4"),
  keynote: () => (dark() ? "#116dd2" : "#126fd4"),
  pdf: () => (dark() ? "#cf2b35" : "#c82532"),
  ppt: () => (dark() ? "#cd5309" : "#d2550a"),
  spreadsheet: () => (dark() ? "#0e9f5a" : "#0d9655"),
};

const bar = (half = false) => <View style={{ height: 4, borderRadius: 2, backgroundColor: bgSecondary(), width: half ? "48%" : "100%" }} />;

/** Grok's 44pt document illustration (`Xg` + `XF`). */
export function DocGlyph(props: { variant: string }) {
  const v = props.variant;
  const landscape = v === "ppt" || v === "keynote";
  const stripe = STRIPE[v];
  const body = () => {
    switch (v) {
      case "docx":
        return [bar(), bar(), bar(true)];
      case "ppt":
      case "keynote":
        return [bar(), bar(true)];
      case "json":
        return [
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: bgSecondary() }} />,
          ...[0, 1].map(() => (
            <View style={{ flexDirection: "row", gap: 2, paddingLeft: 4 }}>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: bgSecondary() }} />
              <View style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: bgSecondary() }} />
            </View>
          )),
          <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: bgSecondary() }} />,
        ];
      case "pdf":
        return [
          bar(),
          <View style={{ flexDirection: "row", gap: 2, flex: 1 }}>
            <View style={{ flex: 1, gap: 3 }}>{[bar(), bar()]}</View>
            <View style={{ flex: 1, borderRadius: 2, backgroundColor: bgSecondary() }} />
          </View>,
        ];
      case "spreadsheet":
        return [
          <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", margin: -4 }}>
            {Array.from({ length: 15 }, (_, e) => (
              <View
                style={{
                  width: "33.33%",
                  height: "20%",
                  borderRightWidth: e % 3 < 2 ? 0.5 : 0,
                  borderTopWidth: e >= 3 ? 0.5 : 0,
                  borderColor: tc("#f5f5f51a"),
                }}
              />
            ))}
          </View>,
        ];
      case "zip":
        return ["end", "start", "end", "start", "end", "start"].map((side) => (
          <View style={{ width: "25%", height: 4, backgroundColor: bgSecondary(), marginLeft: side === "start" ? "25%" : "50%", borderRadius: 2 }} />
        ));
      case "audio":
        return [
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3 }}>
            {[16, 24, 16].map((h) => (
              <View style={{ width: 4, height: h, borderRadius: 6, backgroundColor: bgSecondary() }} />
            ))}
          </View>,
        ];
      case "font":
      case "unknown":
        return [
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: tc("#f5f5f58a"), fontSize: 15, fontWeight: "600" }}>{v === "font" ? "Aa" : "?"}</Text>
          </View>,
        ];
      default: // generic
        return [bar(true), bar(), bar(), bar(true)];
    }
  };
  return (
    <View style={{ width: 44, height: 44, padding: 2, alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <View
        style={{
          width: landscape ? 40 : 32,
          height: landscape ? 34 : 40,
          borderRadius: 6,
          overflow: "hidden",
          backgroundColor: elevated(),
          borderWidth: 0.5,
          borderColor: tc("#f5f5f51a"),
          boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
        }}
      >
        <View style={{ flex: 1, gap: 3, padding: 4 }}>{body()}</View>
        {stripe ? <View style={{ height: 12, flexShrink: 0, backgroundColor: stripe() }} /> : null}
      </View>
    </View>
  );
}

// the name as Grok shows it: the stem truncates, the extension always shows
function FileName(props: { name: string }) {
  const [stem, ext] = stemExt(props.name);
  return (
    <View style={{ flexDirection: "row", minWidth: 0 }}>
      <Text numberOfLines={1} style={{ flexShrink: 1, color: tc("#f5f5f5"), fontSize: 14, lineHeight: 20, fontWeight: "500" }}>{stem}</Text>
      <Text style={{ flexShrink: 0, color: tc("#f5f5f5"), fontSize: 14, lineHeight: 20, fontWeight: "500" }}>{ext}</Text>
    </View>
  );
}
const cardBox = (hover: boolean) =>
  ({
    width: 230,
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: tc("#f5f5f51f"),
    backgroundColor: hover ? tc("#262626") : tc("#1f1f1f"),
    overflow: "hidden",
  }) as const;
const SaveBtn = (props: { f: ReplyFile }) => (
  <View
    onPress={() => saveFile(props.f)}
    activeOpacity={0.6}
    accessibilityLabel={`Save ${props.f.name}`}
    style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" }}
  >
    <Text style={{ color: tc("#f5f5f5a8"), fontSize: 14 }}>⤓</Text>
  </View>
);

/** Grok's elevated file card: 230×64 — glyph, name, size, save. */
export function FileCard(props: { f: ReplyFile; onOpen: (f: ReplyFile) => void }) {
  const hov = signal(false);
  const f = props.f;
  return (
    <View
      onPress={() => props.onOpen(f)}
      onHoverIn={() => hov.set(true)}
      onHoverOut={() => hov.set(false)}
      activeOpacity={0.9}
      accessibilityLabel={`Open ${f.name}`}
      style={{ ...cardBox(hov()), flexDirection: "row", alignItems: "center", gap: 8, height: 64, paddingLeft: 10, paddingRight: 12 }}
    >
      <DocGlyph variant={f.variant} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <FileName name={f.name} />
        <Text numberOfLines={1} style={{ color: tc("#f5f5f5ad"), fontSize: 13, lineHeight: 18 }}>{fmtSize(f.size)}</Text>
      </View>
      <SaveBtn f={f} />
    </View>
  );
}

// ————— audio: Grok's playable card (and the viewer's player bar) —————
const SPEEDS = [1, 1.5, 2, 0.5];
// one audio at a time: starting a player pauses whichever was playing
let stopCurrent: (() => void) | null = null;
const stopAudio = () => {
  stopCurrent?.();
  stopCurrent = null;
};
function useAudio(f: ReplyFile) {
  const paused = signal(true);
  const stop = () => paused.set(true);
  const time = signal(0);
  const dur = signal(f.duration || 0);
  const rate = signal(1);
  const muted = signal(false);
  // a recycled list cell built mid-scroll mounts light: the hidden player
  // (an AVPlayerItem on the card) waits for the scroll to settle; once
  // mounted it stays (an in-flight play must not be torn down mid-scroll)
  const show = signal(!chatScrolling());
  effect(() => {
    if (!chatScrolling()) show.set(true);
  });
  let player: any;
  const node = () =>
    show() ? (
      <Video
        ref={player}
        source={{ uri: raw(f) }}
        paused={paused()}
        rate={rate()}
        muted={muted()}
        progressUpdateInterval={100}
        onLoad={(e) => e.duration && dur.set(e.duration)}
        onProgress={(e) => time.set(e.currentTime)}
        onEnd={() => {
          paused.set(true);
          time.set(0);
          player?.seek?.(0);
        }}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
      />
    ) : null;
  return {
    paused, time, dur, rate, muted, node,
    toggle: () => {
      if (paused()) {
        if (stopCurrent !== stop) stopAudio();
        stopCurrent = stop;
        paused.set(false);
      } else paused.set(true);
    },
    seek: (t: number) => {
      time.set(t);
      player?.seek?.(t);
    },
    nextRate: () => rate.set(SPEEDS[(SPEEDS.indexOf(rate()) + 1) % SPEEDS.length]),
  };
}
const rateLabel = (r: number, sep: string) => `${r}${sep}`;
// press or drag along a track of width w() → seek to that fraction
const scrubber = (w: () => number, a: { dur: () => number; seek: (t: number) => void }) => {
  let x0 = 0;
  const at = (x: number) => a.dur() && a.seek(Math.max(0, Math.min(1, x / w())) * a.dur());
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => {
      x0 = e.nativeEvent.locationX;
      at(x0);
    },
    onPanResponderMove: (_e, g) => at(x0 + g.dx),
  }).panHandlers;
};

// unplayed waveform bars: the tint at ~55% — hex takes an alpha suffix,
// rgba() colors (the neutral bubble fill) get their alpha scaled
const fade = (c: string) =>
  c.startsWith("rgba(")
    ? c.replace(/[\d.]+\)$/, (a) => `${Math.round(parseFloat(a) * 55) / 100})`)
    : c + "8c";

/** 230×112: glyph · name · "0:00 · size" · save, then ▶ · 1× · waveform · time. */
export function AudioCard(props: { f: ReplyFile; onOpen: (f: ReplyFile) => void; tint: string }) {
  const f = props.f;
  const a = useAudio(f);
  const peaks = f.peaks?.length ? f.peaks : Array.from({ length: 48 }, () => 0.3);
  const W = 93;
  return (
    <View style={{ ...cardBox(false) }}>
      {a.node()}
      <View onPress={() => props.onOpen(f)} activeOpacity={0.9} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 64, paddingLeft: 10, paddingRight: 12 }}>
        <DocGlyph variant="audio" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <FileName name={f.name} />
          <Text numberOfLines={1} style={{ color: tc("#f5f5f5ad"), fontSize: 13, lineHeight: 18 }}>{`${fmtTime(a.dur())} · ${fmtSize(f.size)}`}</Text>
        </View>
        <SaveBtn f={f} />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", height: 48, paddingLeft: 14, paddingRight: 12 }}>
        <View onPress={a.toggle} activeOpacity={0.6} accessibilityLabel={`${a.paused() ? "Play" : "Pause"} ${f.name}`} style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: tc("#f5f5f5"), fontSize: 13 }}>{a.paused() ? "▶" : "❚❚"}</Text>
        </View>
        <View onPress={a.nextRate} activeOpacity={0.6} accessibilityLabel={`Playback speed ${a.rate()}x`} style={{ width: 34, height: 32, alignItems: "center", justifyContent: "center", borderRightWidth: 0.5, borderRightColor: tc("#f5f5f50f") }}>
          <Text style={{ color: tc("#f5f5f5ad"), fontSize: 14, fontWeight: "500" }}>{rateLabel(a.rate(), "×")}</Text>
        </View>
        {/* waveform: played bars take the bot's color */}
        <View
          {...scrubber(() => W, a)}
          style={{ width: W, height: 24, marginLeft: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
          {peaks.filter((_, i) => i % 2 === 0).map((p, i, arr) => (
            <View
              style={{
                width: 1.5,
                height: Math.max(2, p * 24),
                borderRadius: 1,
                backgroundColor: a.dur() && i / arr.length < a.time() / a.dur() ? props.tint : fade(props.tint),
              }}
            />
          ))}
        </View>
        <Text style={{ marginLeft: 10, color: tc("#f5f5f5ad"), fontSize: 13, lineHeight: 18 }}>{fmtTime(a.paused() && !a.time() ? a.dur() : a.time())}</Text>
      </View>
    </View>
  );
}

// ————— media gallery (images + videos in a reply) —————
const fileUrl = (path: string) => `${GEN}/file/raw/${path.split("/").map(encodeURIComponent).join("/")}`;
const toLight = (f: ReplyFile): LightItem =>
  f.kind === "video"
    ? { kind: "video", uri: raw(f), name: f.name, path: f.path, poster: f.poster ? fileUrl(f.poster) : undefined, w: f.width, h: f.height }
    : { kind: "image", uri: raw(f), name: f.name, path: f.path, w: f.width, h: f.height };

/** Grok's fallback when an image can't load (bad path, server gone). */
function ImageUnavailable(props: { w: number; h: number }) {
  return (
    <View style={{ width: props.w, height: props.h, borderRadius: 10, borderWidth: 0.5, borderColor: tc("#f5f5f51f"), backgroundColor: tc("#f5f5f50a"), alignItems: "center", justifyContent: "center", gap: 6, padding: 8 }}>
      <Text style={{ color: tc("#f5f5f58a"), fontSize: 20 }}>🖼︎</Text>
      <Text style={{ color: tc("#f5f5f58a"), fontSize: 12, lineHeight: 16, textAlign: "center" }}>Image unavailable</Text>
    </View>
  );
}

function MediaTile(props: { f: ReplyFile; w: number; h: number; more?: number; onOpen: () => void }) {
  const failed = signal(!props.f.size && props.f.kind === "image");
  const f = props.f;
  const pic = f.kind === "video" ? (f.poster ? fileUrl(f.poster) : "") : f.feed ? fileUrl(f.feed) : raw(f);
  return (
    <View onPress={failed() ? undefined : props.onOpen} activeOpacity={0.9} accessibilityLabel={`Open ${f.name}`} style={{ width: props.w, height: props.h, borderRadius: 10, overflow: "hidden", backgroundColor: tc("#f5f5f50a") }}>
      <If when={failed()}>
        <ImageUnavailable w={props.w} h={props.h} />
      </If>
      <If when={!failed() && !!pic && isSvg(pic)}>
        <SvgView uri={pic} fit="cover" onPress={props.onOpen} style={{ position: "absolute", left: 0, top: 0, width: props.w, height: props.h }} />
      </If>
      <If when={!failed() && !!pic && !isSvg(pic)}>
        <Image src={{ uri: pic }} resizeMode="cover" fadeDuration={0} onError={() => failed.set(true)} style={{ position: "absolute", left: 0, top: 0, width: props.w, height: props.h }} />
      </If>
      {/* a still for animated media carries Grok's GIF badge */}
      <If when={!!f.animated && !failed()}>
        <View style={{ position: "absolute", left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "#00000099" }}>
          <Text style={{ color: "#ffffff", fontSize: 11, fontWeight: "700" }}>{f.ext === "gif" ? "GIF" : f.ext.toUpperCase()}</Text>
        </View>
      </If>
      <If when={f.kind === "video" && !failed()}>
        <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "#000000a6", alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#ffffff", fontSize: 16, marginLeft: 3 }}>▶</Text>
          </View>
        </View>
        <If when={!!f.duration}>
          <View style={{ position: "absolute", right: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: "#00000099" }}>
            <Text style={{ color: "#ffffff", fontSize: 11 }}>{fmtTime(f.duration || 0)}</Text>
          </View>
        </If>
      </If>
      <If when={!!props.more}>
        <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#00000080" }}>
          <Text style={{ color: "#ffffff", fontSize: 20, fontWeight: "600" }}>{`+${props.more}`}</Text>
        </View>
      </If>
    </View>
  );
}

const GAL_W = 480, GAP = 4;
/** Justified rows: images up to 3 per row, videos up to 2; the last visible
 *  tile of a kind carries "+N" for the rest. One image keeps its aspect. */
export function MediaGallery(props: { files: ReplyFile[] }) {
  const all = props.files;
  const open = (f: ReplyFile) => {
    const ok = all.filter((x) => x.size);
    openLightbox(ok.map(toLight), Math.max(0, ok.indexOf(f)));
  };
  const aspect = (f: ReplyFile) => (f.width && f.height ? f.width / f.height : f.kind === "video" ? 16 / 9 : 4 / 3);
  const rows: { files: ReplyFile[]; more: number }[] = [];
  for (const [kind, per] of [["image", 3], ["video", 2]] as const) {
    const list = all.filter((f) => f.kind === kind);
    if (list.length) rows.push({ files: list.slice(0, per), more: list.length - per });
  }
  return (
    <View style={{ gap: GAP, width: GAL_W, maxWidth: "100%" }}>
      {rows.map((row) => {
        if (row.files.length === 1 && row.more <= 0) {
          const a = aspect(row.files[0]);
          const w = Math.min(360, a >= 1 ? 360 : 320 * a), h = w / a;
          return <MediaTile f={row.files[0]} w={Math.round(w)} h={Math.round(Math.min(h, 320))} onOpen={() => open(row.files[0])} />;
        }
        const sum = row.files.reduce((t, f) => t + aspect(f), 0);
        const h = Math.min(240, (GAL_W - GAP * (row.files.length - 1)) / sum);
        return (
          <View style={{ flexDirection: "row", gap: GAP }}>
            {row.files.map((f, i) => (
              <MediaTile f={f} w={Math.floor(aspect(f) * h)} h={Math.round(h)} more={i === row.files.length - 1 && row.more > 0 ? row.more : 0} onOpen={() => open(f)} />
            ))}
          </View>
        );
      })}
    </View>
  );
}

// ————— fullscreen viewer —————
type Rendered = {
  kind: string;
  json?: unknown;
  text?: string;
  lines?: [string, string, string][][];
  sheets?: { name: string; rows: string[][]; bold?: boolean[][]; widths?: number[] }[];
  // BetterOffice engine view: /office/… paints the real slides/sheet in a
  // WebView. Absent → the classic renderers below are the fallback.
  office?: string;
  error?: string;
};
export const viewing = signal<ReplyFile | null>(null);
const rendered = signal<Rendered | null>(null);
const sheet = signal(0);
const htmlMode = signal<"preview" | "source">("preview");
export function openFile(f: ReplyFile) {
  stopAudio();
  if (f.kind === "image" || f.kind === "video") return openLightbox([toLight(f)]);
  viewing.set(f);
  rendered.set(null);
  sheet.set(0);
  htmlMode.set("preview");
  selA.set(null);
  selB.set(null);
  fetch(`${GEN}/file/render?path=${encodeURIComponent(f.path)}`)
    .then((r) => r.json())
    .then((d) => viewing()?.path === f.path && rendered.set(d))
    .catch((e) => rendered.set({ kind: f.kind, error: String(e) }));
}

function CodeView(props: { lines: [string, string, string][][] }) {
  const gutter = String(props.lines.length).length * 8 + 16;
  return (
    <Scroll style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12 }}>
      <Scroll horizontal contentContainerStyle={{ flexDirection: "column", paddingRight: 24 }}>
        {props.lines.map((line, i) => (
          <View style={{ flexDirection: "row", minHeight: 20 }}>
            <Text style={{ width: gutter, textAlign: "right", paddingRight: 12, color: tc("#f5f5f561"), fontFamily: "Menlo", fontSize: 12, lineHeight: 20 }}>{String(i + 1)}</Text>
            <Text style={{ fontFamily: "Menlo", fontSize: 13, lineHeight: 20, color: tc("#f5f5f5") }}>
              {line.map(([t, d, l]) => (
                <Text style={{ color: (dark() ? d : l) || tc("#f5f5f5") }}>{t}</Text>
              ))}
            </Text>
          </View>
        ))}
      </Scroll>
    </Scroll>
  );
}

// Grok's JSON viewer: a collapsible tree — monospace 12/20.4, keys amber,
// strings green, booleans/numbers/null violet, "{n keys}" / "[n items]" summaries
const J = {
  key: () => (dark() ? "#e0a54a" : "rgb(170,99,0)"),
  str: () => (dark() ? "#3ecf8e" : "rgb(0,133,74)"),
  lit: () => (dark() ? "#b69cff" : "rgb(117,71,208)"),
  dim: () => tc("#f5f5f58f"),
};
const mono = { fontFamily: "Menlo", fontSize: 12, lineHeight: 20.4 } as const;
function JsonNode(props: { k?: string; v: unknown; depth: number }) {
  const open = signal(props.depth < 3);
  const v = props.v;
  const isObj = v !== null && typeof v === "object";
  const entries = isObj ? (Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as object)) : [];
  const summary = Array.isArray(v) ? `[${entries.length} ${entries.length === 1 ? "item" : "items"}]` : `{${entries.length} ${entries.length === 1 ? "key" : "keys"}}`;
  const lit = typeof v === "string" ? JSON.stringify(v) : String(v);
  return (
    <View style={{ paddingLeft: props.depth ? 17 : 0 }}>
      <View onPress={isObj ? () => open.set(!open()) : undefined} activeOpacity={0.7} style={{ flexDirection: "row", alignItems: "center" }}>
        <Text style={{ ...mono, width: 12, color: J.dim() }}>{isObj ? (open() ? "⌄" : "›") : ""}</Text>
        <If when={props.k != null}>
          <Text style={{ ...mono, color: J.key() }}>{props.k}</Text>
          <Text style={{ ...mono, color: tc("#f5f5f566") }}>{": "}</Text>
        </If>
        <Text style={{ ...mono, color: isObj ? J.dim() : typeof v === "string" ? J.str() : J.lit() }}>{isObj ? summary : lit}</Text>
      </View>
      <If when={isObj && open()}>
        <View style={{ borderLeftWidth: 0.5, borderLeftColor: tc("#f5f5f51a"), marginLeft: 5 }}>
          {entries.map(([k, x]) => (
            <JsonNode k={k} v={x} depth={props.depth + 1} />
          ))}
        </View>
      </If>
    </View>
  );
}

/** Grok's audio viewer: a 53pt bar — ▶, seek, "0:00 / 0:00", speed, mute. */
function AudioPlayer(props: { f: ReplyFile }) {
  const a = useAudio(props.f); // starts paused: opening the viewer never autoplays
  let trackW = 351;
  const pct = () => (a.dur() ? Math.min(1, a.time() / a.dur()) : 0);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {a.node()}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          width: "100%",
          maxWidth: 561,
          height: 53,
          paddingHorizontal: 12,
          borderRadius: 12,
          borderWidth: 0.5,
          borderColor: tc("#f5f5f51f"),
          backgroundColor: tc("#1f1f1f"),
        }}
      >
        <View onPress={a.toggle} activeOpacity={0.6} accessibilityLabel={a.paused() ? "Play" : "Pause"} style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: tc("#f5f5f5"), fontSize: 14 }}>{a.paused() ? "▶" : "❚❚"}</Text>
        </View>
        <View
          onLayout={(e) => (trackW = e.width)}
          {...scrubber(() => trackW, a)}
          accessibilityLabel={`Seek in ${props.f.name}`}
          style={{ flex: 1, height: 16, justifyContent: "center" }}
        >
          <View style={{ height: 4, borderRadius: 2, backgroundColor: tc("#f5f5f51a") }} />
          <View style={{ position: "absolute", left: 0, width: `${pct() * 100}%`, height: 4, borderRadius: 2, backgroundColor: tc("#f5f5f5") }} />
          <View style={{ position: "absolute", left: `${pct() * 100}%`, marginLeft: -6, width: 12, height: 12, borderRadius: 6, backgroundColor: tc("#f5f5f5"), boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }} />
        </View>
        <Text style={{ color: tc("#f5f5f58f"), fontSize: 11 }}>{`${fmtTime(a.time())} / ${fmtTime(a.dur())}`}</Text>
        <View onPress={a.nextRate} activeOpacity={0.6} accessibilityLabel={`Playback speed ${a.rate()}x`} style={{ width: 38, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: tc("#f5f5f58f"), fontSize: 11 }}>{rateLabel(a.rate(), "x")}</Text>
        </View>
        <View onPress={() => a.muted.set(!a.muted())} activeOpacity={0.6} accessibilityLabel={a.muted() ? "Unmute" : "Mute"} style={{ width: 24, height: 24, borderRadius: 6, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: tc("#f5f5f5a8"), fontSize: 13 }}>{a.muted() ? "🔇︎" : "🔊︎"}</Text>
        </View>
      </View>
    </View>
  );
}

// Grok's spreadsheet viewer: a hint bar, row numbers, cells 24pt / 13px with
// 0.5pt grid lines, bold kept from the workbook; a cell selection that arrows
// move, Shift extends and ⌘C copies (as TSV)
type Sheet = { name: string; rows: string[][]; bold?: boolean[][]; widths?: number[] };
const hintOpen = signal(true);
const selA = signal<{ r: number; c: number } | null>(null); // anchor
const selB = signal<{ r: number; c: number } | null>(null); // moving end
const curSheet = () => {
  const sh = rendered()?.sheets;
  return sh ? sh[Math.min(sheet(), sh.length - 1)] : null;
};
const inSel = (r: number, c: number) => {
  const a = selA(), b = selB();
  if (!a || !b) return false;
  return r >= Math.min(a.r, b.r) && r <= Math.max(a.r, b.r) && c >= Math.min(a.c, b.c) && c <= Math.max(a.c, b.c);
};
function TableView(props: { sheets: Sheet[] }) {
  const s = () => props.sheets[Math.min(sheet(), props.sheets.length - 1)];
  const cols = () => Math.max(1, ...s().rows.map((r) => r.length));
  const width = (c: number) => {
    const w = s().widths?.[c];
    if (w) return Math.max(48, Math.min(320, Math.round(w * 7)));
    const longest = Math.max(1, ...s().rows.slice(0, 200).map((r) => (r[c] ?? "").length));
    return Math.max(56, Math.min(260, longest * 8 + 22));
  };
  const grid = tc("#f5f5f51a");
  return (
    <View style={{ flex: 1 }}>
      <If when={hintOpen()}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 0.5, borderBottomColor: grid }}>
          <Text style={{ flex: 1, color: tc("#f5f5f58f"), fontSize: 12, lineHeight: 16 }}>Click a cell to select it. Move with the arrow keys, extend with Shift, copy with ⌘C.</Text>
          <View onPress={() => hintOpen.set(false)} activeOpacity={0.6} accessibilityLabel="Hide hint" style={{ padding: 4 }}>
            <Text style={{ color: tc("#f5f5f58f"), fontSize: 12 }}>⌄</Text>
          </View>
        </View>
      </If>
      <Scroll style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        <Scroll horizontal contentContainerStyle={{ flexDirection: "column" }}>
          <View style={{ borderTopWidth: 0.5, borderLeftWidth: 0.5, borderColor: grid }}>
            {s().rows.map((row, r) => (
              <View style={{ flexDirection: "row" }}>
                <View style={{ width: 34, height: 24, justifyContent: "center", paddingRight: 8, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: grid, backgroundColor: tc("#f5f5f505") }}>
                  <Text style={{ textAlign: "right", color: tc("#f5f5f58f"), fontSize: 12 }}>{String(r + 1)}</Text>
                </View>
                {Array.from({ length: cols() }, (_, c) => (
                  <View
                    onPress={() => {
                      selA.set({ r, c });
                      selB.set({ r, c });
                    }}
                    style={{
                      width: width(c),
                      height: 24,
                      justifyContent: "center",
                      paddingHorizontal: 8,
                      borderRightWidth: 0.5,
                      borderBottomWidth: 0.5,
                      borderColor: grid,
                      backgroundColor: inSel(r, c) ? "#116dd21f" : "transparent",
                    }}
                  >
                    <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 13, fontWeight: s().bold?.[r]?.[c] ? "600" : "400" }}>{row[c] ?? ""}</Text>
                    <If when={selB()?.r === r && selB()?.c === c}>
                      <View style={{ position: "absolute", left: -1, top: -1, right: -1, bottom: -1, borderWidth: 2, borderColor: "#116dd2" }} />
                    </If>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </Scroll>
      </Scroll>
    </View>
  );
}
// keys while a table is open
function useTableKeys() {
  effect(() => {
    if (viewing()?.kind !== "table") return;
    const move = (dr: number, dc: number, extend: boolean) => () => {
      const sh = curSheet();
      const b = selB();
      if (!sh || !b) return;
      const n = { r: Math.max(0, Math.min(sh.rows.length - 1, b.r + dr)), c: Math.max(0, Math.min(Math.max(...sh.rows.map((x) => x.length)) - 1, b.c + dc)) };
      selB.set(n);
      if (!extend) selA.set(n);
    };
    const off = keymap.bind({
      up: move(-1, 0, false), down: move(1, 0, false), left: move(0, -1, false), right: move(0, 1, false),
      "shift+up": move(-1, 0, true), "shift+down": move(1, 0, true), "shift+left": move(0, -1, true), "shift+right": move(0, 1, true),
      "mod+c": () => {
        const sh = curSheet(), a = selA(), b = selB();
        if (!sh || !a || !b) return;
        const text = sh.rows
          .slice(Math.min(a.r, b.r), Math.max(a.r, b.r) + 1)
          .map((row) => row.slice(Math.min(a.c, b.c), Math.max(a.c, b.c) + 1).join("\t"))
          .join("\n");
        fetch(`${GEN}/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }).catch(() => {});
      },
    });
    cleanup(off);
  });
}

function Unavailable(props: { f: ReplyFile; title?: string; detail?: string }) {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 }}>
      <DocGlyph variant={props.f.variant} />
      <Text style={{ color: tc("#f5f5f5"), fontSize: 15, fontWeight: "600" }}>{props.title ?? "Preview unavailable"}</Text>
      <Text style={{ color: tc("#f5f5f5a8"), fontSize: 13, lineHeight: 18, textAlign: "center", maxWidth: 360 }}>
        {props.detail ?? "Previews aren't available for this file type. Download the file to open it on your computer."}
      </Text>
      <View onPress={() => saveFile(props.f)} activeOpacity={0.8} style={{ marginTop: 4, height: 30, paddingHorizontal: 14, borderRadius: 15, justifyContent: "center", backgroundColor: tc("#f5f5f514") }}>
        <Text style={{ color: tc("#f5f5f5"), fontSize: 13, fontWeight: "500" }}>Download</Text>
      </View>
    </View>
  );
}

/** Grok's fullscreen file viewer (`Ae` sheet: title, download, close). */
export function FileViewer() {
  useTableKeys();
  const body = () => {
    const f = viewing()!;
    const r = rendered();
    if (r?.error) return <Unavailable f={f} title="Couldn't load preview" detail={r.error} />;
    if (r?.office) return <WebView source={{ uri: `${GEN}${r.office}` }} style={{ flex: 1, backgroundColor: "#161616" }} />;
    switch (f.kind) {
      case "image":
        return <Image src={{ uri: raw(f) }} resizeMode="contain" fadeDuration={0} style={{ flex: 1, margin: 24 }} />;
      case "video":
        return <Video source={{ uri: raw(f) }} controls paused={false} resizeMode="contain" style={{ flex: 1, margin: 24 }} />;
      case "audio":
        return <AudioPlayer f={f} />;
      case "pdf":
        return <WebView source={{ uri: raw(f) }} style={{ flex: 1, backgroundColor: "#ffffff" }} />;
      case "html":
        return htmlMode() === "source" ? (r?.lines ? <CodeView lines={r.lines} /> : null) : <WebView source={{ uri: raw(f) }} style={{ flex: 1, backgroundColor: "#ffffff" }} />;
      case "markdown":
      case "docx":
        return r?.text != null ? (
          <Scroll style={{ flex: 1 }} contentContainerStyle={{ alignItems: "center", padding: 24 }}>
            <View style={{ width: "100%", maxWidth: 760 }}>
              <Markdown text={r.text} />
            </View>
          </Scroll>
        ) : null;
      case "json":
        return r?.json !== undefined ? (
          <Scroll style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
            <JsonNode v={r.json} depth={0} />
          </Scroll>
        ) : r?.lines ? (
          <CodeView lines={r.lines} />
        ) : null;
      case "text":
        return r?.lines ? <CodeView lines={r.lines} /> : null;
      case "table":
        return r?.sheets ? <TableView sheets={r.sheets} /> : null;
      default:
        return <Unavailable f={f} />;
    }
  };
  return (
    <If when={!!viewing()}>
      <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: tc("#161616") }}>
        <View
          desktop={{ windowDrag: true }}
          style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 52, paddingLeft: 84, paddingRight: 12, borderBottomWidth: 0.5, borderBottomColor: tc("#f5f5f51a") }}
        >
          {/* the artifact name centers against the window, not the space left
              of the controls — an overlay so the traffic lights and the
              trailing buttons don't skew it */}
          <View pointerEvents="none" style={{ position: "absolute", left: 84, right: 84, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
            <Text numberOfLines={1} style={{ color: tc("#f5f5f5"), fontSize: 14, fontWeight: "500" }}>{viewing()!.name}</Text>
            <If when={viewing()!.kind === "table" && !!curSheet()}>
              <Text style={{ color: tc("#f5f5f58f"), fontSize: 11, lineHeight: 14 }}>{`${Math.max(0, (curSheet()?.rows.length ?? 1) - 1)} rows`}</Text>
            </If>
          </View>
          <View style={{ flex: 1, minWidth: 0 }} />
          {/* spreadsheet: sheet tabs in the header (Grok) — the office view has its own */}
          <If when={viewing()!.kind === "table" && !rendered()?.office && (rendered()?.sheets?.length ?? 0) > 1}>
            <View style={{ flexDirection: "row", gap: 4, marginRight: 4 }}>
              {(rendered()?.sheets ?? []).map((sh, i) => (
                <View
                  onPress={() => {
                    sheet.set(i);
                    selA.set(null);
                    selB.set(null);
                  }}
                  activeOpacity={0.7}
                  style={{ height: 24, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center", backgroundColor: sheet() === i ? tc("#f5f5f514") : "transparent" }}
                >
                  <Text style={{ color: sheet() === i ? tc("#f5f5f5") : tc("#f5f5f58f"), fontSize: 13, lineHeight: 18 }}>{sh.name}</Text>
                </View>
              ))}
            </View>
          </If>
          {/* HTML: Grok's Preview / Source toggle (24pt, radius 7, 8% selected) */}
          <If when={viewing()!.kind === "html"}>
            <View style={{ flexDirection: "row", gap: 4, marginRight: 4 }}>
              {(["preview", "source"] as const).map((m) => (
                <View
                  onPress={() => htmlMode.set(m)}
                  activeOpacity={0.7}
                  accessibilityLabel={m === "preview" ? "Preview" : "Source"}
                  style={{ height: 24, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center", backgroundColor: htmlMode() === m ? tc("#f5f5f514") : "transparent" }}
                >
                  <Text style={{ color: htmlMode() === m ? tc("#f5f5f5") : tc("#f5f5f58f"), fontSize: 13, lineHeight: 18 }}>{m === "preview" ? "Preview" : "Source"}</Text>
                </View>
              ))}
            </View>
          </If>
          <View onPress={() => saveFile(viewing()!)} activeOpacity={0.7} accessibilityLabel="Download" style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: tc("#f5f5f50f") }}>
            <Text style={{ color: tc("#f5f5f5a8"), fontSize: 14 }}>⤓</Text>
          </View>
          <View onPress={() => viewing.set(null)} activeOpacity={0.7} accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: tc("#f5f5f50f") }}>
            <Text style={{ color: tc("#f5f5f5a8"), fontSize: 13 }}>✕</Text>
          </View>
        </View>
        <View style={{ flex: 1, backgroundColor: viewing()!.kind === "text" || viewing()!.kind === "json" || (viewing()!.kind === "html" && htmlMode() === "source") ? (dark() ? "#212121" : "#fcfcfc") : "transparent" }}>
          {body()}
        </View>
      </View>
    </If>
  );
}
