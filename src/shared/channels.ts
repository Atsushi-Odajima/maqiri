// IPC チャンネル名の一覧(zod を含まない)。preload はこれだけを参照して許可リストにする。
export const IPC_CHANNELS = [
  'source:pick',
  'source:useSample',
  'source:probe',
  'source:hash',
  'source:selectAudio',
  'analysis:start',
  'job:cancel',
  'junction:generate',
  'preview:render',
  'export:pickDestination',
  'export:start',
  'export:openResult',
  'project:save',
  'project:open',
  'project:relink',
  'project:listRecent',
  'project:exportCuts',
  'app:getInfo',
  'app:openHelp',
  'cache:clear',
  'cache:info',
  'diagnostics:read',
  'settings:get',
  'settings:set',
  'recovery:list',
  'recovery:resolve'
] as const;
export type IpcChannelName = (typeof IPC_CHANNELS)[number];
export const EVENT_CHANNEL = 'maqiri:event';
