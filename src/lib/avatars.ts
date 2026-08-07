/**
 * The preset avatar shelf. A fixed gallery instead of uploads: nothing to
 * moderate, nothing to store, every face fits the parlour. Ids are what the
 * database stores; never rename one that has shipped.
 */
export const AVATARS = [
  { id: "cup", label: "The Cup", src: "/avatars/cup.svg" },
  { id: "teapot", label: "The Teapot", src: "/avatars/teapot.svg" },
  { id: "kettle", label: "The Kettle", src: "/avatars/kettle.svg" },
  { id: "leaf", label: "The Leaf", src: "/avatars/leaf.svg" },
  { id: "matcha", label: "The Whisk", src: "/avatars/matcha.svg" },
  { id: "lemon", label: "The Lemon", src: "/avatars/lemon.svg" },
  { id: "sugar", label: "The Sugar", src: "/avatars/sugar.svg" },
  { id: "teabag", label: "The Teabag", src: "/avatars/teabag.svg" },
] as const;

export type AvatarId = (typeof AVATARS)[number]["id"];

export function isAvatarId(value: string): value is AvatarId {
  return AVATARS.some((avatar) => avatar.id === value);
}

export function avatarSrc(id: string | null | undefined): string | undefined {
  return AVATARS.find((avatar) => avatar.id === id)?.src;
}
