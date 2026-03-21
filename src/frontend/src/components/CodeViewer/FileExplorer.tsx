import { useState, useMemo, useRef, forwardRef, useImperativeHandle } from 'react';
import { type FileTreeNode } from '@/stores/codeViewerStore';
import { getFileIconUrl } from './fileIcons';
import styles from './FileExplorer.module.css';

export interface FileExplorerHandle {
  focusSearch: () => void;
}

interface FileExplorerProps {
  tree: FileTreeNode[] | null;
  expandedDirs: Set<string>;
  activeFilePath: string | null;
  onFileSelect: (path: string) => void;
  onToggleDir: (path: string) => void;
  loading?: boolean;
}

function TreeNode({
  node,
  depth,
  expandedDirs,
  activeFilePath,
  onFileSelect,
  onToggleDir,
}: {
  node: FileTreeNode;
  depth: number;
  expandedDirs: Set<string>;
  activeFilePath: string | null;
  onFileSelect: (path: string) => void;
  onToggleDir: (path: string) => void;
}) {
  const isDir = node.type === 'directory';
  const isExpanded = expandedDirs.has(node.path);
  const isActive = node.path === activeFilePath;
  const iconUrl = getFileIconUrl(node.name, isDir, isExpanded);

  return (
    <>
      <button
        className={`${styles.node} ${isActive ? styles.active : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => (isDir ? onToggleDir(node.path) : onFileSelect(node.path))}
        title={node.path}
      >
        {isDir && (
          <span className={styles.chevron}>{isExpanded ? '▾' : '▸'}</span>
        )}
        <img className={styles.fileIcon} src={iconUrl} alt="" draggable={false} />
        <span className={styles.name}>{node.name}</span>
      </button>
      {isDir &&
        isExpanded &&
        node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            onToggleDir={onToggleDir}
          />
        ))}
    </>
  );
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className={styles.highlight}>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function SearchResults({
  files,
  query,
  activeFilePath,
  onFileSelect,
}: {
  files: FileTreeNode[];
  query: string;
  activeFilePath: string | null;
  onFileSelect: (path: string) => void;
}) {
  if (files.length === 0) {
    return <div className={styles.empty}>No matching files</div>;
  }

  return (
    <>
      {files.map((f) => {
        const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
        const iconUrl = getFileIconUrl(f.name, false, false);
        const isActive = f.path === activeFilePath;
        return (
          <button
            key={f.path}
            className={`${styles.searchResult} ${isActive ? styles.active : ''}`}
            onClick={() => onFileSelect(f.path)}
            title={f.path}
          >
            <img className={styles.fileIcon} src={iconUrl} alt="" draggable={false} />
            <span className={styles.name}>
              <HighlightMatch text={f.name} query={query} />
            </span>
            {dir && <span className={styles.searchResultPath}>{dir}</span>}
          </button>
        );
      })}
    </>
  );
}

const FileExplorer = forwardRef<FileExplorerHandle, FileExplorerProps>(function FileExplorer(
  { tree, expandedDirs, activeFilePath, onFileSelect, onToggleDir, loading },
  ref,
) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focusSearch() {
      inputRef.current?.focus();
    },
  }));

  const allFiles = useMemo(() => {
    if (!tree) return [];
    const files: FileTreeNode[] = [];
    function collect(nodes: FileTreeNode[]) {
      for (const n of nodes) {
        if (n.type === 'file') files.push(n);
        if (n.children) collect(n.children);
      }
    }
    collect(tree);
    return files;
  }, [tree]);

  const filtered = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return allFiles.filter(
      (f) => f.path.toLowerCase().includes(q) || f.name.toLowerCase().includes(q),
    );
  }, [search, allFiles]);

  if (loading || !tree) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading files...</div>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>No files found</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.searchBox}>
        <input
          ref={inputRef}
          className={styles.searchInput}
          type="text"
          placeholder="Search files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            className={styles.searchClear}
            onClick={() => setSearch('')}
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
      {filtered ? (
        <SearchResults
          files={filtered}
          query={search}
          activeFilePath={activeFilePath}
          onFileSelect={onFileSelect}
        />
      ) : (
        tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            expandedDirs={expandedDirs}
            activeFilePath={activeFilePath}
            onFileSelect={onFileSelect}
            onToggleDir={onToggleDir}
          />
        ))
      )}
    </div>
  );
});

export default FileExplorer;
