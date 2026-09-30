export type FileTreeNode =
  | {
      type: "dir";
      /** Path relative to the parent, with single-child chains joined. */
      name: string;
      /** Short label when `name` is a long compacted chain. */
      displayName: string;
      path: string;
      children: FileTreeNode[];
      fileCount: number;
    }
  | { type: "file"; name: string; path: string; modifiedAt?: string };

export interface FileTree {
  /** Directory the tree starts at, after collapsing empty single-child prefixes. */
  rootPrefix: string;
  nodes: FileTreeNode[];
}

interface RawFile {
  key: string;
  modifiedAt?: string;
}

interface RawDir {
  files: Map<string, RawFile>;
  dirs: Map<string, RawDir>;
  absolute: boolean;
}

const COMPACT_SEGMENT_LIMIT = 3;
const COMPACT_LENGTH_LIMIT = 40;

function createDir(): RawDir {
  return { files: new Map(), dirs: new Map(), absolute: false };
}

function markAbsolute(dir: RawDir) {
  dir.absolute = true;
}

/** "/sandbox/ba_agent/.../MMRU-295234" -> ".../MMRU-295234/" */
export function collapsedLabel(path: string): string {
  const segments = path.split("/").filter(Boolean);
  const last = segments[segments.length - 1] ?? path;
  return `.../${last}/`;
}

export function folderDisplayName(joined: string): string {
  const segments = joined.split("/").filter(Boolean);
  if (
    segments.length > COMPACT_SEGMENT_LIMIT ||
    joined.length > COMPACT_LENGTH_LIMIT
  ) {
    return `.../${segments[segments.length - 1] ?? joined}`;
  }
  return joined;
}

export function getFileContent(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "content" in raw) {
    const content = (raw as { content: unknown }).content;
    if (Array.isArray(content)) {
      return content.join("\n");
    }
    return String(content ?? "");
  }
  return String(raw ?? "");
}

export function getModifiedAt(raw: unknown): string | undefined {
  if (typeof raw === "object" && raw !== null && "modified_at" in raw) {
    const value = (raw as { modified_at?: unknown }).modified_at;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function formatPath(segments: string[], absolute: boolean): string {
  const joined = segments.join("/");
  return absolute ? `/${joined}` : joined;
}

function insert(root: RawDir, key: string, modifiedAt?: string) {
  const absolute = key.startsWith("/");
  const segments = key.split("/").filter(Boolean);
  if (segments.length === 0) return;

  let node = root;
  if (absolute) markAbsolute(node);
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    let child = node.dirs.get(segment);
    if (!child) {
      child = createDir();
      node.dirs.set(segment, child);
    }
    if (absolute) markAbsolute(child);
    node = child;
  }
  node.files.set(segments[segments.length - 1], { key, modifiedAt });
}

/** Descend while the dir has no files and exactly one subdirectory. */
function collapseChain(
  dir: RawDir,
  segments: string[]
): { dir: RawDir; segments: string[] } {
  const next = [...segments];
  let current = dir;
  while (current.files.size === 0 && current.dirs.size === 1) {
    const entry = current.dirs.entries().next().value as
      | [string, RawDir]
      | undefined;
    if (!entry) break;
    const [name, child] = entry;
    next.push(name);
    current = child;
  }
  return { dir: current, segments: next };
}

function countRawFiles(dir: RawDir): number {
  let count = dir.files.size;
  for (const child of dir.dirs.values()) {
    count += countRawFiles(child);
  }
  return count;
}

function compareName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function toNodes(dir: RawDir, parentSegments: string[]): FileTreeNode[] {
  const dirs: FileTreeNode[] = [];
  for (const [name, child] of dir.dirs) {
    const collapsed = collapseChain(child, [...parentSegments, name]);
    const joined = collapsed.segments.slice(parentSegments.length).join("/");
    dirs.push({
      type: "dir",
      name: joined,
      displayName: folderDisplayName(joined),
      path: formatPath(collapsed.segments, collapsed.dir.absolute),
      children: toNodes(collapsed.dir, collapsed.segments),
      fileCount: countRawFiles(collapsed.dir),
    });
  }

  const files: FileTreeNode[] = [];
  for (const [name, meta] of dir.files) {
    files.push({
      type: "file",
      name,
      path: meta.key,
      modifiedAt: meta.modifiedAt,
    });
  }

  dirs.sort((a, b) => compareName(a.name, b.name));
  files.sort((a, b) => compareName(a.name, b.name));
  return [...dirs, ...files];
}

export function buildFileTree(files: Record<string, unknown>): FileTree {
  const root = createDir();
  for (const [key, raw] of Object.entries(files)) {
    insert(root, key, getModifiedAt(raw));
  }

  const collapsed = collapseChain(root, []);
  const rootPrefix =
    collapsed.segments.length > 0
      ? formatPath(collapsed.segments, collapsed.dir.absolute)
      : "";

  return {
    rootPrefix,
    nodes: toNodes(collapsed.dir, collapsed.segments),
  };
}

export function countTreeFiles(nodes: FileTreeNode[]): number {
  return nodes.reduce(
    (count, node) =>
      count + (node.type === "file" ? 1 : countTreeFiles(node.children)),
    0
  );
}

/** Dirs to open initially: everything when small, else the newest file's path. */
export function initialExpandedPaths(nodes: FileTreeNode[]): string[] {
  const count = countTreeFiles(nodes);
  const paths: string[] = [];

  if (count <= 15) {
    const walk = (list: FileTreeNode[]) => {
      for (const node of list) {
        if (node.type !== "dir") continue;
        paths.push(node.path);
        walk(node.children);
      }
    };
    walk(nodes);
    return paths;
  }

  const newest: { time: number; ancestors: string[] | null } = {
    time: Number.NEGATIVE_INFINITY,
    ancestors: null,
  };
  const walkNewest = (list: FileTreeNode[], ancestors: string[]) => {
    for (const node of list) {
      if (node.type === "dir") {
        walkNewest(node.children, [...ancestors, node.path]);
        continue;
      }
      if (!node.modifiedAt) continue;
      const time = Date.parse(node.modifiedAt);
      if (Number.isNaN(time)) continue;
      if (time > newest.time) {
        newest.time = time;
        newest.ancestors = ancestors;
      }
    }
  };
  walkNewest(nodes, []);
  if (newest.ancestors) return newest.ancestors;

  for (const node of nodes) {
    if (node.type === "dir") paths.push(node.path);
  }
  return paths;
}

export function filterFileTree(
  nodes: FileTreeNode[],
  query: string
): FileTreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return nodes;

  const out: FileTreeNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") {
      if (
        node.path.toLowerCase().includes(needle) ||
        node.name.toLowerCase().includes(needle)
      ) {
        out.push(node);
      }
      continue;
    }
    const selfMatch =
      node.path.toLowerCase().includes(needle) ||
      node.name.toLowerCase().includes(needle);
    const children = filterFileTree(node.children, needle);
    if (selfMatch || children.length > 0) {
      out.push({
        ...node,
        children: selfMatch ? node.children : children,
      });
    }
  }
  return out;
}

export function collectDirPaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (list: FileTreeNode[]) => {
    for (const node of list) {
      if (node.type !== "dir") continue;
      paths.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return paths;
}
