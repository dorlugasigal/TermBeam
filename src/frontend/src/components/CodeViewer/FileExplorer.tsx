import { type FileTreeNode } from '@/stores/codeViewerStore';
import { getFileIconUrl } from './fileIcons';
import styles from './FileExplorer.module.css';

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

export default function FileExplorer({
  tree,
  expandedDirs,
  activeFilePath,
  onFileSelect,
  onToggleDir,
  loading,
}: FileExplorerProps) {
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
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          expandedDirs={expandedDirs}
          activeFilePath={activeFilePath}
          onFileSelect={onFileSelect}
          onToggleDir={onToggleDir}
        />
      ))}
    </div>
  );
}
