import { useEffect } from 'react';
import { useStore } from './state/store';
import { Header, ErrorCallout } from './components/common';
import { StartScreen } from './screens/StartScreen';
import { LoadScreen } from './screens/LoadScreen';
import { EditScreen } from './screens/EditScreen';
import { ExportDialog } from './screens/ExportDialog';
import { DoneScreen } from './screens/DoneScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { RecoveryDialog } from './screens/RecoveryDialog';
import { AUTOSAVE_DEBOUNCE_MS } from '@shared/constants';

export function App() {
  const screen = useStore((s) => s.screen);
  const appInfo = useStore((s) => s.appInfo);
  const globalError = useStore((s) => s.globalError);
  const init = useStore((s) => s.init);
  const openSettings = useStore((s) => s.openSettingsScreen);
  const resetToStart = useStore((s) => s.resetToStart);
  const clearGlobalError = useStore((s) => s.clearGlobalError);

  useEffect(() => {
    void init();
  }, [init]);

  // 自動保存: 変更後 1000ms debounce
  useEffect(() => {
    let timer: number | null = null;
    const unsub = useStore.subscribe((s, prev) => {
      if (s.screen !== 'edit' && s.screen !== 'done') return;
      if (s.revision === prev.revision && s.title === prev.title) return;
      if (!s.projectId || !s.selected) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void useStore.getState().saveProject(false), AUTOSAVE_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const onLogo = () => {
    const s = useStore.getState();
    if (s.screen === 'edit' && s.dirty) void s.saveProject(false);
    resetToStart();
  };

  return (
    <div className="app">
      <Header screen={screen} edition={appInfo?.edition ?? null} onLogo={onLogo} onSettings={openSettings} />
      <main className="main" id="main">
        {globalError && (
          <div className="container mt-4">
            <ErrorCallout error={globalError} onRetry={clearGlobalError} retryLabel="閉じる" />
          </div>
        )}
        {screen === 'start' && <StartScreen />}
        {screen === 'load' && <LoadScreen />}
        {screen === 'edit' && <EditScreen />}
        {screen === 'done' && <DoneScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </main>
      <ExportDialog />
      <RecoveryDialog />
    </div>
  );
}
