import { describe, expect, it } from "vitest";
import { buildPattern, hintText, normalize, splitMatches } from "./highlight";

const split = (words: string[], text: string) => splitMatches(text, buildPattern(words)!);

describe("highlight matching", () => {
  it("matches whole words in any case", () => {
    expect(split(["run"], "Run, then run again. Rerun runs.")).toEqual([
      { match: "Run" },
      ", then ",
      { match: "run" },
      " again. Rerun runs.",
    ]);
  });

  it("matches phrases across extra whitespace and prefers the longest", () => {
    expect(split(["look", "look up"], "Please look\n  up the word, then look.")).toEqual([
      "Please ",
      { match: "look\n  up" },
      " the word, then ",
      { match: "look" },
      ".",
    ]);
  });

  it("treats regex characters literally and respects non-ASCII letters", () => {
    expect(split(["c++"], "I like c++ and cxx.")).toEqual(["I like ", { match: "c++" }, " and cxx."]);
    expect(split(["café"], "Un café. Cafés.")).toEqual(["Un ", { match: "café" }, ". Cafés."]);
  });

  it("returns null without matches, and no pattern for an empty list", () => {
    expect(split(["zebra"], "no animals here")).toBeNull();
    expect(buildPattern([])).toBeNull();
  });

  it("normalizes a match to its lookup key and builds hints", () => {
    expect(normalize("Look\n  Up")).toBe("look up");
    expect(hintText({ text: "a", definition: "first", note: "mine" })).toBe("first\nNote: mine");
    expect(hintText({ text: "a", definition: null, note: "" })).toBe("In your wordbook");
  });
});
