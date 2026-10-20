declare module "*/markatlas.mjs" {
  export type AtlasEntry = { mirror: 0 | 1; m: number; c: number; kf: number; r: string };
  export type Atlas = { step: number; k: number; mirror: boolean; m: number; c: number; kf: number; bytes: Uint8Array };
  export function decodeAtlas(entry: AtlasEntry, step: number, k: number): Atlas;
  export function atlasOutline(atlas: Atlas, n: number, yaw: number, pitch: number, roll: number): string;
}
