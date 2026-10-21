import { signal } from "nsh";

// while the chat scrolls, hover bars stay dark — every row the pointer
// crosses would otherwise light up mid-scroll (noise + wasted layout).
// Recycled list cells also read this to defer heavy mounts (WebViews, audio
// players, mini apps) until the scroll settles: mount light, upgrade on idle.
export const chatScrolling = signal(false);
