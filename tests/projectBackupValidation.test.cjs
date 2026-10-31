const test = require('node:test');
const assert = require('node:assert/strict');
const {COLLECTIONS, MAX_BACKUP_BYTES, utf8ByteLength, validateProjectBackup} = require('../src/services/projectBackupValidation.js');

function validBackup() {
  return {
    format:'ksk-project-backup', schemaVersion:1, projectId:'ksk', createdAt:'2026-10-31T00:00:00.000Z',
    sheets:[{id:'daily_expenses',data:{values:{0:['Date']}}}],
    collections:Object.fromEntries(COLLECTIONS.map(name=>[name,[]])),
    attachments:{'bills/payment-1':[{id:'receipt-1',data:{recordId:'payment-1',imageBase64:'YWJj'}}]}
  };
}

test('backup validation accepts all required sections and bounded image attachments',()=>{
  assert.doesNotThrow(()=>validateProjectBackup(validBackup()));
  assert.equal(utf8ByteLength('KSK 🏠'),8);
  assert.equal(MAX_BACKUP_BYTES,50*1024*1024);
});

test('backup validation rejects unsupported schema, duplicate IDs, unsafe paths, and oversized images',()=>{
  const wrongVersion=validBackup(); wrongVersion.schemaVersion=99;
  assert.throws(()=>validateProjectBackup(wrongVersion),/supported KSK/);
  const duplicate=validBackup(); duplicate.sheets.push({...duplicate.sheets[0]});
  assert.throws(()=>validateProjectBackup(duplicate),/duplicate document ID/);
  const badPath=validBackup(); badPath.attachments['bills/../escape']=[];
  assert.throws(()=>validateProjectBackup(badPath),/attachment path/);
  const largeImage=validBackup(); largeImage.attachments['bills/payment-1'][0].data.imageBase64='A'.repeat(450001);
  assert.throws(()=>validateProjectBackup(largeImage),/oversized image/);
});

test('backup validation rejects any document too large for safe Firestore restore',()=>{
  const oversized=validBackup();
  oversized.collections.payments.push({id:'big-payment',data:{notes:'x'.repeat(900_001)}});
  assert.throws(()=>validateProjectBackup(oversized),/safe Firestore restore size/);
});
