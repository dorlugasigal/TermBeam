import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { useSessionStore } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { useDissolveDelete } from '@/hooks/useDissolveDelete';
import { deleteSession } from '@/services/api';
import { SortableTab } from './SortableTab';
import { TabPreview } from './TabPreview';
import styles from './TabBar.module.css';

interface TabBarProps {
  inline?: boolean;
}

export function TabBar({ inline = false }: TabBarProps) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeId = useSessionStore((s) => s.activeId);
  const tabOrder = useSessionStore((s) => s.tabOrder);
  const splitMode = useSessionStore((s) => s.splitMode);
  const dissolvingIds = useSessionStore((s) => s.dissolvingIds);
  const setActiveId = useSessionStore((s) => s.setActiveId);
  const setTabOrder = useSessionStore((s) => s.setTabOrder);
  const removeSession = useSessionStore((s) => s.removeSession);
  const openNewSessionModal = useUIStore((s) => s.openNewSessionModal);
  const dissolveDelete = useDissolveDelete();

  const [previewSession, setPreviewSession] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(activeId);
  const previewAnchorRef = useRef<HTMLDivElement | null>(null);
  const tabScrollerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorPlaced = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [edges, setEdges] = useState({ start: false, end: false });

  // The active-tab surface is one element that slides between tabs, so a
  // switch reads as motion from A to B rather than two tabs blinking.
  useLayoutEffect(() => {
    const scroller = tabScrollerRef.current;
    const indicator = indicatorRef.current;
    if (!scroller || !indicator) return;
    const place = (animate: boolean) => {
      const tab = scroller.querySelector<HTMLElement>('[role="tab"][data-active="true"]');
      if (!tab) {
        indicator.dataset.hidden = 'true';
        return;
      }
      const x = tab.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
      if (!animate) indicator.style.transition = 'none';
      indicator.style.transform = `translateX(${x + scroller.scrollLeft}px)`;
      indicator.style.width = `${tab.offsetWidth}px`;
      delete indicator.dataset.hidden;
      if (!animate) {
        void indicator.offsetWidth;
        indicator.style.transition = '';
      }
    };
    place(indicatorPlaced.current);
    indicatorPlaced.current = true;
    const observer = new ResizeObserver(() => place(false));
    for (const tab of scroller.querySelectorAll('[role="tab"]')) observer.observe(tab);
    return () => observer.disconnect();
  }, [activeId, tabOrder, sessions.size, dragging]);

  useEffect(() => {
    const scroller = tabScrollerRef.current;
    if (!scroller) return;
    const measure = () =>
      setEdges({
        start: scroller.scrollLeft > 1,
        end: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1,
      });
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    for (const tab of scroller.children) observer.observe(tab);
    scroller.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      scroller.removeEventListener('scroll', measure);
    };
  }, [tabOrder, sessions.size]);

  useEffect(() => {
    setFocusedId(activeId);
    const tab = tabScrollerRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = tabOrder.indexOf(active.id as string);
        const newIndex = tabOrder.indexOf(over.id as string);
        setTabOrder(arrayMove(tabOrder, oldIndex, newIndex));
      }
    },
    [tabOrder, setTabOrder],
  );

  const visibleTabOrder = tabOrder.filter((id) => {
    const s = sessions.get(id);
    return s && !s.hidden;
  });

  const orderedSessions = visibleTabOrder
    .map((id) => sessions.get(id))
    .filter((s): s is NonNullable<typeof s> => s != null);

  // Determine the split pane's session ID (first non-active tab)
  const isSplit = splitMode !== 'off';
  const splitSecondId =
    isSplit && activeId
      ? (visibleTabOrder.filter((id) => sessions.has(id)).find((id) => id !== activeId) ?? null)
      : null;

  return (
    <div className={inline ? styles.tabBarInline : styles.tabBar}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDragging(true)}
        onDragCancel={() => setDragging(false)}
        onDragEnd={(event) => {
          setDragging(false);
          handleDragEnd(event);
        }}
      >
        <SortableContext items={visibleTabOrder} strategy={horizontalListSortingStrategy}>
          <div
            className={styles.tabScroller}
            ref={tabScrollerRef}
            role="tablist"
            aria-label="Sessions"
            data-fade-start={edges.start}
            data-fade-end={edges.end}
            data-dragging={dragging || undefined}
            onKeyDown={(e) => {
              if (!(e.target instanceof HTMLElement) || e.target.getAttribute('role') !== 'tab') {
                return;
              }
              const index = visibleTabOrder.indexOf(
                e.target.closest<HTMLElement>('[data-session-id]')?.dataset.sessionId ?? '',
              );
              const next =
                e.key === 'ArrowRight'
                  ? (index + 1) % visibleTabOrder.length
                  : e.key === 'ArrowLeft'
                    ? (index - 1 + visibleTabOrder.length) % visibleTabOrder.length
                    : e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? visibleTabOrder.length - 1
                        : -1;
              const id = visibleTabOrder[next];
              if (!id) return;
              e.preventDefault();
              setFocusedId(id);
              tabScrollerRef.current
                ?.querySelector<HTMLElement>(`[data-session-id="${id}"] [role="tab"]`)
                ?.focus();
            }}
          >
            <span
              ref={indicatorRef}
              className={styles.indicator}
              data-hidden="true"
              aria-hidden="true"
            />
            {orderedSessions.map((session) => (
              <div key={session.id} className={styles.tabSlot} data-session-id={session.id}>
                <SortableTab
                  session={session}
                  isActive={session.id === activeId}
                  tabIndex={session.id === (focusedId ?? activeId) ? 0 : -1}
                  isSplit={session.id === splitSecondId}
                  dissolving={dissolvingIds.has(session.id)}
                  onActivate={() => {
                    if (dissolvingIds.has(session.id)) return;
                    setActiveId(session.id);
                  }}
                  onClose={() => {
                    if (dissolvingIds.has(session.id)) return;
                    /*
                     * If the user is closing the active tab, swap to the
                     * next visible tab immediately so they aren't
                     * stranded staring at a fading terminal during the
                     * disintegrate.
                     */
                    if (session.id === activeId) {
                      const nextActive = visibleTabOrder.find((id) => id !== session.id);
                      if (nextActive) setActiveId(nextActive);
                    }
                    const tabEl = tabScrollerRef.current?.querySelector<HTMLElement>(
                      `[data-session-id="${session.id}"]`,
                    );
                    void dissolveDelete(session.id, {
                      element: tabEl ?? null,
                      color:
                        session.color ||
                        getComputedStyle(document.documentElement).getPropertyValue('--accent'),
                      variant: 'tab',
                      apiDelete: () => deleteSession(session.id),
                      finalize: () => removeSession(session.id),
                    }).catch(() => toast.error('Failed to close session'));
                  }}
                  onMouseEnter={(e) => {
                    previewAnchorRef.current = e.currentTarget;
                    setPreviewSession(session.id);
                  }}
                  onMouseLeave={() => setPreviewSession(null)}
                />
                {previewSession === session.id && (
                  <TabPreview session={session} anchorEl={previewAnchorRef.current} />
                )}
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {!inline && (
        <button
          className={styles.addBtn}
          data-testid="tab-new-btn"
          onClick={() => openNewSessionModal()}
          aria-label="New session"
          title="New session"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className={styles.addBtnLabel}>New</span>
        </button>
      )}
    </div>
  );
}
