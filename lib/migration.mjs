const ARRAYS = ['menu','cart','sales','orders','expenses','closes','customers','costLog'];
export function previewSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.menu) || !value.ingredients || typeof value.ingredients !== 'object' || Array.isArray(value.ingredients)) throw new Error('invalid_snapshot');
  for (const key of ARRAYS) if (value[key] !== undefined && !Array.isArray(value[key])) throw new Error('invalid_' + key);
  const document = structuredClone(value);
  // Offline account verifiers must never be imported into server data.
  delete document.users; delete document.owner; delete document.staff; delete document.recovery; delete document.password; delete document.passwordHash;
  if (Buffer.byteLength(JSON.stringify(document)) > 3_500_000) throw new Error('invalid_snapshot_too_large');
  const counts = Object.fromEntries(ARRAYS.map(key => [key, document[key]?.length || 0]));
  return { document, counts, dataVersion: String(document.dataVersion || 'unknown') };
}
export function expectedRevision(value) { if (!Number.isSafeInteger(value) || value < 0) throw new Error('invalid_revision'); return value; }
