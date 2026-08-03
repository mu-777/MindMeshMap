import { create } from 'zustand';
import { UIState } from '../types';

// JSONテキストの入出力ダイアログの状態。開いている間はグローバルショートカットを
// 無効化する必要があるため（テキストエリアへの入力がノード編集開始やDelete削除を
// 誘発しないように。useKeyboardShortcuts参照）、ローカルstateではなくここで持つ
export type JsonTextDialogMode = 'export' | 'import';

export interface ContextMenuState {
  type: 'node' | 'edge';
  id: string;
  x: number;
  y: number;
  // 対象ノードのDOM矩形（ノードのコンテキストメニューのみ指定。エッジは未指定でx,yのみ使う）。
  // ContextMenu側でこれを基準に「対象に重ならない位置」を計算する（docs/decisions.md参照）
  anchorRect?: { left: number; top: number; right: number; bottom: number };
}

interface UIStoreState extends UIState {
  lastSelectedNodeId: string | null;
  selectedNodeIds: string[];
  // エッジの複数選択（Shift+クリックでトグル）。単独クリックでの選択状態は持たない
  // （単独クリックは常にラベル編集モードを開く。docs/decisions.md参照）
  selectedEdgeIds: string[];
  contextMenu: ContextMenuState | null;
  // nullなら閉じている
  jsonTextDialogMode: JsonTextDialogMode | null;
  // Drive保存が成功するたびにインクリメントするカウンタ。
  // MapListの一覧取得useEffectの依存に加えることで、保存後に一覧（名前・更新日時）を再取得させる
  mapListVersion: number;
  // ノード削除直後の矢印キーナビゲーション用アンカー。削除されたノードはlastSelectedNodeIdとして
  // 参照できなくなるため、削除直前の代表ノードの座標をここに退避しておき、矢印キー処理側で
  // 「消えたノードの位置」を起点に最寄りノードを探すフォールバックとして使う（docs/decisions.md参照）。
  // 通常のノード選択（setSelectedNodeId）が起きたら役目を終えるのでクリアする
  deletedFocusAnchor: { x: number; y: number } | null;
  setSelectedNodeId: (nodeId: string | null) => void;
  toggleNodeSelection: (nodeId: string) => void;
  addNodesToSelection: (ids: string[]) => void;
  setMultiSelection: (ids: string[]) => void;
  setDeletedFocusAnchor: (pos: { x: number; y: number } | null) => void;
  toggleEdgeSelection: (edgeId: string) => void;
  clearMultiSelection: () => void;
  clearEdgeSelection: () => void;
  setEditingNodeId: (nodeId: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setHelpModalOpen: (open: boolean) => void;
  toggleHelpModal: () => void;
  openJsonTextDialog: (mode: JsonTextDialogMode) => void;
  closeJsonTextDialog: () => void;
  openContextMenu: (
    type: 'node' | 'edge',
    id: string,
    x: number,
    y: number,
    anchorRect?: { left: number; top: number; right: number; bottom: number }
  ) => void;
  closeContextMenu: () => void;
  bumpMapListVersion: () => void;
}

export const useUIStore = create<UIStoreState>((set) => ({
  selectedNodeId: null,
  lastSelectedNodeId: null,
  selectedNodeIds: [],
  selectedEdgeIds: [],
  editingNodeId: null,
  isSidebarOpen: true,
  isHelpModalOpen: false,
  contextMenu: null,
  jsonTextDialogMode: null,
  mapListVersion: 0,
  deletedFocusAnchor: null,

  setSelectedNodeId: (nodeId) =>
    set((state) => ({
      selectedNodeId: nodeId,
      // 選択解除時は lastSelectedNodeId を更新しない
      lastSelectedNodeId: nodeId !== null ? nodeId : state.lastSelectedNodeId,
      // 単独クリックでの選択時（nodeIdがnull以外）は複数選択（ノード・エッジとも）をクリアする。
      // nodeId===null（選択解除）の呼び出しでは他の選択状態には触れない
      selectedNodeIds: nodeId !== null ? [] : state.selectedNodeIds,
      selectedEdgeIds: nodeId !== null ? [] : state.selectedEdgeIds,
      // 不変条件「編集中ノードは常に選択中」を保つ。この呼び出し後の選択は nodeId 単体
      // （複数選択はクリアされる）なので、編集中ノードが nodeId 自身でなければ編集を終了する。
      // これにより「ノードAを編集中に別ノードBをクリック→Aは選択解除されるのに editingNodeId が
      // A のまま残り、枠グレー＋緑リングの操作不能状態になる」不具合を防ぐ（docs/decisions.md §27）
      editingNodeId: state.editingNodeId === nodeId ? state.editingNodeId : null,
      // 通常の選択（nodeId!==null）が成立したら削除後フォーカス用アンカーの役目は終わり
      deletedFocusAnchor: nodeId !== null ? null : state.deletedFocusAnchor,
    })),

  toggleNodeSelection: (nodeId) =>
    set((state) => {
      // 現在のselectedNodeIdも含めた選択リストを作成
      const currentSelectedIds = [...state.selectedNodeIds];
      if (state.selectedNodeId && !currentSelectedIds.includes(state.selectedNodeId)) {
        currentSelectedIds.push(state.selectedNodeId);
      }

      const index = currentSelectedIds.indexOf(nodeId);
      let newSelectedNodeIds: string[];
      if (index >= 0) {
        // 既に選択されていたら解除
        newSelectedNodeIds = currentSelectedIds.filter((id) => id !== nodeId);
      } else {
        // 選択されていなければ追加
        newSelectedNodeIds = [...currentSelectedIds, nodeId];
      }
      return {
        selectedNodeIds: newSelectedNodeIds,
        // 複数選択モードではselectedNodeIdをクリア（selectedNodeIdsで管理）
        selectedNodeId: null,
        lastSelectedNodeId: nodeId,
        // エッジの選択状態は維持する（ノード・エッジ混在選択を許すため）
        // 不変条件「編集中ノードは常に選択中」を保つ。トグル後の選択集合（newSelectedNodeIds）に
        // 編集中ノードが含まれなくなった場合（編集中ノード自身をShift+クリックで選択解除した等）は
        // 編集を終了する。枠グレー＋緑リングの操作不能状態を防ぐ（docs/decisions.md §27）
        editingNodeId:
          state.editingNodeId && newSelectedNodeIds.includes(state.editingNodeId)
            ? state.editingNodeId
            : null,
      };
    }),

  // Shift+クリックで、アンカー（直近選択ノード）からクリックしたノードまでの無向最短経路上の
  // ノード群を、現在の選択にunionで追加する（エクスプローラのShift+クリック風の範囲選択）
  addNodesToSelection: (ids) =>
    set((state) => {
      const currentSelectedIds = new Set(state.selectedNodeIds);
      if (state.selectedNodeId) currentSelectedIds.add(state.selectedNodeId);
      ids.forEach((id) => currentSelectedIds.add(id));
      const newSelectedNodeIds = Array.from(currentSelectedIds);

      return {
        selectedNodeIds: newSelectedNodeIds,
        selectedNodeId: null,
        lastSelectedNodeId: ids[ids.length - 1] ?? state.lastSelectedNodeId,
        // 不変条件「編集中ノードは常に選択中」を保つ（toggleNodeSelectionと同様。docs/decisions.md §27）
        editingNodeId:
          state.editingNodeId && newSelectedNodeIds.includes(state.editingNodeId)
            ? state.editingNodeId
            : null,
      };
    }),

  // React FlowのonSelectionChange（Shift+ドラッグの矩形選択）から複数選択(2件以上)を橋渡しする。
  // 呼び出し側（MindMapCanvas）で2件以上のときのみ呼ぶ想定。ノード側の複数選択操作
  // （toggleNodeSelection/addNodesToSelection）と同じく、selectedNodeIdをクリアし
  // selectedEdgeIdsは維持する（ノード・エッジ混在選択を許すため）
  setMultiSelection: (ids) =>
    set((state) => ({
      selectedNodeIds: ids,
      selectedNodeId: null,
      lastSelectedNodeId: ids[ids.length - 1] ?? state.lastSelectedNodeId,
      deletedFocusAnchor: null,
      // 不変条件「編集中ノードは常に選択中」を保つ（toggleNodeSelection等と同様。docs/decisions.md §27）
      editingNodeId: state.editingNodeId && ids.includes(state.editingNodeId) ? state.editingNodeId : null,
    })),

  toggleEdgeSelection: (edgeId) =>
    set((state) => {
      const index = state.selectedEdgeIds.indexOf(edgeId);
      const newSelectedEdgeIds =
        index >= 0
          ? state.selectedEdgeIds.filter((id) => id !== edgeId)
          : [...state.selectedEdgeIds, edgeId];
      // ノードの選択状態は維持する（ノード・エッジ混在選択を許すため）
      return { selectedEdgeIds: newSelectedEdgeIds };
    }),

  clearMultiSelection: () =>
    set({ selectedNodeIds: [] }),

  clearEdgeSelection: () =>
    set({ selectedEdgeIds: [] }),

  setEditingNodeId: (nodeId) => set({ editingNodeId: nodeId }),

  setSidebarOpen: (open) => set({ isSidebarOpen: open }),

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),

  setHelpModalOpen: (open) => set({ isHelpModalOpen: open }),

  toggleHelpModal: () => set((state) => ({ isHelpModalOpen: !state.isHelpModalOpen })),

  openJsonTextDialog: (mode) => set({ jsonTextDialogMode: mode }),

  closeJsonTextDialog: () => set({ jsonTextDialogMode: null }),

  openContextMenu: (type, id, x, y, anchorRect) => set({ contextMenu: { type, id, x, y, anchorRect } }),

  closeContextMenu: () => set({ contextMenu: null }),

  bumpMapListVersion: () => set((state) => ({ mapListVersion: state.mapListVersion + 1 })),

  setDeletedFocusAnchor: (pos) => set({ deletedFocusAnchor: pos }),
}));
