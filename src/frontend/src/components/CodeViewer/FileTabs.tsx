import styles from './FileTabs.module.css';

interface FileTabsProps {
  files: Map<string, { path: string }>;
  activeFilePath: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

function getDisplayName(path: string, allPaths: string[]): string {
  const name = path.split('/').pop() || path;
  const sameNamePaths = allPaths.filter((p) => p.split('/').pop() === name);
  if (sameNamePaths.length > 1) {
    const parts = path.split('/');
    return parts.length > 1 ? `${parts[parts.length - 2]}/${name}` : name;
  }
  return name;
}

export default function FileTabs({ files, activeFilePath, onSelect, onClose }: FileTabsProps) {
  const paths = Array.from(files.keys());

  if (paths.length === 0) return null;

  return (
    <div className={styles.tabBar}>
      {paths.map((path) => (
        <button
          key={path}
          className={`${styles.tab} ${path === activeFilePath ? styles.active : ''}`}
          onClick={() => onSelect(path)}
          title={path}
        >
          <span className={styles.tabName}>{getDisplayName(path, paths)}</span>
          <span
            className={styles.closeBtn}
            onClick={(e) => {
              e.stopPropagation();
              onClose(path);
            }}
            aria-label={`Close ${path}`}
          >
            ✕
          </span>
        </button>
      ))}
    </div>
  );
}
