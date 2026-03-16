/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import type { TimelineSection } from '../../src/renderer/pages/conversation/grouped-history/types';

// ── localStorage mock ────────────────────────────────────────────────────────

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => storageMap.set(key, value)),
  removeItem: vi.fn((key: string) => storageMap.delete(key)),
  clear: vi.fn(() => storageMap.clear()),
  get length() {
    return storageMap.size;
  },
  key: vi.fn((_index: number) => null),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true, configurable: true });

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockInvoke = vi.fn().mockResolvedValue([]);
const mockEmitterEmit = vi.fn();
const mockRenameWorkspaceEntry = vi.fn();
const mockRemoveWorkspaceEntry = vi.fn();
const mockMessageSuccess = vi.fn();
const mockMessageWarning = vi.fn();
const mockMessageError = vi.fn();

vi.mock('../../src/common', () => ({
  ipcBridge: {
    database: {
      getUserConversations: { invoke: (...args: unknown[]) => mockInvoke(...args) },
    },
  },
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({}),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Shared ref so the hoisted mock factory can read the latest value
const testState = { sections: [] as TimelineSection[] };

vi.mock('../../src/renderer/pages/conversation/grouped-history/utils/groupingHelpers', () => ({
  buildGroupedHistory: () => ({
    pinnedConversations: [],
    timelineSections: testState.sections,
  }),
}));

vi.mock('../../src/renderer/utils/emitter', () => ({
  addEventListener: () => () => {},
  emitter: {
    emit: (...args: unknown[]) => mockEmitterEmit(...args),
  },
}));

vi.mock('../../src/renderer/utils/workspaceFs', () => ({
  renameWorkspaceEntry: (...args: unknown[]) => mockRenameWorkspaceEntry(...args),
  removeWorkspaceEntry: (...args: unknown[]) => mockRemoveWorkspaceEntry(...args),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    success: (...args: unknown[]) => mockMessageSuccess(...args),
    warning: (...args: unknown[]) => mockMessageWarning(...args),
    error: (...args: unknown[]) => mockMessageError(...args),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'aionui_workspace_expansion';

const makeWorkspaceSection = (workspaces: string[]): TimelineSection[] => [
  {
    timeline: 'conversation.history.today',
    items: workspaces.map((ws) => ({
      type: 'workspace' as const,
      time: Date.now(),
      workspaceGroup: {
        workspace: ws,
        displayName: ws.split('/').pop()!,
        conversations: [],
      },
    })),
  },
];

// ── Tests ────────────────────────────────────────────────────────────────────

// Import the hook statically since mocks are hoisted
import { useConversations } from '../../src/renderer/pages/conversation/grouped-history/hooks/useConversations';

describe('useConversations - workspace expansion', () => {
  beforeEach(() => {
    storageMap.clear();
    testState.sections = [];
    mockInvoke.mockResolvedValue([]);
    mockEmitterEmit.mockReset();
    mockRenameWorkspaceEntry.mockReset();
    mockRemoveWorkspaceEntry.mockReset();
    mockMessageSuccess.mockReset();
    mockMessageWarning.mockReset();
    mockMessageError.mockReset();
  });

  it('should auto-expand all workspaces on first load when localStorage is empty', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    expect(result.current.expandedWorkspaces).toEqual(expect.arrayContaining(['/ws/a', '/ws/b']));
    expect(result.current.expandedWorkspaces).toHaveLength(2);
  });

  it('should restore expansion state from localStorage', async () => {
    storageMap.set(STORAGE_KEY, JSON.stringify(['/ws/a']));
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    // Should keep only the stored value, not auto-expand all
    expect(result.current.expandedWorkspaces).toEqual(['/ws/a']);
  });

  it('should toggle workspace expansion on handleToggleWorkspace', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});
    expect(result.current.expandedWorkspaces).toContain('/ws/a');

    // Collapse /ws/a
    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });
    expect(result.current.expandedWorkspaces).not.toContain('/ws/a');
    expect(result.current.expandedWorkspaces).toContain('/ws/b');

    // Expand /ws/a again
    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });
    expect(result.current.expandedWorkspaces).toContain('/ws/a');
  });

  it('should persist expansion state to localStorage', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });

    const stored = JSON.parse(storageMap.get(STORAGE_KEY)!);
    expect(stored).toEqual(['/ws/b']);
  });

  it('should remove stale workspace entries from expandedWorkspaces', async () => {
    // localStorage has a workspace that no longer exists in data
    storageMap.set(STORAGE_KEY, JSON.stringify(['/ws/a', '/ws/stale']));
    testState.sections = makeWorkspaceSection(['/ws/a', '/ws/b']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});

    expect(result.current.expandedWorkspaces).not.toContain('/ws/stale');
    expect(result.current.expandedWorkspaces).toContain('/ws/a');
  });

  it('should not re-expand workspaces after user manually collapses all (#1156)', async () => {
    testState.sections = makeWorkspaceSection(['/ws/a']);

    const { result } = renderHook(() => useConversations());
    await act(async () => {});
    expect(result.current.expandedWorkspaces).toEqual(['/ws/a']);

    // User collapses the only workspace
    act(() => {
      result.current.handleToggleWorkspace('/ws/a');
    });

    // Should stay collapsed, not re-expand
    expect(result.current.expandedWorkspaces).toEqual([]);
  });

  it('should reject empty workspace rename', async () => {
    const { result } = renderHook(() => useConversations());

    let ok = false;
    await act(async () => {
      ok = await result.current.renameWorkspaceGroup('/ws/a', '   ');
    });

    expect(ok).toBe(false);
    expect(mockRenameWorkspaceEntry).not.toHaveBeenCalled();
    expect(mockMessageWarning).toHaveBeenCalledWith('conversation.workspace.contextMenu.renameEmpty');
  });

  it('should rename workspace group and refresh history on success', async () => {
    mockRenameWorkspaceEntry.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useConversations());

    let ok = false;
    await act(async () => {
      ok = await result.current.renameWorkspaceGroup('/ws/a', '  Renamed  ');
    });

    expect(ok).toBe(true);
    expect(mockRenameWorkspaceEntry).toHaveBeenCalledWith('/ws/a', 'Renamed');
    expect(mockEmitterEmit).toHaveBeenCalledWith('chat.history.refresh');
    expect(mockMessageSuccess).toHaveBeenCalledWith('conversation.workspace.contextMenu.renameSuccess');
  });

  it('should show error when workspace rename fails', async () => {
    mockRenameWorkspaceEntry.mockResolvedValue({ success: false, msg: 'rename failed' });
    const { result } = renderHook(() => useConversations());

    let ok = true;
    await act(async () => {
      ok = await result.current.renameWorkspaceGroup('/ws/a', 'Renamed');
    });

    expect(ok).toBe(false);
    expect(mockMessageError).toHaveBeenCalledWith('rename failed');
  });

  it('should delete workspace group and refresh history on success', async () => {
    mockRemoveWorkspaceEntry.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useConversations());

    let ok = false;
    await act(async () => {
      ok = await result.current.deleteWorkspaceGroup('/ws/a');
    });

    expect(ok).toBe(true);
    expect(mockRemoveWorkspaceEntry).toHaveBeenCalledWith('/ws/a');
    expect(mockEmitterEmit).toHaveBeenCalledWith('chat.history.refresh');
    expect(mockMessageSuccess).toHaveBeenCalledWith('conversation.workspace.contextMenu.deleteSuccess');
  });

  it('should show error when workspace deletion fails', async () => {
    mockRemoveWorkspaceEntry.mockResolvedValue({ success: false, msg: 'delete failed' });
    const { result } = renderHook(() => useConversations());

    let ok = true;
    await act(async () => {
      ok = await result.current.deleteWorkspaceGroup('/ws/a');
    });

    expect(ok).toBe(false);
    expect(mockMessageError).toHaveBeenCalledWith('delete failed');
  });
});
