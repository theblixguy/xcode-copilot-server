import { describe, it, expect } from "vitest";
import { filterExcludedFiles } from "../../src/providers/shared/prompt-utils.js";

describe("filterExcludedFiles", () => {
  const fence = "```";
  const mockPatterns = ["mock"];

  it("no mock files - real file untouched", () => {
    const input = `${fence}swift:RealFile.swift\nfunc hello() {}\n${fence}\n`;
    expect(filterExcludedFiles(input, mockPatterns)).toBe(input);
  });

  it("single mock file removed", () => {
    const input = `Results:\n${fence}swift:Mock.SwiftyMocky\nclass Mock {}\n${fence}\nDone`;
    expect(filterExcludedFiles(input, mockPatterns)).toBe("Results:\nDone");
  });

  it("mock file removed, real files kept", () => {
    const input =
      `${fence}swift:Real.swift\nlet x = 1\n${fence}\n` +
      `${fence}swift:MockHelper.swift\nclass MockHelper {}\n${fence}\n` +
      `${fence}swift:Other.swift\nlet y = 2\n${fence}\n`;
    const want =
      `${fence}swift:Real.swift\nlet x = 1\n${fence}\n` +
      `${fence}swift:Other.swift\nlet y = 2\n${fence}\n`;
    expect(filterExcludedFiles(input, mockPatterns)).toBe(want);
  });

  it("case insensitive - lowercase mock", () => {
    const input = `${fence}swift:mock_helpers.swift\nstuff\n${fence}\n`;
    expect(filterExcludedFiles(input, mockPatterns)).toBe("");
  });

  it("no code blocks at all", () => {
    expect(filterExcludedFiles("just plain text", mockPatterns)).toBe("just plain text");
  });

  it("empty string", () => {
    expect(filterExcludedFiles("", mockPatterns)).toBe("");
  });

  it("empty patterns - nothing filtered", () => {
    const input = `${fence}swift:MockFile.swift\nstuff\n${fence}\n`;
    expect(filterExcludedFiles(input, [])).toBe(input);
  });

  it("multiple patterns", () => {
    const input =
      `${fence}swift:Real.swift\nlet x = 1\n${fence}\n` +
      `${fence}swift:MockHelper.swift\nclass MockHelper {}\n${fence}\n` +
      `${fence}swift:TestFixture.swift\nclass Fixture {}\n${fence}\n`;
    const want = `${fence}swift:Real.swift\nlet x = 1\n${fence}\n`;
    expect(filterExcludedFiles(input, ["mock", "fixture"])).toBe(want);
  });
});
