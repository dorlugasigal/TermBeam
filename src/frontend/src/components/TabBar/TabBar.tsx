import { useCallback, useRef, useState } from 'react';
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
  const previewAnchorRef = useRef<HTMLDivElement | null>(null);
  const tabScrollerRef = useRef<HTMLDivElement>(null);

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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleTabOrder} strategy={horizontalListSortingStrategy}>
          <div className={styles.tabScroller} ref={tabScrollerRef}>
            {orderedSessions.map((session) => (
              <div
                key={session.id}
                className={styles.tabSlot}
                data-session-id={session.id}
              >
                <SortableTab
                  session={session}
                  isActive={session.id === activeId}
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
                      color: session.color || '#6ec1e4',
                      variant: 'tab',
                      apiDelete: () => deleteSession(session.id),
                      finalize: () => removeSession(session.id),
                    });
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
          + <span className={styles.addBtnLabel}>New</span>
        </button>
      )}
    </div>
  );
}
