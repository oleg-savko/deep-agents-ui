import { describe, expect, it } from "vitest";
import {
  buildFileTree,
  collectDirPaths,
  collapsedLabel,
  countTreeFiles,
  filterFileTree,
  folderDisplayName,
  getFileContent,
  getModifiedAt,
  initialExpandedPaths,
  type FileTreeNode,
} from "@/app/utils/fileTree";

describe("labels and raw file fields", () => {
  it("compacts long paths and reads content/modified_at", () => {
    expect(collapsedLabel("/sandbox/ba_agent/MMRU-1")).toBe(".../MMRU-1/");
    expect(folderDisplayName("a/b/c")).toBe("a/b/c");
    expect(folderDisplayName("a/b/c/d")).toBe(".../d");
    expect(folderDisplayName("x".repeat(41))).toBe(`.../${"x".repeat(41)}`);
    expect(getFileContent({ content: ["a", "b"] })).toBe("a\nb");
    expect(getFileContent({ content: "plain" })).toBe("plain");
    expect(getFileContent({ content: null })).toBe("");
    expect(getFileContent("raw")).toBe("raw");
    expect(getFileContent(null)).toBe("");
    expect(getModifiedAt({ modified_at: "2026-01-01T00:00:00Z" })).toBe(
      "2026-01-01T00:00:00Z"
    );
    expect(getModifiedAt({ modified_at: 1 })).toBeUndefined();
    expect(getModifiedAt("x")).toBeUndefined();
  });
});

describe("buildFileTree", () => {
  it("collapses a single-child prefix and sorts names numerically", () => {
    const tree = buildFileTree({
      "/sandbox/a/b/file10.txt": { content: "a", modified_at: "t" },
      "/sandbox/a/b/file2.txt": "b",
    });
    expect(tree.rootPrefix).toBe("/sandbox/a/b");
    expect(tree.nodes.map((n) => n.name)).toEqual(["file2.txt", "file10.txt"]);
    expect(countTreeFiles(tree.nodes)).toBe(2);
  });

  it("keeps sibling directories and empty input", () => {
    const tree = buildFileTree({
      "b/2.txt": "",
      "a/1.txt": "",
    });
    expect(tree.rootPrefix).toBe("");
    expect(tree.nodes.map((n) => n.name)).toEqual(["a", "b"]);
    expect(buildFileTree({}).nodes).toEqual([]);
  });
});

describe("initialExpandedPaths", () => {
  function dir(path: string, children: FileTreeNode[]): FileTreeNode {
    return {
      type: "dir",
      name: path,
      displayName: path,
      path,
      children,
      fileCount: children.length,
    };
  }
  function file(path: string, modifiedAt?: string): FileTreeNode {
    return { type: "file", name: path, path, modifiedAt };
  }

  it("expands every directory when the tree is small", () => {
    const nodes = [
      dir("a", [dir("a/b", [file("a/b/1.txt")])]),
      file("root.txt"),
    ];
    expect(initialExpandedPaths(nodes)).toEqual(["a", "a/b"]);
  });

  it("opens only the newest file's ancestors when the tree is large", () => {
    const files = Array.from({ length: 16 }, (_, i) =>
      file(
        `old/${i}.txt`,
        `2020-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`
      )
    );
    const nodes = [
      dir("old", files),
      dir("new", [file("new/latest.txt", "2026-06-01T00:00:00Z")]),
    ];
    expect(initialExpandedPaths(nodes)).toEqual(["new"]);
  });

  it("falls back to top-level dirs when dates are missing or invalid", () => {
    const files = Array.from({ length: 16 }, (_, i) => file(`f/${i}.txt`));
    const nodes = [
      dir("f", [...files, file("f/bad.txt", "not-a-date")]),
      dir("g", []),
      file("loose.txt"),
    ];
    expect(initialExpandedPaths(nodes)).toEqual(["f", "g"]);
  });
});

describe("filterFileTree / collectDirPaths", () => {
  const nodes: FileTreeNode[] = [
    {
      type: "dir",
      name: "reports",
      displayName: "reports",
      path: "reports",
      fileCount: 2,
      children: [
        { type: "file", name: "q1.txt", path: "reports/q1.txt" },
        { type: "file", name: "notes.txt", path: "reports/notes.txt" },
      ],
    },
    { type: "file", name: "readme.md", path: "readme.md" },
  ];

  it("returns the tree for a blank query and filters files and dirs", () => {
    expect(filterFileTree(nodes, "  ")).toBe(nodes);
    expect(filterFileTree(nodes, "readme").map((n) => n.name)).toEqual([
      "readme.md",
    ]);
    const byChild = filterFileTree(nodes, "q1");
    expect(byChild).toHaveLength(1);
    expect(byChild[0].type === "dir" && byChild[0].children).toHaveLength(1);
    const byDir = filterFileTree(nodes, "reports");
    expect(byDir[0].type === "dir" && byDir[0].children).toHaveLength(2);
    expect(collectDirPaths(nodes)).toEqual(["reports"]);
  });
});
