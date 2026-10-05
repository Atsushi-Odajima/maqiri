import type { MaqiriApi } from './index';

declare global {
  interface Window {
    maqiri: MaqiriApi;
  }
}

export {};
