import { useStore } from '../state/store';
import { Dialog } from '../components/common';

export function RecoveryDialog() {
  const { recovery, resolveRecovery } = useStore();
  if (recovery.length === 0) return null;
  return (
    <Dialog title="保存途中のプロジェクトが見つかりました">
      <p className="body">前回、保存が完了しなかったプロジェクトがあります。復元すると現在の保存版は .bak として残します。元へ無断で上書きはしません。</p>
      <ul className="stack mt-4" style={{ listStyle: 'none', padding: 0 }}>
        {recovery.map((r) => (
          <li key={r.recoveryToken} className="row between surface panel">
            <span>
              <strong>{r.title ?? '(名称不明)'}</strong>
              <span className="note" style={{ marginLeft: 8 }}>
                {new Date(r.modifiedAt).toLocaleString('ja-JP')}
              </span>
            </span>
            <span className="row">
              <button type="button" className="btn small" onClick={() => void resolveRecovery(r.recoveryToken, 'restore')}>
                復元
              </button>
              <button type="button" className="btn small ghost" onClick={() => void resolveRecovery(r.recoveryToken, 'discard')}>
                破棄
              </button>
            </span>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
