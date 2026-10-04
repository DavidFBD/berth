import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  DOOR_ATTR,
  DOOR_MARK_KEY,
  DOOR_MARK_MS,
  DOOR_SCRIPT,
  DOOR_WAIT,
  doorDecide,
  doorMark,
  doorStart,
  isStaffPath,
  justLetIn,
  knock,
  type KnockDeps,
} from "@/lib/staff/door";

const NOW = 1_800_000_000_000;

/** Runs the inline script against a fake page: whether it hid the 404's words. */
function runScript(path: string, stored: string | null | "throws", now = NOW): boolean {
  const attrs = new Map<string, string>();
  const sessionStorage = {
    getItem: (key: string) => {
      if (stored === "throws") throw new Error("denied");
      return key === DOOR_MARK_KEY ? stored : null;
    },
  };
  const document = { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } };
  const FakeDate = { now: () => now };
  new Function("location", "sessionStorage", "document", "Date", DOOR_SCRIPT)({ pathname: path }, sessionStorage, document, FakeDate);
  return attrs.get(DOOR_ATTR) === DOOR_WAIT;
}

describe("which addresses the door watches", () => {
  it("watches /staff and below, nothing else", () => {
    for (const path of ["/staff", "/staff/", "/staff/users", "/staff/users/abc"]) expect(isStaffPath(path)).toBe(true);
    for (const path of ["/", "/staffing", "/x/staff", "/api/staff/session", "/nothing-here"]) expect(isStaffPath(path)).toBe(false);
  });
});

describe("the loop guard", () => {
  it("counts a mark for the same address within the window only", () => {
    expect(justLetIn(doorMark("/staff", NOW), "/staff", NOW + 1_000)).toBe(true);
    expect(justLetIn(doorMark("/staff", NOW), "/staff", NOW + DOOR_MARK_MS)).toBe(false);
    expect(justLetIn(doorMark("/staff", NOW), "/staff/users", NOW + 1_000)).toBe(false);
    expect(justLetIn(doorMark("/staff", NOW + 5_000), "/staff", NOW)).toBe(false);
    expect(justLetIn("not json", "/staff", NOW)).toBe(false);
    expect(justLetIn(null, "/staff", NOW)).toBe(false);
  });

  it("starts by asking, guarding, or leaving the page alone", () => {
    expect(doorStart("/nothing-here", null, NOW)).toBe("skip");
    expect(doorStart("/staff", null, NOW)).toBe("ask");
    expect(doorStart("/staff", doorMark("/staff", NOW - 1_000), NOW)).toBe("guard");
    expect(doorStart("/staff", doorMark("/staff", NOW - DOOR_MARK_MS - 1), NOW)).toBe("ask");
  });
});

describe("the inline script before first paint", () => {
  it("hides the 404's words on a staff address, never elsewhere", () => {
    expect(runScript("/staff", null)).toBe(true);
    expect(runScript("/staff/users", null)).toBe(true);
    expect(runScript("/nothing-here", null)).toBe(false);
    expect(runScript("/", null)).toBe(false);
  });

  it("shows the 404 straight away right after the door let this address in", () => {
    expect(runScript("/staff", doorMark("/staff", NOW - 1_000))).toBe(false);
    expect(runScript("/staff", doorMark("/staff", NOW - DOOR_MARK_MS - 1))).toBe(true);
  });

  it("still hides when storage is refused (the door then decides)", () => {
    expect(runScript("/staff", "throws")).toBe(true);
  });

  it("agrees with doorStart everywhere", () => {
    const marks = [null, doorMark("/staff", NOW - 10), doorMark("/staff", NOW - DOOR_MARK_MS), doorMark("/staff/users", NOW - 10), "{"];
    for (const path of ["/staff", "/staff/users", "/x", "/staffing"]) {
      for (const mark of marks) {
        expect(runScript(path, mark), `${path} ${mark}`).toBe(doorStart(path, mark, NOW) === "ask");
      }
    }
  });

  it("carries nothing about who is staff", () => {
    expect(DOOR_SCRIPT).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(DOOR_SCRIPT).not.toMatch(/fetch|privy|cookie/i);
  });
});

