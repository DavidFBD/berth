"use client";

import { useEffect } from "react";

/**
 * The switch behind the grain and glass trial.
 *
 * The brand sheet bans both in as many words ("No glow, blur, glass, 3D, or
 * photographs"), so neither ships on by default: this exists so the two can
 * be judged against the live app before the sheet is amended, not to sneak
 * past it. A query parameter sets it and it sticks, so the comparison
 * survives a reload and can be sent to someone else as a link.
 *
 *   ?texture=grain   the noise layer alone
 *   ?texture=glass   the frosted header and scrim alone
 *   ?texture=on      both
 *   ?texture=off     back to the shipped look
 *
 * Applied in an effect and never during render: the server cannot know what
 * this browser last chose, and guessing would tear the first paint.
 */
const KEY = "berth.texture";
const ALLOWED = new Set(["grain", "glass", "on"]);

export function TextureFlag() {
  useEffect(() => {
    let choice: string | null = null;
    try {
      const wanted = new URLSearchParams(window.location.search).get("texture");
      if (wanted === "off") {
        localStorage.removeItem(KEY);
      } else if (wanted && ALLOWED.has(wanted)) {
        localStorage.setItem(KEY, wanted);
      }
      choice = localStorage.getItem(KEY);
    } catch {
      // A browser with storage blocked simply gets the shipped look.
    }
    const root = document.documentElement;
    if (choice && ALLOWED.has(choice)) root.dataset.texture = choice;
    else delete root.dataset.texture;
  }, []);

  return null;
}
