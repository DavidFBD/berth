/**
 * The column's slow turn: one kept post comes in at the top, the bottom one
 * goes to the back of the queue, so every post Jev kept this refresh gets its
 * time on the page and none is shown as newer than it is (each card carries
 * its own real time). Pure, so the loop can be tested without a clock.
 */
export type Rotation<T> = { visible: T[]; queue: T[] };

export function startRotation<T>(items: readonly T[], reserve: readonly T[]): Rotation<T> {
  return { visible: [...items], queue: [...reserve] };
}

export function turn<T>({ visible, queue }: Rotation<T>): Rotation<T> {
  if (queue.length === 0 || visible.length === 0) return { visible, queue };
  const [next, ...rest] = queue;
  const leaving = visible[visible.length - 1];
  return { visible: [next, ...visible.slice(0, -1)], queue: [...rest, leaving] };
}

/**
 * When the next card arrives: the first a little sooner, so a visitor sees
 * the column move while they are still looking at it, then every eighteen to
 * twenty-four seconds. The spread keeps it from reading as a metronome.
 */
export function nextDelayMs(turnsSoFar: number, random: () => number = Math.random): number {
  if (turnsSoFar === 0) return 9_000;
  return 18_000 + Math.round(random() * 6_000);
}
