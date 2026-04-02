import { describe, it, expect, vi } from 'vitest';
import { respawnItem } from '@/store/appStore';
import { useRespawnCheck } from '@/hooks/useRespawnCheck';
import { createStore } from 'zustand';
const store = createStore(() => ({}));

vi.mock('@/store/supabaseSync', () => ({
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('deterministic-uuid'),
}));

afterEach(() => {
  store.setState({}); // Reset Zustand store state between tests
});

describe('respawnItem', () => {
  it('creates a copy with status not_started', () => {
    // Arrange
    const original = { rank: 1, title: 'Test Item', description: 'Test Description', points: 10, parentId: 'parent-id', backlogId: 'backlog-id' };

    // Act
    respawnItem(original);

    // Assert
    expect(mockUpsertWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      status: 'not_started',
      title: 'Test Item',
      description: 'Test Description',
      points: 10,
      parentId: 'parent-id',
      backlogId: 'backlog-id',
      rank: original.rank + 1,
    }));
  });

  it('shifts ranks of sibling items', () => {
    // Arrange
    const original = { rank: 1, parentId: 'parent-id', backlogId: 'backlog-id' };

    // Act
    respawnItem(original);

    // Assert
    expect(mockUpsertWorkItems).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ rank: expect.any(Number) })]));
  });

  it('updates respawnLastTriggeredAt on source item', () => {
    // Arrange
    const original = { respawnLastTriggeredAt: null }; // Modify as needed

    // Act
    respawnItem(original);

    // Assert
    expect(mockUpsertWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      respawnLastTriggeredAt: expect.any(String), // ISO string
    }));
  });

  it('does nothing if orgId missing', () => {
    // Act
    respawnItem({});

    // Assert
    expect(mockUpsertWorkItem).not.toHaveBeenCalled();
  });

  it('triggers respawnItem on condition', () => {
    // Mock time settings
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-02T08:56:00Z')); // Set desired time for the test

    // Act
    useRespawnCheck();

    // Assert
    expect(respawnItem).toHaveBeenCalled();
  });
});