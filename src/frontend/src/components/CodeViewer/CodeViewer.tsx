import { useEffect, useState, useCallback } from 'react';
import { useCodeViewerStore } from '@/stores/codeViewerStore';
import { fetchFileTree, fetchFileContent } from '@/services/api';
import { detectLanguage } from './CodePanel';
import FileExplorer from './FileExplorer';
import FileTabs from './FileTabs';
import CodePanel from './CodePanel';
import styles from './CodeViewer.module.css';

interface CodeViewerProps {
  sessionId: string;
}

export default function CodeViewer({ sessionId }: CodeViewerProps) {
  const {
    fileTree,
    setFileTree,
    openFiles,
    activeFilePath,
    expandedDirs,
    sidebarOpen,
    openFile,
    closeFile,
    setActiveFile,
    toggleDir,
    toggleSidebar,
    setSidebarOpen,
    updateScrollTop,
  } = useCodeViewerStore();

  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // Load file tree on mount
  useEffect(() => {
    let cancelled = false;
    setTreeLoading(true);
    setTreeError(null);

    fetchFileTree(sessionId)
      .then(({ tree }) => {
        if (!cancelled) {
          setFileTree(tree);
          setTreeLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setTreeError(err instanceof Error ? err.message : 'Failed to load file tree');
          setTreeLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, setFileTree]);

  const handleFileSelect = useCallback(
    async (filePath: string) => {
      if (openFiles.has(filePath)) {
        setActiveFile(filePath);
        setSidebarOpen(false);
        return;
      }

      setFileLoading(true);
      setFileError(null);

      try {
        const { content, name, size } = await fetchFileContent(sessionId, filePath);
        const language = detectLanguage(name);
        openFile({ path: filePath, content, language, size, scrollTop: 0 });
        setSidebarOpen(false);
      } catch (err) {
        setFileError(err instanceof Error ? err.message : 'Failed to load file');
      } finally {
        setFileLoading(false);
      }
    },
    [sessionId, openFiles, setActiveFile, setSidebarOpen, openFile],
  );

  const handleScroll = useCallback(
    (scrollTop: number) => {
      if (activeFilePath) {
        updateScrollTop(activeFilePath, scrollTop);
      }
    },
    [activeFilePath, updateScrollTop],
  );

  const activeFile = activeFilePath ? openFiles.get(activeFilePath) : undefined;

  return (
    <div className={styles.page}>
      {/* Custom top bar: hamburger | tabs | close */}
      <header className={styles.topBar}>
        <button
          className={styles.menuBtn}
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'Close explorer' : 'Open explorer'}
        >
          ☰
        </button>

        <div className={styles.tabsWrapper}>
          <FileTabs
            files={openFiles}
            activeFilePath={activeFilePath}
            onSelect={setActiveFile}
            onClose={closeFile}
          />
        </div>

        <a href="/terminal" className={styles.backLink} title="Back to terminal">
          ✕
        </a>
      </header>

      <div className={styles.body}>
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className={styles.overlay}
            onClick={() => setSidebarOpen(false)}
            role="presentation"
          />
        )}

        {/* Sidebar */}
        <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}>
          <div className={styles.sidebarHeader}>Explorer</div>
          <FileExplorer
            tree={fileTree}
            expandedDirs={expandedDirs}
            activeFilePath={activeFilePath}
            onFileSelect={handleFileSelect}
            onToggleDir={toggleDir}
            loading={treeLoading}
          />
        </aside>

        {/* Main content */}
        <div className={styles.main}>
          {treeError && <div className={styles.error}>{treeError}</div>}

          {fileError && <div className={styles.error}>{fileError}</div>}

          {fileLoading && <div className={styles.loading}>Loading file…</div>}

          {!fileLoading && !fileError && activeFile ? (
            <CodePanel
              content={activeFile.content}
              language={activeFile.language}
              fileName={activeFile.path}
              scrollTop={activeFile.scrollTop}
              onScroll={handleScroll}
            />
          ) : (
            !fileLoading &&
            !fileError &&
            !treeError &&
            !activeFile && <div className={styles.placeholder}>Select a file to view</div>
          )}
        </div>
      </div>
    </div>
  );
}
