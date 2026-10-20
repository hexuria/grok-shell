declare module "*/motion.mjs" {
  export type MarkMorph =
    | "dots"
    | "orbit"
    | "radar"
    | "progress"
    | "gather"
    | "wave"
    | "send"
    | "receive"
    | "dock"
    | "pencil"
    | "bang"
    | "standby"
    | "ball";

  export type MarkTree = {
    tag: string;
    attrs: Record<string, string | number | boolean>;
    children: MarkTree[];
  };

  export type MarkFrame = {
    quat: number[];
    [key: string]: unknown;
  };

  export type MarkEngine = {
    isSettled: boolean;
    isPlaying: boolean;
    setBody(body: string): void;
    setGaze(gaze: [number, number] | null): void;
    poke(kind: string, options?: { turns?: number }): void;
    advance(dt: number): void;
    frame(): MarkFrame;
  };

  export type MarkDirector = {
    setState(state: string): void;
    setResting(resting: boolean): void;
    setEmphasis(emphasized: boolean): void;
    setCompact(compact: boolean): void;
    advance(dt: number): void;
  };

  export type MarkState = {
    clips: string[];
    compactClips?: string[];
    face?: string;
    morph?: string;
    next?: string;
    holdSeconds?: number;
  };

  export type MarkStateGroup = {
    label: string;
    states: string[];
  };

  export function ih(options: { body: string }): MarkEngine;
  export function rv(
    engine: MarkEngine,
    state: string,
    options: { seed: number; isCompact: boolean; isResting: boolean },
  ): MarkDirector;
  export function Uh(
    frame: MarkFrame,
    options: {
      ink: [number, number, number];
      spot: [number, number, number];
      cutout: boolean;
      inkPaint: string;
    },
    width: number,
    id: string,
    size: { displaySize: number; extent: string },
  ): MarkTree;
  export const Zx: MarkStateGroup[];
  export const UN: string[];
  export function YN(shape: string): string;
  export const vx: Record<string, MarkMorph>;
  export const yl: Record<string, MarkState>;
  export function rP(seed: string): number;
  /** IM()'s outline cache, keyed `${body} ${n} ${yaw} ${pitch} ${roll}` */
  export const Wn: Map<string, string[]>;
}