function deps(statuses: (number | null)[], tokens: (string | null)[] = []): KnockDeps & { posts: number; sleeps: number[] } {
  const out = {
    posts: 0,
    sleeps: [] as number[],
    getToken: vi.fn(async () => (tokens.length ? tokens.shift()! : "token")),
    post: vi.fn(async () => {
      out.posts += 1;
      return statuses.length ? statuses.shift()! : null;
    }),
    sleep: vi.fn(async (ms: number) => {
      out.sleeps.push(ms);
    }),
  };
  return out;
}

describe("knocking for the staff cookie", () => {
  it("staff: the first yes is enough", async () => {
    const d = deps([200]);
    expect(await knock(d)).toBe(true);
    expect(d.posts).toBe(1);
  });

  it("waits for a token Privy has not handed over yet", async () => {
    const d = deps([200], [null]);
    expect(await knock(d)).toBe(true);
    expect(d.posts).toBe(1);
    expect(d.sleeps).toEqual([800]);
  });

  it("tries again after a failed request or a server error", async () => {
    expect(await knock(deps([null, 200]))).toBe(true);
    expect(await knock(deps([502, 503, 200]))).toBe(true);
  });

  it("tries a 404 once more (Privy's API can blink), then takes it as the answer", async () => {
    expect(await knock(deps([404, 200]))).toBe(true);
    const no = deps([404, 404, 200]);
    expect(await knock(no)).toBe(false);
    expect(no.posts).toBe(2);
  });

  it("gives up after three tries", async () => {
    const d = deps([500, 500, 500, 200]);
    expect(await knock(d)).toBe(false);
    expect(d.posts).toBe(3);
  });
});

function store(initial: string | null = null, keeps = true) {
  let value = initial;
  return { read: () => value, write: (next: string | null) => void (keeps ? (value = next) : undefined) };
}

describe("what the door does once Privy is ready", () => {
  const base = { now: () => NOW, sleep: async () => undefined, getToken: async () => "token" };

  it("signed out: the 404, without asking the server", async () => {
    const post = vi.fn(async () => 200);
    expect(await doorDecide({ ...base, post, authenticated: false, path: "/staff", store: store() })).toBe("open");
    expect(post).not.toHaveBeenCalled();
  });

  it("signed in, not staff: the 404", async () => {
    expect(await doorDecide({ ...base, post: async () => 404, authenticated: true, path: "/staff", store: store() })).toBe("open");
  });

  it("staff: marks the address and loads it again", async () => {
    const s = store();
    expect(await doorDecide({ ...base, post: async () => 200, authenticated: true, path: "/staff/users", store: s })).toBe("reload");
    expect(justLetIn(s.read(), "/staff/users", NOW + 1)).toBe(true);
  });

  it("staff without storage: the 404 rather than a possible loop", async () => {
    expect(await doorDecide({ ...base, post: async () => 200, authenticated: true, path: "/staff", store: store(null, false) })).toBe("open");
  });

  it("never asks from an address outside the staff area", async () => {
    const post = vi.fn(async () => 200);
    expect(await doorDecide({ ...base, post, authenticated: true, path: "/nothing-here", store: store() })).toBe("open");
    expect(post).not.toHaveBeenCalled();
  });
});

describe("the 404 page", () => {
  const source = readFileSync("src/app/not-found.tsx", "utf8");

  it("is static, the same page the edge keeps for every address", () => {
    expect(source).not.toMatch(/connection\(\)|export const dynamic/);
  });

  it("reads nothing about the request: the same bytes at every address", () => {
    expect(source).not.toMatch(/\b(headers|cookies)\(\)/);
    expect(source).not.toMatch(/staffGate|readStaff|staffFromCookie/);
  });

  it("carries the door, its script and both faces", () => {
    expect(source).toContain("<StaffDoor />");
    expect(source).toContain("DOOR_SCRIPT");
    expect(source).toContain('data-door="wait"');
    expect(source).toContain('data-door="page"');
  });
});
