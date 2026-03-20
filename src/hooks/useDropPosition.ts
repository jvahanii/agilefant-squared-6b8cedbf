import { useRef, useCallback, useState } from 'react';

export type DropPosition = 'before' | 'after' | 'on';

/**
 * Given a droppable element ref and whether it's currently being hovered,
 * tracks pointer position to determine if the cursor is in the top third,
 * bottom third, or middle of the element.
 */
export function useDropPosition(isOver: boolean) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<DropPosition>('after');

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const el = nodeRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const ratio = y / rect.height;
    if (ratio < 0.35) setPosition('before');
    else if (ratio > 0.65) setPosition('after');
    else setPosition('on');
  }, []);

  return {
    position: isOver ? position : null,
    dropRef: nodeRef,
    dropPointerProps: isOver ? { onPointerMove } : {},
  };
}
