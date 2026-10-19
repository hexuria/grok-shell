// Grok's media viewer (`sand-media-viewer`): a dark full-window overlay with
// the media centered, a top bar (download · close), a caption "name · i / n"
// and a filmstrip of thumbnails; ← / → step, Escape closes. Diagrams get the
// zoom pill (− · + · fit) Grok shows for Mermaid.
import { cleanup, effect, signal, Text, View } from "nsh";
import { Image } from "nsh/image";
import { Video } from "nsh/video";
import { WebView } from "nsh/webview";
import { keymap } from "nsh/keymap";
import { appearance } from "./theme";

const GEN = "http://127.0.0.1:8787";
export type LightItem =
  | { kind: "image"; uri: string; name: string; path?: string; w?: number; h?: number }
  | { kind: "video"; uri: string; name: string; path?: string; poster?: string; w?: number; h?: number }
  | { kind: "diagram"; code: string; name: string };

const items = signal<LightItem[]>([]);
const index = signal(0);
const zoom = signal(1);
const stage = signal({ width: 0, height: 0 });
// a diagram's card size (its page reports it, and again after each zoom step):
// the web view is sized to the card so clicks beside it reach the backdrop
const diag = signal({ w: 0, h: 0 });
export const lightboxOpen = () => items().length > 0;
export function openLightbox(list: LightItem[], at = 0) {
  items.set(list);
  diag.set({ w: 0, h: 0 });
  index.set(Math.max(0, Math.min(at, list.length - 1)));
  zoom.set(1);
}
const close = () => items.set([]);
const step = (d: number) => {
  if (items().length < 2) return;
  index.set((index() + d + items().length) % items().length);
  zoom.set(1);
};
export const mermaidUrl = (code: string, mode: "inline" | "full") => {
  const b64 = btoa(unescape(encodeURIComponent(code))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${GEN}/mermaid?d=${b64}&theme=${appearance()}&mode=${mode}`;
};
// SVG: the native decoder only does raster formats, so SVGs draw through
// WebKit (an <img>, which also plays SMIL / CSS animation). A clear layer on
// top takes the presses, which the web view would otherwise swallow.
export const isSvg = (uri: string) => /\.svg(\?|$)/i.test(uri);
export function SvgView(props: { uri: string; fit: "cover" | "contain"; style: any; onPress?: () => void }) {
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden"><img src="${props.uri}" style="width:100vw;height:100vh;object-fit:${props.fit};display:block"></body></html>`;
  return (
    <View style={props.style}>
      <WebView source={{ html, baseUrl: GEN }} scrollEnabled={false} style={{ width: "100%", height: "100%", backgroundColor: "transparent" }} />
      <View onPress={props.onPress} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
    </View>
  );
}
const save = (path?: string) =>
  path && fetch(`${GEN}/file/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) }).catch(() => null);

// the media surface itself is rounded (Grok's centered card): a wrapper clips
// the image / video / web view, so the corners hold at every zoom step
const mediaCard = { borderRadius: 12, overflow: "hidden", borderWidth: 0.5, borderColor: "#ffffff1a" } as const;

const roundBtn = (glyph: string, label: string, onPress: () => void) => (
  <View
    onPress={onPress}
    activeOpacity={0.7}
    accessibilityLabel={label}
    style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#ffffff1a" }}
  >
    <Text style={{ color: "#ffffffd9", fontSize: 14 }}>{glyph}</Text>
  </View>
);

export function Lightbox() {
  let web: any;
  effect(() => {
    if (!lightboxOpen()) return;
    const offs = [keymap.bind("escape", close), keymap.bind("left", () => step(-1)), keymap.bind("right", () => step(1))];
    cleanup(() => offs.forEach((f) => f()));
  });
  const cur = () => items()[index()];
  // the media box is fitted to the media's own aspect, so a video's native
  // (black) player view never letterboxes and clicks beside it hit the backdrop
  const fit = () => {
    const c: any = cur();
    const { width: sw, height: sh } = stage();
    if (!sw || !sh) return { width: 0, height: 0 };
    const w = c?.w || (c?.kind === "video" ? 16 : 0), h = c?.h || (c?.kind === "video" ? 9 : 0);
    if (!w || !h) return { width: sw, height: sh };
    const k = Math.min(sw / w, sh / h);
    return { width: Math.round(w * k), height: Math.round(h * k) };
  };
  const zoomBy = (k: number | "fit") => {
    if (cur()?.kind === "diagram") web?.postMessage(k === "fit" ? "fit" : k > 1 ? "in" : "out");
    else zoom.set(k === "fit" ? 1 : Math.max(0.25, Math.min(4, zoom() * k)));
  };
  return (
    <If when={lightboxOpen()}>
      {/* Grok: near-black, slightly see-through, the same in light and dark */}
      <View style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#000000eb" }}>
        <View onPress={close} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />
        {/* the media */}
        <View
          pointerEvents="box-none"
          onLayout={(e) => stage.set({ width: e.width, height: e.height })}
          style={{ position: "absolute", left: 60, right: 60, top: 64, bottom: items().length > 1 ? 120 : 76, alignItems: "center", justifyContent: "center" }}
        >
          {cur()?.kind === "image" && isSvg((cur() as any).uri) ? (
            <SvgView uri={(cur() as any).uri} fit="contain" style={{ ...fit(), transform: [{ scale: zoom() }], ...mediaCard }} />
          ) : cur()?.kind === "image" ? (
            <View style={{ ...fit(), transform: [{ scale: zoom() }], ...mediaCard }}>
              <Image
                src={{ uri: (cur() as any).uri }}
                resizeMode="contain"
                fadeDuration={0}
                style={{ width: "100%", height: "100%" }}
              />
            </View>
          ) : cur()?.kind === "video" ? (
            <View style={{ ...fit(), ...mediaCard }}>
              <Video source={{ uri: (cur() as any).uri }} controls paused={false} resizeMode="contain" style={{ width: "100%", height: "100%", backgroundColor: "transparent" }} />
            </View>
          ) : cur()?.kind === "diagram" ? (
            <WebView
              ref={web}
              source={{ uri: mermaidUrl((cur() as any).code, "full") }}
              scrollEnabled={false}
              onMessage={(e) => {
                try {
                  const d = JSON.parse(e.data);
                  if (d.w && d.h) diag.set({ w: d.w, h: d.h });
                } catch {}
              }}
              style={{
                width: diag().w ? Math.min(stage().width, diag().w) : "100%",
                height: diag().h ? Math.min(stage().height, diag().h) : "100%",
                backgroundColor: "transparent",
              }}
            />
          ) : null}
        </View>
        {/* top bar */}
        <View style={{ position: "absolute", top: 12, right: 12, flexDirection: "row", gap: 8 }}>
          <If when={cur()?.kind !== "diagram"}>{roundBtn("⤓", "Download", () => save((cur() as any)?.path))}</If>
          {roundBtn("✕", "Close", close)}
        </View>
        {/* caption + filmstrip */}
        <If when={items().length > 1 || cur()?.kind !== "diagram"}>
          <View style={{ position: "absolute", left: 0, right: 0, bottom: 16, alignItems: "center", gap: 10 }}>
            <Text numberOfLines={1} style={{ color: "#ffffffcc", fontSize: 12, lineHeight: 16 }}>
              {`${cur()?.name ?? ""}${items().length > 1 ? ` · ${index() + 1} / ${items().length}` : ""}`}
            </Text>
            <If when={items().length > 1}>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {items().map((it, i) => (
                  <View
                    onPress={() => {
                      index.set(i);
                      zoom.set(1);
                    }}
                    activeOpacity={0.8}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 6,
                      overflow: "hidden",
                      borderWidth: 2,
                      borderColor: i === index() ? "#ffffff" : "transparent",
                      opacity: i === index() ? 1 : 0.6,
                      backgroundColor: "#ffffff1a",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {it.kind === "image" && isSvg(it.uri) ? (
                      <SvgView uri={it.uri} fit="cover" style={{ width: 40, height: 40 }} onPress={() => { index.set(i); zoom.set(1); }} />
                    ) : it.kind === "image" || (it.kind === "video" && it.poster) ? (
                      <Image src={{ uri: it.kind === "video" ? it.poster! : it.uri }} resizeMode="cover" fadeDuration={0} style={{ width: 40, height: 40 }} />
                    ) : (
                      <Text style={{ color: "#ffffffb3", fontSize: 12 }}>{it.kind === "video" ? "" : "◇"}</Text>
                    )}
                    {/* videos: Grok's round play badge over the thumbnail */}
                    <If when={it.kind === "video"}>
                      <View style={{ position: "absolute", width: 20, height: 20, borderRadius: 10, backgroundColor: "#000000a6", alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ color: "#ffffff", fontSize: 9, lineHeight: 11, marginLeft: 1 }}>▶</Text>
                      </View>
                    </If>
                  </View>
                ))}
              </View>
            </If>
          </View>
        </If>
        {/* zoom pill (diagrams and images) */}
        <If when={cur()?.kind === "diagram" || cur()?.kind === "image"}>
          <View
            style={{
              position: "absolute",
              alignSelf: "center",
              bottom: items().length > 1 ? 96 : 44,
              flexDirection: "row",
              gap: 2,
              padding: 3,
              borderRadius: 10,
              backgroundColor: "#1f1f1fe6",
              borderWidth: 0.5,
              borderColor: "#ffffff1a",
            }}
          >
            {roundPill("−", "Zoom out", () => zoomBy(1 / 1.25))}
            {roundPill("+", "Zoom in", () => zoomBy(1.25))}
            {roundPill("⤢", "Fit", () => zoomBy("fit"))}
          </View>
        </If>
      </View>
    </If>
  );
}
const roundPill = (glyph: string, label: string, onPress: () => void) => (
  <View onPress={onPress} activeOpacity={0.7} accessibilityLabel={label} style={{ width: 28, height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" }}>
    <Text style={{ color: "#ffffffd9", fontSize: 14 }}>{glyph}</Text>
  </View>
);
