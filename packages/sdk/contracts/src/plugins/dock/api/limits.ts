/**
 * [INPUT]: Depends on the approved bounded direct-HTTPS implementation scope.
 * [OUTPUT]: Provides finite API admission, transport, scheduler and projection limits.
 * [POS]: Shared implementation defaults; public fault and physical-device acceptance remain separate gates.
 */
export const DOCK_API_BUDGET=Object.freeze({
 apiDeclarationCount:8,apiRefreshRequests:16,apiRequestBytes:16*1024,apiHeaderBytes:64*1024,
 apiResponseBytes:1024*1024,apiJsonDepth:16,apiDeadlineMs:15000,apiMinimumIntervalMs:60000,
 apiConcurrentRequests:Object.freeze({owner:2,origin:4,global:8}),apiRedirectCount:3,apiRetryCount:1,apiRetryWindowMs:1000,
 fields:16,records:50,points:64,queue:64,cacheEntries:128,secretBytes:8192,
});
