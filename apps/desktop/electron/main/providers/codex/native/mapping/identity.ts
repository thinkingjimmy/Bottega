/**
 * [INPUT]: Uses product request identity, native item identity and optional child thread scope.
 * [OUTPUT]: Exports nativeCommandItemId for stable command ownership across turns and parent/child execution scopes.
 * [POS]: Pure identity shared by native event mapping and retained execution projection.
 */
export const nativeCommandItemId = (requestId: string, itemId: string, childThreadId?: string) => childThreadId
  ? `${requestId}:child:${encodeURIComponent(childThreadId)}:${encodeURIComponent(itemId)}`
  : `${requestId}:parent:${encodeURIComponent(itemId)}`;
