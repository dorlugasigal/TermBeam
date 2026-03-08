import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { useUIStore } from '@/stores/uiStore';
import { useSessionStore } from '@/stores/sessionStore';
import { uploadFile } from '@/services/api';
import { FolderBrowser } from '@/components/FolderBrowser/FolderBrowser';
import styles from './UploadModal.module.css';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadModal() {
  const open = useUIStore((s) => s.uploadModalOpen);
  const close = useUIStore((s) => s.closeUploadModal);
  const activeId = useSessionStore((s) => s.activeId);

  const [files, setFiles] = useState<File[]>([]);
  const [targetDir, setTargetDir] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadIndex, setUploadIndex] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-fill target directory with session cwd when modal opens
  useEffect(() => {
    if (open && activeId) {
      const ms = useSessionStore.getState().sessions.get(activeId);
      if (ms?.cwd) setTargetDir(ms.cwd);
    }
  }, [open, activeId]);

  const reset = useCallback(() => {
    setFiles([]);
    setTargetDir('');
    setUploading(false);
    setProgress(0);
    setUploadIndex(0);
    setDragOver(false);
    setShowBrowser(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    close();
  }, [reset, close]);

  const handleFileSelect = useCallback((selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0) return;
    const valid: File[] = [];
    let rejected = 0;
    for (const f of Array.from(selectedFiles)) {
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`"${f.name}" too large (${formatSize(f.size)}). Max 10 MB.`);
        rejected++;
      } else {
        valid.push(f);
      }
    }
    if (rejected > 0 && valid.length === 0) return;
    setFiles(valid);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect],
  );

  const handleUpload = useCallback(async () => {
    if (files.length === 0 || !activeId) return;
    setUploading(true);
    setProgress(0);
    setUploadIndex(0);
    let uploaded = 0;
    let failed = 0;
    const dir = targetDir || undefined;
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      setUploadIndex(i);
      setProgress(0);
      try {
        await uploadFile(activeId, file, dir, (pct) => setProgress(pct));
        uploaded++;
      } catch {
        failed++;
      }
    }
    setUploading(false);
    if (uploaded > 0) {
      toast.success(
        `${uploaded} file(s) uploaded${dir ? ` to ${dir}` : ''}`,
      );
    }
    if (failed > 0) {
      toast.error(`${failed} file(s) failed to upload`);
    }
    if (uploaded > 0) handleClose();
  }, [files, activeId, targetDir, handleClose]);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>Upload Files</Dialog.Title>
          <button
            className={styles.close}
            onClick={handleClose}
            aria-label="Close"
          >
            ✕
          </button>

          {/* Drop zone */}
          <div
            className={`${styles.dropZone} ${dragOver ? styles.dropZoneDragOver : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {files.length > 0
              ? 'Click or drag to replace files'
              : 'Drop files here or click to browse'}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              handleFileSelect(e.target.files);
              e.target.value = '';
            }}
          />

          {/* Selected file list */}
          {files.length > 0 && (
            <div className={styles.fileList}>
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className={styles.fileInfo}>
                  <span className={styles.fileName}>{f.name}</span>
                  <span className={styles.fileSize}>{formatSize(f.size)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Progress bar */}
          {uploading && (
            <div className={styles.progressWrapper}>
              <div className={styles.progressBar} style={{ width: `${progress}%` }} />
              <span className={styles.progressLabel}>
                {files.length > 1
                  ? `File ${uploadIndex + 1}/${files.length} — ${progress}%`
                  : `${progress}%`}
              </span>
            </div>
          )}

          {/* Target directory */}
          <div className={styles.targetDirGroup}>
            <label className={styles.label}>Target directory (optional)</label>
            <div className={styles.targetDirRow}>
              <input
                className={styles.input}
                value={targetDir}
                onChange={(e) => setTargetDir(e.target.value)}
                placeholder="e.g. /home/user/uploads"
              />
              <button
                className={styles.browseBtn}
                onClick={() => setShowBrowser((v) => !v)}
                type="button"
              >
                Browse
              </button>
            </div>
          </div>

          {/* Folder browser */}
          {showBrowser && (
            <div className={styles.folderBrowserWrapper}>
              <FolderBrowser
                currentDir={targetDir || '/'}
                onSelect={(path) => {
                  setTargetDir(path);
                  setShowBrowser(false);
                }}
                onCancel={() => setShowBrowser(false)}
              />
            </div>
          )}

          {/* Hide upload actions while browsing folders */}
          {!showBrowser && (
            <>
              <p className={styles.hint}>Max 10 MB</p>
              <div className={styles.actions}>
                <button className={styles.cancelBtn} onClick={handleClose}>
                  Cancel
                </button>
                <button
                  className={styles.uploadBtn}
                  onClick={handleUpload}
                  disabled={files.length === 0 || !activeId || uploading}
                >
                  {uploading
                    ? 'Uploading…'
                    : files.length > 1
                      ? `Upload ${files.length} Files`
                      : 'Upload'}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
