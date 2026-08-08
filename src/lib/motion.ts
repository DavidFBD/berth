/**
 * The house springs. One source of truth so the same job always moves the
 * same way; pick by job, not by vibes. Easing curves live in globals.css
 * (@theme) as --ease-tea / --ease-lift / --ease-settle / --ease-drawer;
 * EASE_LIFT mirrors --ease-lift for framer-motion tweens.
 */
export const SPRING_SHELF = { type: "spring", stiffness: 340, damping: 34 } as const;
export const SPRING_POP = { type: "spring", stiffness: 480, damping: 24 } as const;
export const SPRING_CUP = { type: "spring", stiffness: 420, damping: 26 } as const;

/** cubic-bezier(0.23, 1, 0.32, 1) — entrances, exits, state flips. */
export const EASE_LIFT = [0.23, 1, 0.32, 1] as const;
