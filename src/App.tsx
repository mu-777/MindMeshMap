import { ReactFlowProvider } from '@xyflow/react';
import { MindMapCanvas } from './components/Editor/MindMapCanvas';
import { Toolbar } from './components/Editor/Toolbar';
import { MapList } from './components/Sidebar/MapList';
import { KeyboardShortcutHelp } from './components/Common/KeyboardShortcutHelp';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useUIStore } from './stores/uiStore';

function AppContent() {
  useKeyboardShortcuts();
  const { isSidebarOpen, isHelpModalOpen, setHelpModalOpen } = useUIStore();

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-gray-900">
      {/* ツールバー（最上部に固定） */}
      <Toolbar />

      {/* メインエリア（サイドバー + キャンバス） */}
      <div className="flex flex-1 overflow-hidden">
        {/* サイドバー */}
        {isSidebarOpen && (
          <div className="w-48 flex-shrink-0 border-r border-gray-700 bg-gray-800 sm:w-56 md:w-64">
            <MapList />
          </div>
        )}

        {/* キャンバス */}
        <div className="flex-1 overflow-hidden">
          <MindMapCanvas />
        </div>
      </div>

      {/* ヘルプモーダル */}
      {isHelpModalOpen && (
        <KeyboardShortcutHelp onClose={() => setHelpModalOpen(false)} />
      )}
    </div>
  );
}

function App() {
  return (
    <ReactFlowProvider>
      <AppContent />
    </ReactFlowProvider>
  );
}

export default App;
