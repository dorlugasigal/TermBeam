import { useRef, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import styles from './Sheet.module.css';

const SHEET_QUERY = '(max-width: 640px)';
/** Pull distance (px) or flick speed (px/ms) that dismisses a sheet. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.6;

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Rendered under the title (tabs, segmented controls…). */
  headerExtra?: ReactNode;
  /** Pinned under the scrolling body. */
  footer?: ReactNode;
  children?: ReactNode;
  /** Desktop width. Phones always get a full-width bottom sheet. */
  size?: 'sm' | 'md' | 'lg';
  /** `system` sheets (connection, re-auth) stack above every other surface. */
  layer?: 'default' | 'system';
  hideClose?: boolean;
  testId?: string;
  className?: string;
  bodyClassName?: string;
  onOpenAutoFocus?: (e: Event) => void;
}

const CloseIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </svg>
);

/**
 * The one modal surface. On phones it's a bottom sheet that springs up and
 * can be flicked or dragged away by its header (the scrim fades with the
 * pull); on wider screens it's a centered dialog. Exit keyframes only define
 * their end state, so a dragged sheet leaves from wherever it was released.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  headerExtra,
  footer,
  children,
  size = 'md',
  layer = 'default',
  hideClose = false,
  testId,
  className,
  bodyClassName,
  onOpenAutoFocus,
}: SheetProps) {
  const isSheet = useMediaQuery(SHEET_QUERY);
  const contentRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    startY: number;
    lastY: number;
    lastT: number;
    v: number;
  } | null>(null);

  const settle = () => {
    const el = contentRef.current;
    const scrim = overlayRef.current;
    if (el) {
      el.style.transition = 'transform 420ms var(--ease-spring-soft)';
      el.style.transform = '';
    }
    if (scrim) {
      scrim.style.transition = 'opacity 240ms var(--ease-out)';
      scrim.style.opacity = '';
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isSheet || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea, [role="tab"]')) {
      return;
    }
    drag.current = {
      id: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      lastT: e.timeStamp,
      v: 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (contentRef.current) contentRef.current.style.transition = 'none';
    if (overlayRef.current) overlayRef.current.style.transition = 'none';
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    // Follow the finger down; resist going up
    const y = dy > 0 ? dy : dy * 0.16;
    if (contentRef.current) contentRef.current.style.transform = `translateY(${y}px)`;
    if (overlayRef.current) {
      overlayRef.current.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / 420));
    }
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const dy = e.clientY - d.startY;
    if (dy > DISMISS_DISTANCE || (dy > 24 && d.v > DISMISS_VELOCITY)) {
      onOpenChange(false);
      return;
    }
    settle();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          ref={overlayRef}
          className={`${styles.overlay} ${layer === 'system' ? styles.systemLayer : ''}`}
        />
        <Dialog.Content
          ref={contentRef}
          className={`${styles.sheet} ${styles[size]} ${layer === 'system' ? styles.systemLayer : ''} ${className ?? ''}`}
          data-testid={testId}
          onOpenAutoFocus={onOpenAutoFocus}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div
            className={styles.head}
            data-draggable={isSheet || undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
          >
            <span className={styles.grabber} aria-hidden="true" />
            <div className={styles.headRow}>
              <Dialog.Title className={styles.title}>{title}</Dialog.Title>
              {!hideClose && (
                <Dialog.Close className={styles.close} aria-label="Close">
                  <CloseIcon />
                </Dialog.Close>
              )}
            </div>
            {description && (
              <Dialog.Description className={styles.description}>{description}</Dialog.Description>
            )}
            {headerExtra}
          </div>
          <div className={`${styles.body} ${bodyClassName ?? ''}`}>{children}</div>
          {footer && <div className={styles.footer}>{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default Sheet;
