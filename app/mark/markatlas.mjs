// Grok's mark outlines from a pre-solved atlas (tools/grok-mark/bake-atlas.mjs):
// IM()'s silhouette over a (yaw, pitch) grid at roll 0, each node stored as
// its area centroid plus radii around it (the projected origin can fall
// outside a heart's or cloud's notch). yS applies roll last, after
// projection, so roll is a plain 2D turn here; between grid nodes each
// neighbour is first turned into the query's image frame, so blends near the
// poles (where yaw becomes an in-plane spin) don't smear.
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// yS's rotation at roll 0, as rows: X = a·p, Y = b·p, view axis d
const rows = (yaw, pitch) => {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [cy, 0, sy, sy * sp, cp, -cy * sp, -sy * cp, sp, cy * cp];
};

export function decodeAtlas(entry, step, k) {
  const bin = atob(entry.r);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { step, k, mirror: entry.mirror === 1, m: entry.m, c: entry.c, kf: entry.kf, bytes };
}

// IM(body, {yaw, pitch, roll}, n)'s outline as gc() path data
export function atlasOutline(A, n, yaw, pitch, roll) {
  const { step, k: K, mirror, bytes } = A;
  const J = 360 / step, P = 180 / step + 1, cols = mirror ? 180 / step + 1 : J;
  const q = rows(yaw * DEG, pitch * DEG);
  const u = ((((yaw + 180) / step) % J) + J) % J, j0 = Math.floor(u) % J, ty = u - Math.floor(u);
  const v = Math.max(0, Math.min(P - 1, (pitch + 90) / step)), k0 = Math.min(P - 2, Math.floor(v)), tp = v - k0;
  const radii = new Float64Array(K);
  let cx = 0, cy = 0;
  const nodes = [[j0, k0, (1 - ty) * (1 - tp)], [(j0 + 1) % J, k0, ty * (1 - tp)], [j0, k0 + 1, (1 - ty) * tp], [(j0 + 1) % J, k0 + 1, ty * tp]];
  for (const [j, row, w] of nodes) {
    if (w <= 0) continue;
    const nodeYaw = -180 + j * step;
    const r = rows(nodeYaw * DEG, (-90 + row * step) * DEG);
    // the query's image x-axis, laid into this node's view plane
    const dot = q[0] * r[6] + q[1] * r[7] + q[2] * r[8];
    const ax = q[0] - dot * r[6], ay = q[1] - dot * r[7], az = q[2] - dot * r[8];
    const phi = Math.atan2(ax * r[3] + ay * r[4] + az * r[5], ax * r[0] + ay * r[1] + az * r[2]);
    // a mirror-symmetric body stores yaw ≥ 0: (−yaw) is the X-mirror
    const flip = mirror && nodeYaw < 0;
    const base = (row * cols + (mirror ? Math.round(Math.abs(nodeYaw) / step) : j)) * (K + 2);
    const ncx = ((bytes[base] / 255) * 2 - 1) * A.c * (flip ? -1 : 1), ncy = ((bytes[base + 1] / 255) * 2 - 1) * A.c;
    cx += w * (ncx * Math.cos(phi) + ncy * Math.sin(phi));
    cy += w * (ncy * Math.cos(phi) - ncx * Math.sin(phi));
    for (let i = 0; i < K; i++) {
      let t = (TAU * i) / K + phi;
      if (flip) t = Math.PI - t;
      let f = ((t / TAU) * K) % K;
      if (f < 0) f += K;
      const i0 = Math.floor(f) % K, fr = f - Math.floor(f);
      radii[i] += w * (bytes[base + 2 + i0] * (1 - fr) + bytes[base + 2 + ((i0 + 1) % K)] * fr);
    }
  }
  const c = n / 2, o = A.kf * n, s = A.m / 255, turn = roll * DEG, ct = Math.cos(turn), st = Math.sin(turn);
  let d = "";
  for (let i = 0; i < K; i++) {
    const t = (TAU * i) / K, px = cx + s * radii[i] * Math.cos(t), py = cy + s * radii[i] * Math.sin(t);
    const x = Math.round((c + o * (px * ct - py * st)) * 100) / 100;
    const y = Math.round((c - o * (py * ct + px * st)) * 100) / 100;
    d += `${i ? " " : "M"}${x} ${y}`;
  }
  return `${d}Z`;
}
