// Undo/Redo 履歴。設定変更・保持・端点変更を 1 操作とし、解析進捗イベントは入れない。
import { UNDO_LIMIT } from '@shared/constants';

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  limit: number;
}

export function createHistory<T>(present: T, limit: number = UNDO_LIMIT): History<T> {
  return { past: [], present, future: [], limit };
}

export function pushHistory<T>(h: History<T>, next: T): History<T> {
  const past = [...h.past, h.present];
  while (past.length > h.limit) past.shift();
  return { past, present: next, future: [], limit: h.limit };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const past = h.past.slice(0, -1);
  const present = h.past[h.past.length - 1] as T;
  return { past, present, future: [h.present, ...h.future], limit: h.limit };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [present, ...future] = h.future as [T, ...T[]];
  return { past: [...h.past, h.present], present, future, limit: h.limit };
}
