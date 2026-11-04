import { describe, expect, it } from "vitest";
import { cutSentence } from "./sentence";

const at = (text: string, word: string) => {
  const start = text.indexOf(word);
  return cutSentence(text, start, start + word.length);
};

describe("cutSentence", () => {
  it("returns the middle sentence", () => {
    expect(at("First one. The cat sat on the mat! Last one?", "sat")).toBe("The cat sat on the mat!");
  });

  it("works for the first and last sentence", () => {
    expect(at("Hello world. Bye now", "Hello")).toBe("Hello world.");
    expect(at("Hello world. Bye now", "now")).toBe("Bye now");
  });

  it("collapses whitespace and newlines", () => {
    expect(at("A.  The\n  quick   fox. B.", "quick")).toBe("The quick fox.");
  });

  it("caps the length", () => {
    expect(cutSentence("x".repeat(2000), 0, 1).length).toBe(1000);
  });
});
