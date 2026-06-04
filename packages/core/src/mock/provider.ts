// ── mulberry32 PRNG ────────────────────────────────────────────────
// 단순하고 빠른 결정론적 32비트 PRNG. seed 기반 재현 가능.

function createPrng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 힌트 매칭 ─────────────────────────────────────────────────────

type HintCategory =
  | "name"
  | "title"
  | "email"
  | "price"
  | "description"
  | "date"
  | "default";

function categorizeHint(hint: string): HintCategory {
  const h = hint.toLowerCase();
  if (h.includes("email")) return "email";
  if (h.includes("price") || h.includes("amount") || h.includes("cost") || h.includes("fee")) return "price";
  if (h.includes("date") || h.includes("time") || h.includes("at")) return "date";
  if (h.includes("description") || h.includes("subtitle") || h.includes("content") || h.includes("body") || h.includes("summary")) return "description";
  if (h.includes("name")) return "name";
  if (h.includes("title") || h.includes("header") || h.includes("heading") || h.includes("label")) return "title";
  return "default";
}

// ── 데이터 풀 ─────────────────────────────────────────────────────

const FIRST_NAMES = [
  "Alice", "Bob", "Carol", "David", "Emma", "Frank", "Grace", "Henry",
  "Iris", "James", "Karen", "Leo", "Maria", "Nick", "Olivia", "Paul",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
  "Davis", "Wilson", "Taylor", "Anderson", "Thomas", "Jackson", "White",
];

const TITLES = [
  "Dashboard", "Overview", "Settings", "Profile", "Home", "Details",
  "Activity", "Reports", "Summary", "Notifications", "Explore", "Feed",
  "My Account", "Recent Items", "Top Picks",
];

const EMAIL_DOMAINS = [
  "example.com", "test.org", "mock.dev", "placeholder.io", "sample.net",
];

const EMAIL_USERS = [
  "alice", "bob", "carol", "david", "emma", "frank", "user", "contact",
  "info", "hello", "support", "test",
];

const LOREM_WORDS = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing",
  "elit", "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore",
  "et", "dolore", "magna", "aliqua", "enim", "ad", "minim", "veniam",
  "quis", "nostrud", "exercitation", "ullamco", "laboris", "nisi",
  "aliquip", "ex", "ea", "commodo", "consequat", "duis", "aute", "irure",
];

const SENTENCE_WORDS = [
  "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "cat", "sat",
  "mat", "bright", "sunny", "warm", "cool", "fresh", "clean", "clear",
  "simple", "easy", "fast", "slow", "big", "small", "long", "short",
];

const PRICE_TEMPLATES = ["$", "€", "£", "¥"];
const MONTHS = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
const DAYS = Array.from({ length: 28 }, (_, i) => String(i + 1).padStart(2, "0"));

// ── MockProvider 인터페이스 ────────────────────────────────────────

export interface MockProvider {
  text(hint?: string): string;
  integer(hint?: string, min?: number, max?: number): number;
  boolean(hint?: string): boolean;
  listCount(): number;
  imageUrl(): string;
  color(): string;
}

// ── 내부 유틸 ─────────────────────────────────────────────────────

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

function pickN<T>(rng: () => number, arr: readonly T[], n: number): T[] {
  const out: T[] = [];
  const copy = arr.slice();
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy[idx]!);
    copy.splice(idx, 1);
  }
  return out;
}

// ── 팩토리 ────────────────────────────────────────────────────────

/**
 * seed 기반 결정론적 MockProvider를 생성한다.
 * 같은 seed + 같은 호출 순서 → 같은 출력이 보장된다.
 * seed 기본값은 42.
 */
export function createMockProvider(seed = 42): MockProvider {
  const rng = createPrng(seed);

  return {
    text(hint?: string): string {
      const category = hint ? categorizeHint(hint) : "default";

      switch (category) {
        case "name": {
          const first = pick(rng, FIRST_NAMES);
          const last = pick(rng, LAST_NAMES);
          return `${first} ${last}`;
        }
        case "title": {
          return pick(rng, TITLES);
        }
        case "email": {
          const user = pick(rng, EMAIL_USERS);
          const domain = pick(rng, EMAIL_DOMAINS);
          return `${user}@${domain}`;
        }
        case "price": {
          const symbol = pick(rng, PRICE_TEMPLATES);
          const amount = Math.floor(rng() * 9990 + 10); // 10~9999
          const cents = Math.floor(rng() * 100);
          return `${symbol}${amount}.${String(cents).padStart(2, "0")}`;
        }
        case "description": {
          const wordCount = Math.floor(rng() * 5) + 5; // 5~9단어
          return pickN(rng, SENTENCE_WORDS, wordCount).join(" ");
        }
        case "date": {
          const year = 2020 + Math.floor(rng() * 6); // 2020~2025
          const month = pick(rng, MONTHS);
          const day = pick(rng, DAYS);
          return `${year}-${month}-${day}`;
        }
        default: {
          const wordCount = Math.floor(rng() * 3) + 2; // 2~4단어
          return pickN(rng, LOREM_WORDS, wordCount).join(" ");
        }
      }
    },

    integer(_hint?: string, min = 0, max = 100): number {
      if (min === max) return min;
      return min + Math.floor(rng() * (max - min + 1));
    },

    boolean(_hint?: string): boolean {
      return rng() >= 0.5;
    },

    listCount(): number {
      return 3;
    },

    imageUrl(): string {
      // placeholder 식별자 반환 — 렌더러가 실제 이미지로 대체
      const id = Math.floor(rng() * 1000) + 1;
      return `mock-image-placeholder://${id}`;
    },

    color(): string {
      const r = Math.floor(rng() * 256);
      const g = Math.floor(rng() * 256);
      const b = Math.floor(rng() * 256);
      return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
    },
  };
}
