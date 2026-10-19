// Light / dark theme, Grok Bot's palettes (Sand's tokens: light from its
// `:root`, dark measured live over CDP). The UI is written in the dark
// neutrals; `tc()` maps each to its light counterpart while the light theme
// is on, so styles stay one literal each and re-render when the theme flips.
// Brand, bot and status colors pass through unchanged.
import { context, signal } from "nsh";
import { colorScheme } from "nsh/device";

export type ThemePref = "system" | "dark" | "light";
export const themePref = signal<ThemePref>("dark");
export const appearance = (): "dark" | "light" =>
  themePref() === "system" ? (colorScheme() === "light" ? "light" : "dark") : (themePref() as "dark" | "light");
// the toggle's cycle (bir's shell): Light → Dark → System
export const nextTheme = (p: ThemePref): ThemePref => (p === "light" ? "dark" : p === "dark" ? "system" : "light");

// dark neutral → light (Sand: bg-sidebar #f5f5f5, bg-pane/elevated #fff,
// bg-chrome #fcfcfc, hover #1c1c1c0f, active #1c1c1c14, text #1c1c1c…)
const SOLID: Record<string, string> = {
  "#0e0e0e": "#f5f5f5",
  "#121212": "#ffffff",
  "#161616": "#fcfcfc",
  "#1a1a1a": "#fafafa",
  "#1f1f1f": "#ffffff",
  "#222222": "#1c1c1c0f",
  "#242424": "#1c1c1c0f",
  "#262626": "#1c1c1c14",
  "#2a2a2a": "#1c1c1c14",
  "#2c2c2c": "#1c1c1c14",
};
// text/icon alphas differ slightly between Sand's ramps
const ALPHA: Record<string, string> = { a8: "ad", "8a": "8f", e6: "eb", a3: "a8" };

// Inside a filled user bubble the text stays light in both themes (Sand's
// text-on-primary), so `tc` passes the dark-theme values through there.
export const OnFill = context(false);

export function tc(c: string): string {
  if (appearance() === "dark" || OnFill()) return c;
  const k = c.toLowerCase();
  if (SOLID[k]) return SOLID[k];
  if (k.startsWith("#f5f5f5")) return "#1c1c1c" + (ALPHA[k.slice(7)] ?? k.slice(7));
  const m = /^rgba\((245|22|14|18),\s*\1,\s*\1,\s*([\d.]+)\)$/.exec(k);
  if (m) return m[1] === "245" ? `rgba(28,28,28,${m[2]})` : `rgba(255,255,255,${m[2]})`;
  return c;
}
// gradients: swap the dark neutral stops
export const tg = (g: string) => (appearance() === "dark" ? g : g.replace(/rgba\((\d+),(\d+),(\d+),/g, (_m, r) => (r === "22" || r === "14" || r === "18" ? "rgba(255,255,255," : _m)));

// ————— user chat bubbles take the bot's color (Sand's fill/{role}-bubble-user) —————
// Colored bots: the role's Fill step (palette 1) on dark, FillHover (palette
// 2) on light. The adaptive white/black ink (and gray, which has no role)
// uses the neutral bubble: 18% of #f5f5f5 on dark, solid #1c1c1c on light.
const BUBBLE: Record<string, [string, string]> = {
  "#FC2C3E": ["#cf2b35", "#c82532"], // red
  "#F9670E": ["#cd5309", "#d2550a"], // orange
  "#F69412": ["#c8770c", "#c2730b"], // yellow
  "#14C370": ["#0e9f5a", "#0d9655"], // green
  "#13B8A3": ["#0e9886", "#0d9381"], // cyan
  "#1884FC": ["#116dd2", "#126fd4"], // blue
  "#905AFB": ["#7845d7", "#7442d1"], // purple
  "#FB3499": ["#cf297e", "#c82779"], // magenta
  "#A16B39": ["#8c5d31", "#86592e"], // brown
};
/** the active bot's (normalized) color; "" for plain chats */
export const bubbleColor = signal("");
export const bubbleFill = () => {
  const b = BUBBLE[bubbleColor().toUpperCase()];
  return b ? b[appearance() === "dark" ? 0 : 1] : appearance() === "dark" ? "rgba(245,245,245,0.18)" : "#1c1c1c";
};
