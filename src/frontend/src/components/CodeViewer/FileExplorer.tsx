import { type FileTreeNode } from '@/stores/codeViewerStore';
import styles from './FileExplorer.module.css';

// File icon colors inspired by VS Code's Seti theme
const IC = {
  js: '#e6c84c',
  ts: '#3178c6',
  json: '#c3a945',
  html: '#e44d26',
  css: '#1572b6',
  md: '#519aba',
  py: '#3776ab',
  rb: '#cc342d',
  go: '#00add8',
  rs: '#dea584',
  java: '#e76f00',
  sh: '#4eaa25',
  yml: '#cb171e',
  docker: '#2496ed',
  git: '#f05033',
  lock: '#888',
  img: '#a074c4',
  config: '#6d8086',
  env: '#ecd53f',
  txt: '#9da5b4',
  default: '#9da5b4',
  dir: '#c09553',
  dirOpen: '#c09553',
} as const;

function getFileIcon(name: string, isDir: boolean, isExpanded: boolean): { icon: string; color: string } {
  if (isDir) {
    return { icon: isExpanded ? '📂' : '📁', color: IC.dir };
  }

  const lower = name.toLowerCase();
  const ext = lower.split('.').pop() || '';

  // Special filenames
  if (lower === 'dockerfile' || lower.startsWith('dockerfile.')) return { icon: '🐳', color: IC.docker };
  if (lower === '.gitignore' || lower === '.gitattributes') return { icon: '', color: IC.git };
  if (lower === '.env' || lower.startsWith('.env.')) return { icon: '🔑', color: IC.env };
  if (lower === 'license' || lower === 'licence') return { icon: '📜', color: IC.txt };
  if (lower === 'readme.md' || lower === 'readme') return { icon: '📖', color: IC.md };
  if (lower === 'makefile' || lower === 'gnumakefile') return { icon: '⚙️', color: IC.config };
  if (lower.endsWith('.lock') || lower === 'package-lock.json' || lower === 'yarn.lock') return { icon: '🔒', color: IC.lock };
  if (lower === '.prettierrc' || lower === '.prettierignore') return { icon: '💅', color: IC.config };
  if (lower === '.eslintrc.json' || lower === '.eslintrc.js' || lower.startsWith('eslint.config')) return { icon: '📏', color: IC.config };
  if (lower === 'tsconfig.json' || lower.startsWith('tsconfig.')) return { icon: '⚙️', color: IC.ts };

  // By extension
  const iconMap: Record<string, { icon: string; color: string }> = {
    js: { icon: 'JS', color: IC.js },
    mjs: { icon: 'JS', color: IC.js },
    cjs: { icon: 'JS', color: IC.js },
    jsx: { icon: 'JSX', color: IC.js },
    ts: { icon: 'TS', color: IC.ts },
    mts: { icon: 'TS', color: IC.ts },
    tsx: { icon: 'TSX', color: IC.ts },
    json: { icon: '{ }', color: IC.json },
    jsonc: { icon: '{ }', color: IC.json },
    html: { icon: '<>', color: IC.html },
    htm: { icon: '<>', color: IC.html },
    css: { icon: '#', color: IC.css },
    scss: { icon: '#', color: '#cd6799' },
    less: { icon: '#', color: '#1d365d' },
    md: { icon: 'M↓', color: IC.md },
    mdx: { icon: 'M↓', color: IC.md },
    py: { icon: '🐍', color: IC.py },
    rb: { icon: '💎', color: IC.rb },
    go: { icon: 'Go', color: IC.go },
    rs: { icon: '🦀', color: IC.rs },
    java: { icon: '☕', color: IC.java },
    cs: { icon: 'C#', color: '#68217a' },
    cpp: { icon: 'C+', color: '#00599c' },
    c: { icon: 'C', color: '#00599c' },
    h: { icon: 'H', color: '#00599c' },
    sh: { icon: '$', color: IC.sh },
    bash: { icon: '$', color: IC.sh },
    zsh: { icon: '$', color: IC.sh },
    yml: { icon: '⚙️', color: IC.yml },
    yaml: { icon: '⚙️', color: IC.yml },
    toml: { icon: '⚙️', color: IC.config },
    ini: { icon: '⚙️', color: IC.config },
    xml: { icon: '<>', color: '#e44d26' },
    svg: { icon: '◇', color: '#ffb13b' },
    sql: { icon: '🗄', color: '#e38c00' },
    graphql: { icon: '◈', color: '#e535ab' },
    gql: { icon: '◈', color: '#e535ab' },
    png: { icon: '🖼', color: IC.img },
    jpg: { icon: '🖼', color: IC.img },
    jpeg: { icon: '🖼', color: IC.img },
    gif: { icon: '🖼', color: IC.img },
    webp: { icon: '🖼', color: IC.img },
    ico: { icon: '🖼', color: IC.img },
    woff: { icon: 'Aa', color: IC.txt },
    woff2: { icon: 'Aa', color: IC.txt },
    ttf: { icon: 'Aa', color: IC.txt },
    txt: { icon: '📄', color: IC.txt },
    log: { icon: '📋', color: IC.txt },
    diff: { icon: '±', color: '#f05033' },
    patch: { icon: '±', color: '#f05033' },
  };

  return iconMap[ext] || { icon: '📄', color: IC.default };
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
  const { icon, color } = getFileIcon(node.name, isDir, isExpanded);

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
        <span className={styles.fileIcon} style={{ color }}>{icon}</span>
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
