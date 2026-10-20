import { Path2D } from "nsh/canvas";
import type { MarkTree } from "./motion.mjs";

const paths = new Map<string, Path2D>();

const pathOf = (data: string) => {
  let path = paths.get(data);
  if (!path) {
    if (paths.size >= 256) {
      const oldest = paths.keys().next();
      if (!oldest.done) paths.delete(oldest.value);
    }
    path = new Path2D(data);
    paths.set(data, path);
  }
  return path;
};

const numberAttr = (attrs: MarkTree["attrs"], key: string, fallback = 0) => {
  const value = attrs[key];
  return value == null ? fallback : Number(value);
};

const applyTransform = (ctx: any, value: unknown) => {
  if (typeof value !== "string") return;
  for (const [, name, raw] of value.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)) {
    const args = raw.trim().split(/[\s,]+/).map(Number);
    if (name === "matrix" && args.length === 6) ctx.transform(...args);
    else if (name === "translate") ctx.translate(args[0] ?? 0, args[1] ?? 0);
    else if (name === "scale") ctx.scale(args[0] ?? 1, args[1] ?? args[0] ?? 1);
    else if (name === "rotate") {
      const angle = ((args[0] ?? 0) * Math.PI) / 180;
      if (args.length >= 3) {
        ctx.translate(args[1], args[2]);
        ctx.rotate(angle);
        ctx.translate(-args[1], -args[2]);
      } else {
        ctx.rotate(angle);
      }
    }
  }
};

const collectDefs = (tree: MarkTree, defs: Map<string, MarkTree>) => {
  if (typeof tree.attrs.id === "string") defs.set(tree.attrs.id, tree);
  for (const child of tree.children) collectDefs(child, defs);
};

// The mask's white rect (in the masked element's own user space) minus its
// black eye paths — never the root viewBox, which is a different space.
const maskPath = (mask: MarkTree) => {
  const rect = mask.children.find((child) => child.tag === "rect") ?? mask;
  const x = numberAttr(rect.attrs, "x");
  const y = numberAttr(rect.attrs, "y");
  const w = numberAttr(rect.attrs, "width");
  const h = numberAttr(rect.attrs, "height");
  const holes = mask.children
    .filter((child) => child.tag === "path" && child.attrs.fill === "#000")
    .map((child) => String(child.attrs.d ?? ""))
    .join("");
  return pathOf(`M${x} ${y}H${x + w}V${y + h}H${x}Z${holes}`);
};

const paintNode = (
  ctx: any,
  tree: MarkTree,
  defs: Map<string, MarkTree>,
  inheritedFill: string,
  parentAlpha: number,
) => {
  if (tree.tag === "defs" || tree.tag === "mask") return;

  const attrs = tree.attrs;
  const opacity = Number(attrs.opacity ?? 1);
  const alpha = parentAlpha * (Number.isFinite(opacity) ? opacity : 1);
  ctx.save();
  applyTransform(ctx, attrs.transform);

  const maskRef = typeof attrs.mask === "string" ? /#([^)\s]+)/.exec(attrs.mask)?.[1] : undefined;
  const mask = maskRef ? defs.get(maskRef) : undefined;
  if (mask) {
    ctx.save();
    ctx.clip(maskPath(mask), "evenodd");
  }

  if (tree.tag === "svg" || tree.tag === "g") {
    for (const child of tree.children) {
      paintNode(ctx, child, defs, inheritedFill, alpha);
    }
  } else if (tree.tag === "use") {
    const href = String(attrs.href ?? attrs["xlink:href"] ?? "");
    const ref = defs.get(href.replace(/^#/, ""));
    if (ref) {
      const fill = typeof attrs.fill === "string" ? attrs.fill : inheritedFill;
      paintNode(ctx, ref, defs, fill, alpha);
    }
  } else if (tree.tag === "path") {
    const pathData = String(attrs.d ?? "");
    if (pathData) {
      const path = pathOf(pathData);
      const fill = typeof attrs.fill === "string" ? attrs.fill : inheritedFill;
      ctx.globalAlpha = alpha;
      if (fill !== "none") {
        ctx.fillStyle = fill;
        ctx.fill(path, attrs["fill-rule"] === "evenodd" ? "evenodd" : "nonzero");
      }
      if (typeof attrs.stroke === "string" && attrs.stroke !== "none") {
        ctx.strokeStyle = attrs.stroke;
        ctx.lineWidth = numberAttr(attrs, "stroke-width", 1);
        ctx.lineCap = String(attrs["stroke-linecap"] ?? "butt");
        ctx.lineJoin = String(attrs["stroke-linejoin"] ?? "miter");
        ctx.stroke(path);
      }
    }
  } else if (tree.tag === "circle") {
    const path = new Path2D();
    path.arc(
      numberAttr(attrs, "cx"),
      numberAttr(attrs, "cy"),
      numberAttr(attrs, "r"),
      0,
      Math.PI * 2,
    );
    const fill = typeof attrs.fill === "string" ? attrs.fill : inheritedFill;
    ctx.globalAlpha = alpha;
    if (fill !== "none") {
      ctx.fillStyle = fill;
      ctx.fill(path);
    }
    if (typeof attrs.stroke === "string" && attrs.stroke !== "none") {
      ctx.strokeStyle = attrs.stroke;
      ctx.lineWidth = numberAttr(attrs, "stroke-width", 1);
      const dash = String(attrs["stroke-dasharray"] ?? "")
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      ctx.setLineDash(dash);
      ctx.stroke(path);
      ctx.setLineDash([]);
    }
  }

  if (mask) ctx.restore();
  ctx.restore();
};

export function paintTree(ctx: any, tree: MarkTree, x: number, y: number, px: number) {
  if (tree.tag !== "svg") return;
  const viewBox = String(tree.attrs.viewBox ?? "0 0 1 1").split(/[\s,]+/).map(Number);
  const [viewX = 0, viewY = 0, width = 1, height = width] = viewBox;
  const scale = px / Math.max(width, height);
  const defs = new Map<string, MarkTree>();
  collectDefs(tree, defs);

  ctx.save();
  ctx.translate(x - viewX * scale, y - viewY * scale);
  ctx.scale(scale, scale);
  for (const child of tree.children) {
    paintNode(ctx, child, defs, "#000", 1);
  }
  ctx.restore();
}
