// S2 間を整える: 映像 8 列 / 設定 4 列、下に全幅の波形、候補一覧(仮想化)、つなぎ目試聴。
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, effectiveEdges, selectCanRedo, selectCanUndo } from '../state/store';
import { SettingsPanel } from '../components/SettingsPanel';
import { Waveform } from '../components/Waveform';
import { CandidateList } from '../components/CandidateList';
import { VideoPreview, type VideoPreviewHandle } from '../components/VideoPreview';
import { JunctionPanel } from '../components/JunctionPanel';
import { Dialog, ErrorCallout, Icon, ProgressBlock } from '../components/common';
import { formatFrameClock, formatFrameTimecode, formatFramesAsSeconds } from '@domain/time';
import { candidateBounds } from '@domain/analysis';
import { MAX_CANDIDATES } from '@shared/constants';

async function invokeCancelFullPreview(): Promise<void> {
  // 進行中の preview ジョブは main 側で replaceKey によって置き換えられるため、ここでは閉じるだけ
  useStore.setState((st) => ({ fullPreview: { ...st.fullPreview, open: false } }));
}

export function EditScreen() {
  const s = useStore();
  const { selected, windows, result, history, selectedCandidateId, reviewed, junction, encoderStatus, edgeWarning, proxy, fullPreview } = s;
  const canUndo = selectCanUndo(s);
  const canRedo = selectCanRedo(s);
  const videoRef = useRef<VideoPreviewHandle>(null);
  const [playhead, setPlayhead] = useState(0);
  const [showList, setShowList] = useState(true);
  const onFrame = useCallback((f: number) => setPlayhead(f), []);

  const cand = result?.candidates.find((c) => c.id === selectedCandidateId) ?? null;
  const edges = cand ? effectiveEdges(cand, history.present) : null;
  const bounds = cand && selected ? candidateBounds(cand, selected.limitFrames) : null;
  const encoderBlocked = encoderStatus ? !encoderStatus.ok : false;

  // 候補選択時に少し手前へシーク
  useEffect(() => {
    if (cand) videoRef.current?.seekFrame(Math.max(0, cand.startFrame - 15));
  }, [selectedCandidateId]); // eslint-disable-line react-hooks/exhaustive-deps

  // キーボード: Ctrl+Z / Shift+Ctrl+Z / Ctrl+Y / Space / ← → / Delete(入力中は奪わない)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      if (useStore.getState().exportState.open) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (e.key === ' ' && tag !== 'BUTTON') {
        e.preventDefault();
        videoRef.current?.togglePlay();
      } else if (e.key === 'ArrowLeft' && !t?.closest('[role="listbox"]') && tag !== 'INPUT') {
        e.preventDefault();
        videoRef.current?.stepFrame(-1);
      } else if (e.key === 'ArrowRight' && !t?.closest('[role="listbox"]') && tag !== 'INPUT') {
        e.preventDefault();
        videoRef.current?.stepFrame(1);
      } else if (e.key === 'Delete' && selectedCandidateId) {
        e.preventDefault();
        s.toggleKeep(selectedCandidateId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s, selectedCandidateId]);

  const set_open_full_preview = () => useStore.setState((st) => ({ fullPreview: { ...st.fullPreview, open: true } }));

  if (!selected || !windows || !result) return null;
  const cuts = result.cutRanges.map((c) => ({ startFrame: c.startFrame, endFrame: c.endFrame }));
  const removed = selected.limitFrames - result.outputFrames;
  const portrait = selected.displayHeight > selected.displayWidth;
  const stateMessage = (() => {
    switch (result.state) {
      case 'all-quiet':
        return { kind: 'warning', text: `判定上はほぼ全体(${Math.round(result.quietRatio * 100)}%)が無音です。別の音声トラックを選ぶか「小さい声を残す」の値を上げてください。この状態では書き出しできません(編集せず、元の動画をそのままお使いください)。` };
      case 'no-candidates':
        return { kind: 'info', text: '詰められる長い間は見つかりませんでした。「検出する長さ」を短くすると候補が増えます。' };
      case 'too-many':
        return { kind: 'warning', text: `カット候補が ${result.tooManyCount} 件あり、上限(${MAX_CANDIDATES})を超えています。「検出する長さ」を長くするか「小さい声を残す」の値を小さくしてください。超過分を黙って捨てることはしません。` };
      case 'too-short-remaining':
        return { kind: 'warning', text: '残る動画が 1 秒未満になります。保持する間を増やしてください。' };
      default:
        return null;
    }
  })();
  const canExport = result.state === 'ok' && cuts.length > 0 && !encoderBlocked;
  const junctionDisabledReason = encoderBlocked ? 'エンコーダーが使えないため試聴用動画を作成できません。' : !cand || cand.status === 'kept' ? '採用中のカット候補を選んでください。' : null;

  return (
    <div className="container edit">
      <div className="row between wrap edit-title">
        <div>
          <input className="title-input" value={s.title} onChange={(e) => s.setTitle(e.target.value)} aria-label="プロジェクト名" maxLength={120} />
          <p className="note">
            {selected.basename} · {selected.displayWidth}×{selected.displayHeight} · {selected.codec.toUpperCase()}
            {selected.limitFrames < selected.totalFrames ? ` · デモ版: 先頭 ${selected.limitFrames / 30} 秒のみ` : ''}
            {s.projectBasename ? ` · 保存: ${s.projectBasename}` : ''}
            {s.dirty ? ' · 未保存の変更' : ''}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn small" onClick={s.undo} disabled={!canUndo} aria-label="元に戻す (Ctrl+Z)">
            ↶ 元に戻す
          </button>
          <button type="button" className="btn small" onClick={s.redo} disabled={!canRedo} aria-label="やり直す (Shift+Ctrl+Z)">
            ↷ やり直す
          </button>
          <button type="button" className="btn small" onClick={() => void s.saveProject(false)}>
            保存
          </button>
        </div>
      </div>

      {encoderStatus && !encoderStatus.ok && (
        <div className="mt-4">
          <ErrorCallout error={{ code: 'E_ENCODER', message: encoderStatus.message, nextAction: 'Windows Update(Media Foundation を含む)を適用して再起動してください。それでも解決しない場合は診断ログを保存して報告してください。', detail: `${encoderStatus.encoderName} / ffmpeg ${encoderStatus.ffmpegVersion}\n${encoderStatus.detail ?? ''}` }} />
        </div>
      )}
      {s.toolsError && (
        <div className="mt-4">
          <ErrorCallout error={s.toolsError} />
        </div>
      )}

      <div className="grid-12 mt-6">
        <div className="col-8 stack tight">
          <VideoPreview ref={videoRef} src={selected.mediaUrl} totalFrames={selected.limitFrames} cuts={cuts} onFrame={onFrame} portrait={portrait} />
          {proxy.status === 'loading' && <p className="note">HEVC の動画のため、プレビュー用の 720p 動画を作成しています。完了すると自動で切り替わります。</p>}
          {proxy.status === 'error' && proxy.error && <ErrorCallout error={proxy.error} onRetry={() => void s.requestProxy()} />}
          <div className="row wrap">
            <button type="button" className="btn small" onClick={() => void s.requestFullPreview()} disabled={encoderBlocked || cuts.length === 0 || fullPreview.status === 'loading'}>
              全体を確定プレビュー(低画質・時間がかかります)
            </button>
            {fullPreview.status === 'stale' && (
              <button type="button" className="btn small ghost" onClick={() => set_open_full_preview()}>
                前回の確定プレビューを開く(設定変更前)
              </button>
            )}
          </div>
        </div>
        <div className="col-4">
          <SettingsPanel settings={history.present.settings} onPreset={s.applyPreset} onChange={s.setSettings} />
        </div>
      </div>

      <hr className="divider" />

      <div className="row between wrap">
        <div className="row" style={{ gap: 16 }}>
          <span className="num-main">
            {formatFrameClock(selected.limitFrames)} → {formatFrameClock(result.outputFrames)}
          </span>
          <span className="note">{formatFramesAsSeconds(removed, 1)} 秒を詰める</span>
        </div>
        <span className="body">{result.candidates.length} か所のカット候補</span>
      </div>
      {stateMessage && (
        <p className={`callout ${stateMessage.kind} mt-3`} role="status">
          {stateMessage.text}
        </p>
      )}
      {result.droppedManualCuts.length > 0 && <p className="callout info mt-3">再解析で無音区間の外に出た手動の延長 {result.droppedManualCuts.length} 件を外しました(取り消しで戻せます)。</p>}
      {history.present.keeps.length > 0 && (
        <p className="note mt-2">
          手動保持 {history.present.keeps.filter((k) => k.reason === 'user-keep').length} 件・端点調整 {history.present.keeps.filter((k) => k.reason === 'edge-adjust').length + history.present.manualCuts.length} 件は再解析後も元のフレーム区間として残ります。
          <button type="button" className="btn ghost small" onClick={s.resetKeeps} style={{ marginLeft: 8 }}>
            手動保持もリセット(取り消し可)
          </button>
        </p>
      )}

      <div className="mt-4">
        <Waveform windowDb={windows.windowDb} totalFrames={selected.limitFrames} candidates={result.candidates} selectedId={selectedCandidateId} playheadFrame={playhead} onSeek={(f) => videoRef.current?.seekFrame(f)} onSelect={s.selectCandidate} />
      </div>

      <div className="grid-12 mt-6">
        <div className="col-8 stack">
          <div className="row between">
            <h2 className="heading-sm">
              {cand ? `選択中 ${formatFrameTimecode(edges!.startFrame)} – ${formatFrameTimecode(edges!.endFrame)} / ${formatFramesAsSeconds(cand.removedFrames)}秒をカット` : '候補を選んでください'}
            </h2>
            {cand && (
              <button type="button" className="btn" onClick={() => s.toggleKeep(cand.id)}>
                <Icon name="restore" />
                {cand.status === 'kept' ? '再び詰める' : 'この間を残す'}
              </button>
            )}
          </div>
          {cand && bounds && edges && cand.status !== 'kept' && (
            <div className="edge-adjust surface panel">
              <div className="row between wrap">
                <div className="row">
                  <span className="label-mono">開始</span>
                  <button type="button" className="btn small" onClick={() => s.adjustEdge(cand.id, 'start', -1)} disabled={edges.startFrame <= bounds.startFrame} aria-label="開始を 1 フレーム早く(無音区間内)">
                    ◀ 1f
                  </button>
                  <span className="num">{formatFrameTimecode(edges.startFrame)}</span>
                  <button type="button" className="btn small" onClick={() => s.adjustEdge(cand.id, 'start', 1)} disabled={edges.startFrame >= edges.endFrame - 1} aria-label="開始を 1 フレーム遅く">
                    1f ▶
                  </button>
                </div>
                <div className="row">
                  <span className="label-mono">終了</span>
                  <button type="button" className="btn small" onClick={() => s.adjustEdge(cand.id, 'end', -1)} disabled={edges.endFrame <= edges.startFrame + 1} aria-label="終了を 1 フレーム早く">
                    ◀ 1f
                  </button>
                  <span className="num">{formatFrameTimecode(edges.endFrame)}</span>
                  <button type="button" className="btn small" onClick={() => s.adjustEdge(cand.id, 'end', 1)} disabled={edges.endFrame >= bounds.endFrame} aria-label="終了を 1 フレーム遅く(無音区間内)">
                    1f ▶
                  </button>
                </div>
              </div>
              <p className="note mt-2">端点は元の無音区間({formatFrameTimecode(bounds.startFrame)}–{formatFrameTimecode(bounds.endFrame)})の中だけで動かせます。</p>
              {edgeWarning && (
                <p className="callout warning mt-2" role="status">
                  {edgeWarning}
                </p>
              )}
            </div>
          )}
          <JunctionPanel state={junction} onGenerate={() => void s.requestJunction()} canGenerate={!junctionDisabledReason && junction.status !== 'loading'} disabledReason={junctionDisabledReason} />
        </div>
        <div className="col-4 stack">
          <div className="row between">
            <h2 className="heading-sm">カット候補</h2>
            <button type="button" className="btn ghost small" onClick={() => setShowList((v) => !v)} aria-expanded={showList}>
              {showList ? '閉じる' : '開く'}
            </button>
          </div>
          {showList && <CandidateList candidates={result.candidates} selectedId={selectedCandidateId} reviewed={reviewed} onSelect={s.selectCandidate} onToggleKeep={s.toggleKeep} />}
          <div className="row wrap">
            <button type="button" className="btn small" onClick={() => void s.exportCuts('csv')} disabled={result.cutRanges.length === 0}>
              カット範囲を CSV で保存
            </button>
            <button type="button" className="btn small" onClick={() => void s.exportCuts('json')} disabled={result.cutRanges.length === 0}>
              JSON で保存
            </button>
          </div>
          <p className="note">
            ショートカット: <span className="kbd">Space</span> 再生 / <span className="kbd">←</span>
            <span className="kbd">→</span> 1 フレーム / <span className="kbd">Delete</span> 採用・保持の切替 / <span className="kbd">Ctrl+Z</span> 元に戻す
          </p>
        </div>
      </div>

      {fullPreview.open && (
        <Dialog title={fullPreview.status === 'stale' ? '全体の確定プレビュー(設定変更前の内容)' : '全体の確定プレビュー'} onClose={s.closeFullPreview}>
          <div className="stack">
            <p className="note">書き出しと同じ方法で作成した低画質版です。つなぎ目の精度は本番と同じですが、画質・ビットレートは本番より低くなります。</p>
            {fullPreview.status === 'loading' && fullPreview.progress && (
              <ProgressBlock stage={fullPreview.progress.stage} ratio={fullPreview.progress.ratio} onCancel={() => void invokeCancelFullPreview()} />
            )}
            {fullPreview.status === 'error' && fullPreview.error && <ErrorCallout error={fullPreview.error} onRetry={() => void s.requestFullPreview()} />}
            {fullPreview.status === 'stale' && <p className="callout warning">設定または保持が変わったため、このプレビューは古くなっています。</p>}
            {(fullPreview.status === 'ready' || fullPreview.status === 'stale') && fullPreview.mediaUrl && <video src={fullPreview.mediaUrl} controls preload="auto" style={{ width: '100%', background: 'var(--ink)', borderRadius: 8 }} aria-label="全体の確定プレビュー" />}
            <div className="row between">
              <button type="button" className="btn ghost" onClick={s.closeFullPreview}>
                閉じる
              </button>
              {fullPreview.status === 'stale' && (
                <button type="button" className="btn dark" onClick={() => void s.requestFullPreview()}>
                  作り直す
                </button>
              )}
            </div>
          </div>
        </Dialog>
      )}

      <div className="actionbar">
        <div className="container row between">
          <span className="note">元の動画は変更しません。</span>
          <button type="button" className="btn primary" onClick={s.openExport} disabled={!canExport} aria-describedby={!canExport ? 'export-why' : undefined}>
            <Icon name="export" />
            動画を書き出す
          </button>
        </div>
        {!canExport && (
          <span className="sr-only" id="export-why">
            {encoderBlocked ? 'エンコーダーが使えないため書き出せません。' : cuts.length === 0 ? '削除する区間がありません。' : '現在の状態では書き出せません。'}
          </span>
        )}
      </div>
    </div>
  );
}
