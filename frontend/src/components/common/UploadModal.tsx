import { useCallback, useRef, useState, type DragEvent } from 'react';
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

  const [file, setFile] = useState<File | null>(null);
  const [targetDir, setTargetDir] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setFile(null);
    setTargetDir('');
    setUploading(false);
    setDragOver(false);
    setShowBrowser(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    close();
  }, [reset, close]);

  const handleFileSelect = useCallback(
    (selected: File | null) => {
      if (!selected) return;
      if (selected.size > MAX_FILE_SIZE) {
        toast.error(`File too large (${formatSize(selected.size)}). Max 10 MB.`);
        return;
      }
      setFile(selected);
    },
    [],
  );

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const dropped = e.dataTransfer.files[0];
      handleFileSelect(dropped ?? null);
    },
    [handleFileSelect],
  );

  const handleUpload = useCallback(async () => {
    if (!file || !activeId) return;
    setUploading(true);
    try {
      const result = await uploadFile(activeId, file, targetDir || undefined);
      toast.success(`Uploaded to ${result.path}`);
      handleClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Upload failed',
      );
    } finally {
      setUploading(false);
    }
  }, [file, activeId, targetDir, handleClose]);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.content}>
          <Dialog.Title className={styles.title}>Upload File</Dialog.Title>
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
            {file ? 'Click or drag to replace file' : 'Drop a file here or click to browse'}
          </div>

          <input
            ref={fileInputRef}
            type="file"
            hidden
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
          />

          {/* Selected file info */}
          {file && (
            <div className={styles.fileInfo}>
              <span className={styles.fileName}>{file.name}</span>
              <span className={styles.fileSize}>{formatSize(file.size)}</span>
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
                onSelect={(path) => {
                  setTargetDir(path);
                  setShowBrowser(false);
                }}
              />
            </div>
          )}

          <p className={styles.hint}>Max 10 MB</p>

          {/* Actions */}
          <div className={styles.actions}>
            <button className={styles.cancelBtn} onClick={handleClose}>
              Cancel
            </button>
            <button
              className={styles.uploadBtn}
              onClick={handleUpload}
              disabled={!file || !activeId || uploading}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
