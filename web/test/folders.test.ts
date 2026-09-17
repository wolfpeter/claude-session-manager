import { describe, expect, test } from "vitest";
import { folderOptions, pickRemembered } from "../src/folders";

describe("folderOptions", () => {
  test("labels a folder with its own name", () => {
    expect(folderOptions(["/home/me/projects/shop", "/home/me/projects/i-dest"])).toEqual([
      { path: "/home/me/projects/shop", label: "shop" },
      { path: "/home/me/projects/i-dest", label: "i-dest" },
    ]);
  });

  test("falls back to the full path when two roots hold the same name", () => {
    expect(folderOptions(["/a/shop", "/b/shop", "/a/blog"])).toEqual([
      { path: "/a/shop", label: "/a/shop" },
      { path: "/b/shop", label: "/b/shop" },
      { path: "/a/blog", label: "blog" },
    ]);
  });

  test("survives a trailing slash and an empty list", () => {
    expect(folderOptions(["/a/shop/"])).toEqual([{ path: "/a/shop/", label: "shop" }]);
    expect(folderOptions([])).toEqual([]);
  });
});

describe("pickRemembered", () => {
  test("keeps the remembered value when it is still offered", () => {
    expect(pickRemembered("b", ["a", "b"])).toBe("b");
  });

  test("falls back to the first value when the remembered one is gone or missing", () => {
    expect(pickRemembered("gone", ["a", "b"])).toBe("a");
    expect(pickRemembered(null, ["a", "b"])).toBe("a");
    expect(pickRemembered(null, [])).toBe("");
  });
});
