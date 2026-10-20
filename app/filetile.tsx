// Attachment tiles: images and videos show their thumbnail (a video gets a
// play badge); other files show Grok's per-extension icon and color (its
// get-file-icon table: markdown, pdf red, docs/slides blue, sheets green, …).
import { Text, View } from "nsh";
import { Image } from "nsh/image";
import { tc } from "./theme";

// file:// avatars / attachments → the generation server (the media grant is
// 127.0.0.1; nsh refuses file:// URLs outside it)
export const mediaUrl = (uri: string) => {
  const m = uri.match(/\/generated\/(attachments|avatars)\/([^/]+)$/);
  return uri.startsWith("file://") && m ? `http://127.0.0.1:8787/files/${m[1]}/${encodeURIComponent(decodeURIComponent(m[2]))}` : uri;
};

export type Attachment = { uri: string; thumb?: string; name: string; ext?: string; kind: "image" | "video" | "file" };

// Grok's icon colors (iconXPrimary) and its icons, drawn as glyphs
const C = {
  red: "#f2555a",
  blue: "#4d9bff",
  green: "#3ecf8e",
  yellow: "#f5b400",
  cyan: "#22c3b4",
  orange: "#ff8a3d",
  purple: "#a78bfa",
  magenta: "#f062a8",
};
const ICONS: Record<string, [string, string]> = {
  md: ["M↓", ""], markdown: ["M↓", ""], mdx: ["M↓", ""],
  pdf: ["PDF", C.red],
  pptx: ["≡", C.blue], ppt: ["≡", C.blue], docx: ["≡", C.blue], doc: ["≡", C.blue], pages: ["≡", C.blue], rtf: ["≡", C.blue],
  key: ["⚿", C.yellow],
  xlsx: ["▦", C.green], xls: ["▦", C.green], csv: ["▦", C.green], numbers: ["▦", C.green], tsv: ["▦", C.green],
  txt: ["¶", ""], log: ["¶", ""],
  json: ["{ }", C.yellow], yaml: ["Y", C.red], yml: ["Y", C.red], toml: ["⚙︎", ""],
  html: ["</>", C.blue], css: ["#", C.magenta], scss: ["#", C.magenta],
  js: ["JS", C.yellow], jsx: ["⚛︎", C.cyan], ts: ["TS", C.blue], tsx: ["⚛︎", C.cyan],
  py: ["Py", C.blue], rs: ["Rs", C.orange], go: ["Go", C.cyan], swift: ["Sw", C.orange], sql: ["⛁", C.cyan],
  zip: ["⊞", C.yellow], gz: ["⊞", C.yellow], tar: ["⊞", C.yellow], rar: ["⊞", C.yellow], "7z": ["⊞", C.yellow],
  mov: ["▶", C.red], mp4: ["▶", C.red], m4v: ["▶", C.red], webm: ["▶", C.red],
  mp3: ["∿", C.purple], wav: ["∿", C.purple], m4a: ["∿", C.purple], aac: ["∿", C.purple],
  png: ["▣", C.cyan], jpg: ["▣", C.cyan], jpeg: ["▣", C.cyan], gif: ["▣", C.cyan], webp: ["▣", C.cyan], heic: ["▣", C.cyan],
  svg: ["◇", C.orange],
};
export const extOf = (a: Attachment) => (a.ext || a.name.match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
export const iconOf = (a: Attachment): [string, string] => {
  const [g, c] = ICONS[extOf(a)] ?? ["▤", ""];
  return [g, c || tc("#f5f5f5a8")];
};

/** A square tile (`size` pt): thumbnail, or icon + name. */
export function FileTile(props: { a: Attachment; size: number; radius?: number }) {
  const a = props.a;
  const pic = a.thumb || (a.kind === "image" ? a.uri : "");
  const [glyph, color] = iconOf(a);
  return (
    <View
      style={{
        width: props.size,
        height: props.size,
        borderRadius: props.radius ?? 12,
        borderWidth: 0.5,
        borderColor: tc("#f5f5f51f"),
        overflow: "hidden",
        backgroundColor: tc("#161616"),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {pic ? (
        <Image src={{ uri: mediaUrl(pic) }} resizeMode="cover" fadeDuration={0} style={{ position: "absolute", left: 0, top: 0, width: props.size, height: props.size }} />
      ) : (
        <View style={{ alignItems: "center", gap: 3, paddingHorizontal: 5 }}>
          <Text style={{ color, fontSize: glyph.length > 2 ? 11 : 17, fontWeight: "700" }}>{glyph}</Text>
          <Text numberOfLines={2} style={{ color: tc("#f5f5f58a"), fontSize: 9, lineHeight: 11, textAlign: "center" }}>{a.name}</Text>
        </View>
      )}
      {a.kind === "video" && pic ? (
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#0000008c", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#ffffff", fontSize: 9, marginLeft: 1 }}>▶</Text>
        </View>
      ) : null}
    </View>
  );
}
