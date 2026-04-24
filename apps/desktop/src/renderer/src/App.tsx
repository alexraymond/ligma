import { useT } from '@ligma/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DeleteDesignDialog } from './components/DeleteDesignDialog';
import { DesignsView } from './components/DesignsView';
import { LeftRail } from './components/LeftRail';
import { NewProjectModal } from './components/NewProjectModal';
import { PermissionRequestModal } from './components/PermissionRequestModal';
import { PreviewPane } from './components/PreviewPane';
import { RenameDesignDialog } from './components/RenameDesignDialog';
import { Settings } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { ToastViewport } from './components/Toast';
import { TopStrip } from './components/TopStrip';
import { UpdateBanner } from './components/UpdateBanner';
import { CommentsPanel } from './components/comment/CommentsPanel';
import { ReportEventDialog } from './components/diagnostics/ReportEventDialog';
import { useKeyboard } from './hooks/useKeyboard';
import { useUpdateWiring } from './hooks/useUpdateWiring';
import { createUpdateStore } from './state/update-store';
import { useCodesignStore } from './store';
import { DesignSystemsView } from './views/DesignSystemsView';
import { HomeView } from './views/HomeView';

export function App() {
  const t = useT();
  const config = useCodesignStore((s) => s.config);
  const configLoaded = useCodesignStore((s) => s.configLoaded);
  const loadConfig = useCodesignStore((s) => s.loadConfig);
  const loadDesigns = useCodesignStore((s) => s.loadDesigns);
  const switchDesign = useCodesignStore((s) => s.switchDesign);
  const sendPrompt = useCodesignStore((s) => s.sendPrompt);
  const isGenerating = useCodesignStore(
    (s) => s.isGenerating && s.generatingDesignId === s.currentDesignId,
  );
  const setView = useCodesignStore((s) => s.setView);
  const view = useCodesignStore((s) => s.view);
  const previousView = useCodesignStore((s) => s.previousView);
  const designsViewOpen = useCodesignStore((s) => s.designsViewOpen);
  const closeDesignsView = useCodesignStore((s) => s.closeDesignsView);
  const designToDelete = useCodesignStore((s) => s.designToDelete);
  const designToRename = useCodesignStore((s) => s.designToRename);
  const requestDeleteDesign = useCodesignStore((s) => s.requestDeleteDesign);
  const requestRenameDesign = useCodesignStore((s) => s.requestRenameDesign);
  const openNewProjectModal = useCodesignStore((s) => s.openNewProjectModal);
  const newProjectModalOpen = useCodesignStore((s) => s.newProjectModalOpen);
  const closeNewProjectModal = useCodesignStore((s) => s.closeNewProjectModal);
  const interactionMode = useCodesignStore((s) => s.interactionMode);
  const setInteractionMode = useCodesignStore((s) => s.setInteractionMode);
  const activeReportLocalId = useCodesignStore((s) => s.activeReportLocalId);
  const closeReportDialog = useCodesignStore((s) => s.closeReportDialog);

  const [prompt, setPrompt] = useState('');
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    Math.max(320, Math.round(window.innerWidth * 0.25)),
  );
  const [isResizing, setIsResizing] = useState(false);

  const [updateStore] = useState(() => createUpdateStore({ dismissedVersion: '' }));
  useUpdateWiring(updateStore);

  useEffect(() => {
    if (!window.codesign) {
      updateStore.getState().markDismissedVersionReady('');
      return;
    }
    window.codesign.preferences
      .get()
      .then((prefs) => {
        updateStore.getState().markDismissedVersionReady(prefs.dismissedUpdateVersion ?? '');
      })
      .catch((err) => {
        console.warn('[App] failed to seed dismissedUpdateVersion', err);
        updateStore.getState().markDismissedVersionReady('');
      });
  }, [updateStore]);

  // Once the user has visited Hub we keep HomeView mounted (toggled via
  // `hidden`) so going Workspace → Home doesn't tear down the card iframes
  // and pay the srcDoc parse cost again.
  const [homeMounted, setHomeMounted] = useState(view === 'hub');
  useEffect(() => {
    if (view === 'hub') setHomeMounted(true);
  }, [view]);

  // Same trick for workspace — once visited, keep PreviewPane mounted so the
  // iframe pool survives Workspace ↔ Home round trips. Without this, the pool
  // rebuilds 5 iframes from srcDoc every time you come back (2-3s of parse).
  const [workspaceMounted, setWorkspaceMounted] = useState(view === 'workspace');
  useEffect(() => {
    if (view === 'workspace') setWorkspaceMounted(true);
  }, [view]);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const onMove = (ev: MouseEvent) => {
      const maxW = Math.round(window.innerWidth * 0.55);
      const clamped = Math.min(Math.max(ev.clientX, 280), maxW);
      setSidebarWidth(clamped);
    };
    const onUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    async function bootstrap(): Promise<void> {
      await Promise.all([loadConfig(), loadDesigns()]);
      const state = useCodesignStore.getState();
      if (state.currentDesignId === null && state.designs.length > 0) {
        const first = state.designs[0];
        if (first) await switchDesign(first.id);
      }
    }
    void bootstrap();
  }, [loadConfig, loadDesigns, switchDesign]);

  // Bridge for permission prompts: main dispatches per-tool requests via
  // `permissions.onRequest`; the store pushes them onto a FIFO queue that
  // PermissionRequestModal drains. Without this subscription the main-side
  // `canUseTool` callback would time out and auto-deny every tool call.
  useEffect(() => {
    const api = window.codesign?.permissions;
    if (!api) return;
    const unsubscribe = api.onRequest((req) => {
      useCodesignStore.getState().receivePermissionRequest(req);
    });
    return unsubscribe;
  }, []);

  const currentDesignId = useCodesignStore((s) => s.currentDesignId);
  const loadWorkspaceForDesign = useCodesignStore((s) => s.loadWorkspaceForDesign);
  useEffect(() => {
    if (currentDesignId !== null) void loadWorkspaceForDesign(currentDesignId);
  }, [currentDesignId, loadWorkspaceForDesign]);

  function submit(): void {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating) return;
    void sendPrompt({ prompt: trimmed });
    setPrompt('');
  }

  const ready = configLoaded && config !== null && config.hasKey;

  const bindings = useMemo(
    () => [
      {
        combo: 'mod+enter',
        handler: () => {
          if (!ready) return;
          const trimmed = prompt.trim();
          if (!trimmed || isGenerating) return;
          void sendPrompt({ prompt: trimmed });
          setPrompt('');
        },
      },
      {
        combo: 'mod+,',
        handler: () => {
          if (!ready) return;
          setView('settings');
        },
      },
      {
        combo: 'mod+n',
        handler: () => {
          if (!ready) return;
          openNewProjectModal();
        },
      },
      {
        combo: 'escape',
        handler: () => {
          if (newProjectModalOpen) {
            closeNewProjectModal();
            return;
          }
          if (designToDelete) {
            requestDeleteDesign(null);
            return;
          }
          if (designToRename) {
            requestRenameDesign(null);
            return;
          }
          if (designsViewOpen) {
            closeDesignsView();
            return;
          }
          if (interactionMode !== 'default') {
            setInteractionMode('default');
            return;
          }
          if (view === 'settings' || view === 'designSystems') {
            setView(previousView === view ? 'hub' : previousView);
          }
        },
        preventDefault: false,
      },
    ],
    [
      prompt,
      isGenerating,
      ready,
      sendPrompt,
      view,
      previousView,
      designsViewOpen,
      designToDelete,
      designToRename,
      interactionMode,
      setInteractionMode,
      setView,
      closeDesignsView,
      openNewProjectModal,
      newProjectModalOpen,
      closeNewProjectModal,
      requestDeleteDesign,
      requestRenameDesign,
    ],
  );
  useKeyboard(bindings);

  if (!configLoaded) {
    return (
      <div className="h-full flex items-center justify-center ligma-surface-paper text-[var(--text-sm)] text-[var(--color-text-muted)]">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col ligma-surface-paper" style={{ position: 'relative' }}>
      <UpdateBanner store={updateStore} />
      <TopStrip />
      <div className="flex-1 min-h-0 flex relative" style={{ zIndex: 2 }}>
        <LeftRail />
        <main className="flex-1 min-h-0 min-w-0 relative">
          {view === 'settings' ? <Settings /> : null}
          {view === 'designSystems' ? <DesignSystemsView /> : null}
          {homeMounted ? (
            <div hidden={view !== 'hub'} className="h-full">
              <HomeView />
            </div>
          ) : null}
          {workspaceMounted ? (
            <div hidden={view !== 'workspace'} className="h-full flex flex-col">
              <div className="flex-1 min-h-0 flex relative">
                {isResizing && <div className="absolute inset-0 z-20 cursor-col-resize" />}
                <div className="relative shrink-0" style={{ width: sidebarWidth }}>
                  <Sidebar prompt={prompt} setPrompt={setPrompt} onSubmit={submit} />
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    onMouseDown={onResizeStart}
                    className="absolute top-0 right-0 w-[5px] h-full cursor-col-resize z-10 hover:bg-[var(--color-accent)]/15 active:bg-[var(--color-accent)]/25 transition-colors duration-100"
                    style={{ transform: 'translateX(50%)' }}
                  />
                </div>
                <div className="flex flex-col min-h-0 flex-1 min-w-0">
                  <PreviewPane onPickStarter={(p) => setPrompt(p)} />
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>
      <DesignsView />
      <NewProjectModal />
      <RenameDesignDialog />
      <DeleteDesignDialog />
      <PermissionRequestModal />
      <ToastViewport />
      <CommentsPanel />
      <ReportEventDialog localId={activeReportLocalId} onClose={closeReportDialog} />
    </div>
  );
}
