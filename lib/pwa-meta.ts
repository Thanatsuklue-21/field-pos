export const FIELD_APP_VERSION="8.0.0-pwa.8";
export const FIELD_SW_URL="/sw.js";
export const PWA_STATUS_EVENT="field:pwa-status";
export const PWA_REFRESH_EVENT="field:pwa-refresh";
export const PWA_INSTALL_REQUEST_EVENT="field:pwa-install-request";
export const PWA_UPDATE_REQUEST_EVENT="field:pwa-update-request";
export const PWA_PERSIST_STORAGE_REQUEST_EVENT="field:pwa-persist-storage-request";
export type PwaSnapshot={appVersion:string;installed:boolean;installable:boolean;serviceWorkerSupported:boolean;serviceWorkerActive:boolean;updateAvailable:boolean;indexedDbReady:boolean;cacheReady:boolean;outboxPending:number;outboxNeedsReview:number;recoveryCartItems:number;recoveryHeldBills:number;recoveryPromptPay:boolean;recoveryCash:boolean;recoverySplit:boolean;recoveryEditCash:boolean;storagePersistenceSupported:boolean;storagePersisted:boolean|null;storageUsage:number|null;storageQuota:number|null;online:boolean;displayMode:"standalone"|"browser";lastChecked:number};
