import { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useCodeViewerStore } from '@/stores/codeViewerStore';
import { fetchFileTree, fetchFileContent, fetchGitBlame } from '@/services/api';
import { detectLanguage } from './CodePanel';
import FileExplorer, { type FileExplorerHandle } from './FileExplorer';
import FileTabs from './FileTabs';
import CodePanel from './CodePanel';
import GitChanges from './GitChanges';
import DiffViewer from './DiffViewer';
import styles from './CodeViewer.module.css';

const MarkdownViewer = lazy(() =>
  import('../MarkdownViewer/MarkdownViewer').then((m) => ({ default: m.MarkdownViewer })),
);

interface CodeViewerProps {
  sessionId: string;
  onClose?: () => void;
  initialView?: 'files' | 'changes';
}

function isMarkdownFile(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return ext === 'md' || ext === 'mdx' || ext === 'markdown';
}

export default function CodeViewer({ sessionId, onClose, initialView }: CodeViewerProps) {
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
    viewMode,
    setViewMode,
    gitStatus,
    gitDiff,
    diffFile,
    gitBlame,
    setGitBlame,
    blameEnabled,
    toggleBlame,
    bindSession,
  } = useCodeViewerStore();

  // Bind store to this session — resets all state if session changed
  bindSession(sessionId);

  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [mdPreview, setMdPreview] = useState(false);
  const [blameLoading, setBlameLoading] = useState(false);
  const explorerRef = useRef<FileExplorerHandle>(null);

  // Read initial view mode from prop or URL (?view=changes)
  useEffect(() => {
    if (initialView === 'changes') {
      setViewMode('changes');
      setSidebarOpen(true);
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'changes') {
      setViewMode('changes');
      setSidebarOpen(true);
    }
  }, [initialView, setViewMode, setSidebarOpen]);

  const handleSearchClick = useCallback(() => {
    if (!sidebarOpen) setSidebarOpen(true);
    if (viewMode !== 'files') setViewMode('files');
    // Small delay to let sidebar open before focusing
    setTimeout(() => explorerRef.current?.focusSearch(), 50);
  }, [sidebarOpen, setSidebarOpen, viewMode, setViewMode]);

  // Reset markdown preview when switching files
  useEffect(() => {
    setMdPreview(false);
  }, [activeFilePath]);

  // Load blame when toggled on for current file
  useEffect(() => {
    if (!blameEnabled || !activeFilePath) {
      setGitBlame(null);
      return;
    }
    let cancelled = false;
    setBlameLoading(true);
    fetchGitBlame(sessionId, activeFilePath)
      .then((blame) => {
        if (!cancelled) setGitBlame(blame);
      })
      .catch(() => {
        if (!cancelled) setGitBlame(null);
      })
      .finally(() => {
        if (!cancelled) setBlameLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [blameEnabled, activeFilePath, sessionId, setGitBlame]);

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
  const showMdToggle = activeFilePath && isMarkdownFile(activeFilePath);
  const showBlameToggle = activeFile && viewMode === 'files' && !mdPreview;
  const showDiff = viewMode === 'changes' && diffFile && gitDiff;
  const changesCount = gitStatus
    ? gitStatus.staged.length + gitStatus.modified.length + gitStatus.untracked.length
    : 0;

  return (
    <div className={styles.page}>
      {/* Custom top bar: hamburger | tabs | md preview toggle | close */}
      <header className={styles.topBar}>
        <button
          className={styles.menuBtn}
          onClick={toggleSidebar}
          aria-label={sidebarOpen ? 'Close explorer' : 'Open explorer'}
        >
          ☰
        </button>

        <button
          className={styles.toolBtn}
          onClick={handleSearchClick}
          aria-label="Search files"
          title="Search files"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>

        <div className={styles.tabsWrapper}>
          <FileTabs
            files={openFiles}
            activeFilePath={activeFilePath}
            onSelect={setActiveFile}
            onClose={closeFile}
          />
        </div>

        {showMdToggle && (
          <button
            className={`${styles.toolBtn} ${mdPreview ? styles.toolBtnActive : ''}`}
            onClick={() => setMdPreview((p) => !p)}
            title={mdPreview ? 'Show source' : 'Preview markdown'}
          >
            {mdPreview ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 18 22 12 16 6" />
                <polyline points="8 6 2 12 8 18" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        )}

        {showBlameToggle && (
          <button
            className={`${styles.toolBtn} ${blameEnabled ? styles.toolBtnActive : ''}`}
            onClick={toggleBlame}
            title={blameEnabled ? 'Hide blame' : 'Show blame'}
            aria-label={blameEnabled ? 'Hide blame annotations' : 'Show blame annotations'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </button>
        )}

        {onClose ? (
          <button
            className={styles.backLink}
            onClick={onClose}
            title="Back to terminal"
            aria-label="Close code viewer"
          >
            ✕
          </button>
        ) : (
          <a href="/terminal" className={styles.backLink} title="Back to terminal">
            ✕
          </a>
        )}
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
          <div className={styles.sidebarHeader}>
            <button
              className={`${styles.viewModeTab} ${viewMode === 'files' ? styles.viewModeTabActive : ''}`}
              onClick={() => setViewMode('files')}
              aria-label="File explorer"
            >
              Files
            </button>
            <button
              className={`${styles.viewModeTab} ${viewMode === 'changes' ? styles.viewModeTabActive : ''}`}
              onClick={() => setViewMode('changes')}
              aria-label="Git changes"
            >
              Changes
              {changesCount > 0 && (
                <span className={styles.changesBadge}>{changesCount}</span>
              )}
            </button>
          </div>

          {viewMode === 'files' ? (
            <FileExplorer
              ref={explorerRef}
              tree={fileTree}
              expandedDirs={expandedDirs}
              activeFilePath={activeFilePath}
              onFileSelect={handleFileSelect}
              onToggleDir={toggleDir}
              loading={treeLoading}
            />
          ) : (
            <GitChanges sessionId={sessionId} />
          )}
        </aside>

        {/* Main content */}
        <div className={styles.main}>
          {treeError && <div className={styles.error}>{treeError}</div>}

          {fileError && <div className={styles.error}>{fileError}</div>}

          {fileLoading && <div className={styles.loading}>Loading file…</div>}

          {showDiff ? (
            <DiffViewer sessionId={sessionId} diff={gitDiff} />
          ) : !fileLoading && !fileError && activeFile ? (
            mdPreview && isMarkdownFile(activeFile.path) ? (
              <Suspense fallback={<div className={styles.loading}>Loading preview…</div>}>
                <MarkdownViewer
                  sessionId={sessionId}
                  filePath={activeFile.path}
                  fileName={activeFile.path.split('/').pop() || activeFile.path}
                  onClose={() => setMdPreview(false)}
                  hideHeader
                  onNavigate={(newPath) => {
                    handleFileSelect(newPath);
                    setMdPreview(true);
                  }}
                />
              </Suspense>
            ) : (
              <CodePanel
                content={activeFile.content}
                language={activeFile.language}
                fileName={activeFile.path}
                scrollTop={activeFile.scrollTop}
                onScroll={handleScroll}
                blame={blameEnabled ? gitBlame : null}
                blameEnabled={blameEnabled}
                blameLoading={blameLoading}
              />
            )
          ) : (
            !fileLoading &&
            !fileError &&
            !treeError &&
            !activeFile &&
            !showDiff && <div className={styles.placeholder}>Select a file to view</div>
          )}
        </div>
      </div>
    </div>
  );
}
