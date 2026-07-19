import { useState } from 'react';
import { useDeleteGuardStore } from '@/store/deleteGuardStore';
import { ActionPrompt } from '@/components/ActionPrompt';
import { MoveTimeDialog } from '@/components/MoveTimeDialog';

/**
 * Global host that renders the "logged time detected" prompt and the
 * MoveTimeDialog when a guarded delete is requested via
 * useDeleteWithTimeGuard.
 */
export function DeleteGuardHost() {
  const pending = useDeleteGuardStore((s) => s.pending);
  const clear = useDeleteGuardStore((s) => s.clear);
  const [moveOpen, setMoveOpen] = useState(false);

  if (!pending) return null;

  if (moveOpen) {
    return (
      <MoveTimeDialog
        open={moveOpen}
        entryIds={pending.entryIds}
        title={`Move ${pending.entryIds.length} time ${pending.entryIds.length === 1 ? 'entry' : 'entries'} before deleting`}
        excludeTarget={pending.target}
        onOpenChange={(open) => {
          if (!open) {
            setMoveOpen(false);
            clear();
          }
        }}
        onMoved={() => {
          const confirm = pending.onConfirm;
          setMoveOpen(false);
          clear();
          confirm();
        }}
      />
    );
  }

  const count = pending.entryIds.length;
  return (
    <ActionPrompt
      title={`${count} time ${count === 1 ? 'entry is' : 'entries are'} logged on "${pending.label}"`}
      options={[
        {
          label: 'Move time entries…',
          description: 'Reassign the logged time to another item, backlog, or tree first.',
          value: 'move',
          isDefault: true,
        },
        {
          label: 'Delete without moving',
          description: 'The logged time will remain in reports but detached from any item.',
          value: 'delete',
          variant: 'destructive',
        },
      ]}
      onSelect={(v) => {
        if (v === 'move') {
          setMoveOpen(true);
        } else {
          const confirm = pending.onConfirm;
          clear();
          confirm();
        }
      }}
      onCancel={clear}
    />
  );
}
