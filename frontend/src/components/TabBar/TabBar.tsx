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
  const setActiveId = useSessionStore((s) => s.setActiveId);
  const setTabOrder = useSessionStore((s) => s.setTabOrder);
  const removeSession = useSessionStore((s) => s.removeSession);
  const openNewSessionModal = useUIStore((s) => s.openNewSessionModal);

  const [previewSession, setPreviewSession] = useState<string | null>(null);
  const previewAnchorRef = useRef<HTMLDivElement | null>(null);

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

  const orderedSessions = tabOrder
    .map((id) => sessions.get(id))
    .filter((s): s is NonNullable<typeof s> => s != null);

  // Determine the split pane's session ID (first non-active tab)
  const splitSecondId =
    splitMode && activeId
      ? tabOrder.filter((id) => sessions.has(id)).find((id) => id !== activeId) ?? null
      : null;

  return (
    <div className={inline ? styles.tabBarInline : styles.tabBar}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabOrder} strategy={horizontalListSortingStrategy}>
          <div className={styles.tabScroller}>
            {orderedSessions.map((session) => (
              <div key={session.id} style={{ position: 'relative' }}>
                <SortableTab
                  session={session}
                  isActive={session.id === activeId}
                  isSplit={session.id === splitSecondId}
                  onActivate={() => setActiveId(session.id)}
                  onClose={() => {
                    deleteSession(session.id).catch(() => {});
                    removeSession(session.id);
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
          onClick={openNewSessionModal}
          aria-label="New session"
          title="New session"
        >
          + <span className={styles.addBtnLabel}>New</span>
        </button>
      )}
    </div>
  );
}
