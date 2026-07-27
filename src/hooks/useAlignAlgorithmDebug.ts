import { create } from 'zustand';
import { AlignAlgorithm } from '../types';

// 整列アルゴリズムの状態。本番ビルドでは常に既定アルゴリズム（DEFAULT_ALGORITHM）を返し、
// setterは何もしない。devビルドではlocalStorageに保存した値で切り替えられる
// （UIの出し分けだけでなく、状態管理側にもガードを入れることで、万一UIの出し分けが
// 漏れても本番挙動が変わらないようにする。docs/align-branch-layout.md「切り替え方法」参照）。
//
// 重要: コンポーネントローカルのuseStateではなくZustandストアにしている。書き込み側（Toolbarの
// セレクト）と読み取り側（useAutoLayout.applyLayout）は別々のコンポーネント/フックなので、
// useStateだと各自が独立した状態を持ち、セレクトを変えても整列側に伝わらない（既定値のまま
// 実行されるバグの原因になっていた）。ストアで単一の状態を共有し、変更が即座に伝わるようにする。
const STORAGE_KEY = 'mindmeshmap-debug-align-algorithm';
const VALID_ALGORITHMS: AlignAlgorithm[] = ['uniform', 'branch', 'flat-axis', 'sugiyama-ext', 'elk-port', 'elk-port-ext'];

// 既定の整列アルゴリズム。本番ビルドで常に使う値であり、devで保存値が無いときのフォールバックでもある。
// （本番＝dev既定を揃えることで、devで確認する挙動が本番と一致する。docs/align-branch-layout.md参照）
const DEFAULT_ALGORITHM: AlignAlgorithm = 'sugiyama-ext';

function readStoredAlgorithm(): AlignAlgorithm {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (VALID_ALGORITHMS.includes(stored as AlignAlgorithm)) {
      return stored as AlignAlgorithm;
    }
  } catch {
    // localStorageが使えない環境（プライベートモード等）では既定値にフォールバック
  }
  return DEFAULT_ALGORITHM;
}

interface AlignAlgorithmDebugState {
  algorithm: AlignAlgorithm;
  setAlgorithm: (algorithm: AlignAlgorithm) => void;
}

const useAlignAlgorithmStore = create<AlignAlgorithmDebugState>((set) => ({
  // 本番ビルドではlocalStorageを読まず常に既定アルゴリズム（devでのみ保存値を復元）
  algorithm: import.meta.env.DEV ? readStoredAlgorithm() : DEFAULT_ALGORITHM,
  setAlgorithm: (next) => {
    if (!import.meta.env.DEV) return;
    set({ algorithm: next });
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // 保存に失敗しても画面上の切り替えは継続する
    }
  },
}));

export function useAlignAlgorithmDebug(): [AlignAlgorithm, (algorithm: AlignAlgorithm) => void] {
  const algorithm = useAlignAlgorithmStore((s) => s.algorithm);
  const setAlgorithm = useAlignAlgorithmStore((s) => s.setAlgorithm);

  // 本番ビルドではUIの出し分けとは独立に、フック自体でも既定アルゴリズム固定にする（多重ガード）
  if (!import.meta.env.DEV) {
    return [DEFAULT_ALGORITHM, () => {}];
  }

  return [algorithm, setAlgorithm];
}
