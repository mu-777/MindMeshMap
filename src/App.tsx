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
    <div className="flex h-screen w-screen overflow-hidden bg-gray-900">
      {/* サイドバー */}
      {isSidebarOpen && (
        <div className="w-64 flex-shrink-0 border-r border-gray-700 bg-gray-800">
          <MapList />
        </div>
      )}

      {/* メインエリア */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ツールバー */}
        <Toolbar />

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
