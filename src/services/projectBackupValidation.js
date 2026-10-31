const PROJECT_ID = 'ksk';
const COLLECTIONS = ['contracts', 'payments', 'stock', 'progress', 'diary', 'approvals', 'reminders'];
const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 900_000;

function utf8ByteLength(value) {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) || 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function validateDocs(docs, label) {
  const ids = new Set();
  docs.forEach(item => {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.includes('/') || item.id.length > 1500 || !item.data || typeof item.data !== 'object' || Array.isArray(item.data)) {
      throw new Error(`Invalid document in ${label}.`);
    }
    if (ids.has(item.id)) throw new Error(`Backup contains duplicate document ID ${item.id} in ${label}.`);
    ids.add(item.id);
    if (utf8ByteLength(JSON.stringify(item.data)) > MAX_DOCUMENT_BYTES) throw new Error(`Document ${item.id} exceeds the safe Firestore restore size in ${label}.`);
    if (item.data.imageBase64 !== undefined && (typeof item.data.imageBase64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data.imageBase64) || item.data.imageBase64.length === 0 || item.data.imageBase64.length % 4 !== 0 || item.data.imageBase64.length > 450000)) {
      throw new Error('Backup contains an invalid or oversized image.');
    }
  });
}

function validateProjectBackup(value) {
  if (!value || value.format !== 'ksk-project-backup' || value.schemaVersion !== 1 || value.projectId !== PROJECT_ID) throw new Error('This is not a supported KSK project backup.');
  if (!Array.isArray(value.sheets) || !value.collections || typeof value.collections !== 'object' || !value.attachments || typeof value.attachments !== 'object') throw new Error('Backup sections are missing or invalid.');
  for (const name of COLLECTIONS) if (!Array.isArray(value.collections[name])) throw new Error(`Backup collection ${name} is missing.`);
  validateDocs(value.sheets, 'sheets');
  for (const name of COLLECTIONS) validateDocs(value.collections[name], name);
  for (const [key, docs] of Object.entries(value.attachments)) {
    if (!/^(bills|attachments)\/[A-Za-z0-9_-]+$/.test(key) || !Array.isArray(docs)) throw new Error('Invalid attachment path in backup.');
    validateDocs(docs, `attachments/${key}`);
  }
}

module.exports = {COLLECTIONS, MAX_BACKUP_BYTES, utf8ByteLength, validateProjectBackup};
