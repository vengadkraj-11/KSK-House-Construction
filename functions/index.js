const {randomUUID, createHash} = require('crypto');
const {onDocumentUpdated} = require('firebase-functions/v2/firestore');
const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue, Timestamp} = require('firebase-admin/firestore');
const {getMessaging} = require('firebase-admin/messaging');

initializeApp();

const db = getFirestore();

function decodeRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];

  return Object.keys(value)
    .sort((a, b) => Number(a) - Number(b))
    .map(key => value[key] || []);
}

function clean(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function getRowLabel(row, headers) {
  const preferred = [
    'Item / Description',
    'Material / Item',
    'Labour / Contractor Work',
    'Service / Fee Head',
    'Construction Activity',
    'Expense Category',
    'Vendor / Person',
    'Item / Material',
    'Work ID',
    'Fee ID',
    'Activity ID',
    'S.No.'
  ];

  for (const heading of preferred) {
    const index = headers.findIndex(
      h => String(h || '').trim() === heading
    );
    if (index >= 0 && row[index] !== undefined && row[index] !== '') {
      return clean(row[index]);
    }
  }

  return clean(row.find(v => v !== null && v !== undefined && v !== ''));
}


function compareRows(before, after, sheetId) {
  const oldRows = decodeRows(before.values);
  const newRows = decodeRows(after.values);
  const headers = newRows[0] || oldRows[0] || [];
  const changes = [];

  const idHeaders = [
    'Work ID', 'Fee ID', 'Activity ID', 'S.No.',
    'Bill / Voucher No.'
  ];

  const labelHeaders = [
    'Item / Description',
    'Material / Item',
    'Labour / Contractor Work',
    'Service / Fee Head',
    'Construction Activity',
    'Expense Category',
    'Vendor / Person',
    'Item / Material'
  ];

  const headerIndex = name =>
    headers.findIndex(h => String(h || '').trim() === name);

  function identity(row) {
    for (const name of idHeaders) {
      const i = headerIndex(name);
      if (i >= 0 && row[i] !== null && row[i] !== undefined && row[i] !== '') {
        return `${name}:${String(row[i]).trim()}`;
      }
    }

    const labelName = labelHeaders.find(name => {
      const i = headerIndex(name);
      return i >= 0 && row[i] !== null && row[i] !== undefined && row[i] !== '';
    });

    if (labelName) {
      const parts = [];
      for (const name of ['Date', 'Floor / Area', 'Work Stage', labelName, 'Vendor / Person']) {
        const i = headerIndex(name);
        if (i >= 0 && row[i] !== null && row[i] !== undefined && row[i] !== '') {
          parts.push(`${name}:${String(row[i]).trim()}`);
        }
      }
      return parts.join('|');
    }

    return null;
  }

  function rowLabel(row) {
    for (const name of labelHeaders.concat(idHeaders)) {
      const i = headerIndex(name);
      if (i >= 0 && row[i] !== null && row[i] !== undefined && row[i] !== '') {
        return clean(row[i]);
      }
    }
    return clean(row.find(v => v !== null && v !== undefined && v !== ''));
  }

  function rowDetails(row) {
    return row.map((value, index) => {
      if (value === null || value === undefined || value === '') return null;
      return `${headers[index] || `Column ${index + 1}`}: ${clean(value)}`;
    }).filter(Boolean).slice(0, 4).join('; ');
  }

  const oldEntries = oldRows.slice(1)
    .filter(row => row && row.some(v => v !== null && v !== undefined && v !== ''))
    .map((row, index) => ({row, index, matched: false}));

  const newEntries = newRows.slice(1)
    .filter(row => row && row.some(v => v !== null && v !== undefined && v !== ''))
    .map((row, index) => ({row, index, matched: false}));

  // First match identical rows, preserving duplicate records.
  const exactOld = new Map();

  oldEntries.forEach(entry => {
    const signature = JSON.stringify(entry.row);
    if (!exactOld.has(signature)) exactOld.set(signature, []);
    exactOld.get(signature).push(entry);
  });

  newEntries.forEach(entry => {
    const signature = JSON.stringify(entry.row);
    const candidates = exactOld.get(signature);
    if (candidates && candidates.length) {
      candidates.shift().matched = true;
      entry.matched = true;
    }
  });

  // Match remaining records by stable IDs or identifying fields.
  const oldByIdentity = new Map();
  const newByIdentity = new Map();

  function groupByIdentity(entries, groups) {
    entries.filter(entry => !entry.matched).forEach(entry => {
      const key = identity(entry.row);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
  }

  groupByIdentity(oldEntries, oldByIdentity);
  groupByIdentity(newEntries, newByIdentity);

  for (const [key, oldGroup] of oldByIdentity) {
    const newGroup = newByIdentity.get(key);
    if (!newGroup) continue;

    const count = Math.min(oldGroup.length, newGroup.length);

    for (let i = 0; i < count; i++) {
      const oldEntry = oldGroup[i];
      const newEntry = newGroup[i];

      oldEntry.matched = true;
      newEntry.matched = true;

      const differences = [];

      headers.forEach((header, index) => {
        const oldValue = clean(oldEntry.row[index]);
        const newValue = clean(newEntry.row[index]);

        if (oldValue !== newValue) {
          differences.push(`${header || `Column ${index + 1}`}: ${oldValue} → ${newValue}`);
        }
      });

      if (differences.length) {
        changes.push({
          type: 'edited',
          label: rowLabel(newEntry.row),
          details: differences.slice(0, 5).join('; ')
        });
      }
    }
  }

  // Anything still unmatched is genuinely an addition or deletion.
  newEntries.filter(entry => !entry.matched).forEach(entry => {
    changes.push({
      type: 'added',
      label: rowLabel(entry.row),
      details: rowDetails(entry.row)
    });
  });

  oldEntries.filter(entry => !entry.matched).forEach(entry => {
    changes.push({
      type: 'deleted',
      label: rowLabel(entry.row),
      details: rowDetails(entry.row)
    });
  });

  return changes;
}


async function getViewerDevices(projectId, actorUid) {
  const users = await db.collection('users')
    .where('role', '==', 'viewer')
    .get();

  const byToken = new Map();

  for (const user of users.docs) {
    const data = user.data();

    if (data.projectId !== projectId || user.id === actorUid) continue;

    const devices = await user.ref.collection('devices')
      .where('enabled', '==', true)
      .get();

    for (const device of devices.docs) {
      const token = device.data().token;

      if (typeof token !== 'string' || !token.trim()) continue;

      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token).push(device.ref);
    }
  }

  return [...byToken.entries()].map(([token, refs]) => ({
    token,
    refs
  }));
}

async function disableInvalidDevices(devices) {
  const refs = devices.flatMap(device => device.refs || []);

  for (let i = 0; i < refs.length; i += 450) {
    const batch = db.batch();

    refs.slice(i, i + 450).forEach(ref => {
      batch.update(ref, {
        enabled: false,
        disabledReason: 'invalid-fcm-token',
        updatedAt: FieldValue.serverTimestamp()
      });
    });

    await batch.commit();
  }
}

exports.notifyKskSheetUpdated = onDocumentUpdated(
  {
    document: 'projects/{projectId}/sheets/{sheetId}',
    region: 'asia-south1',
    retry: true
  },
  async event => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();

    if (!before || !after) return;

    const projectId = event.params.projectId;
    const sheetId = event.params.sheetId;

    // This is the Firestore project namespace used by the app.
    if (projectId !== 'ksk') return;

    const actorUid = after.updatedBy || '';

    if (JSON.stringify(before.values) === JSON.stringify(after.values)) {
      return;
    }

    const changes = compareRows(before, after, sheetId);
    if (!changes.length) return;

    // Cloud Functions event IDs remain stable across retries.
    const eventId = String(event.id || '');
    if (!eventId) {
      throw new Error('Missing event ID; cannot safely identify notification event.');
    }

    const eventKey = createHash('sha256')
      .update(eventId)
      .digest('hex');

    const eventRef = db.collection('projects')
      .doc(projectId)
      .collection('notificationEvents')
      .doc(eventKey);

    const lockId = randomUUID();

    // Claim this event transactionally. A completed event is never
    // intentionally processed again. Stale processing claims can recover.
    const claimed = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(eventRef);

      if (snapshot.exists) {
        const data = snapshot.data();

        if (data.status === 'completed') return false;

        if (data.status === 'processing') {
          const startedAt = data.startedAt;
          const age = startedAt?.toMillis
            ? Date.now() - startedAt.toMillis()
            : 0;

          if (age >= 0 && age < 10 * 60 * 1000) {
            return false;
          }
        }
      }

      transaction.set(eventRef, {
        status: 'processing',
        lockId,
        startedAt: Timestamp.now(),
        sheetId,
        updatedAt: FieldValue.serverTimestamp()
      }, {merge: true});

      return true;
    });

    if (!claimed) return;

    try {
      const sheetName = after.name || sheetId;

      const actorDoc = actorUid
        ? await db.collection('users').doc(actorUid).get()
        : null;

      const actorData = actorDoc?.exists ? actorDoc.data() : {};

      const actorName =
        actorData?.displayName ||
        actorData?.name ||
        'Project owner';

      const activityCollection = db.collection('projects')
        .doc(projectId)
        .collection('activity');

      // Stable IDs make activity writes idempotent across retries.
      const activityBatch = db.batch();
      const notificationItems = changes.slice(0, 20);

      notificationItems.forEach((change, index) => {
        const activityRef = activityCollection.doc(
          `${eventKey}_${index}`
        );

        activityBatch.set(activityRef, {
          title: `${change.type.toUpperCase()}: ${change.label}`,
          body: `${sheetName} — ${change.details || change.label}`,
          sheetId,
          sheetName,
          actorUid,
          actorName,
          changeType: change.type,
          itemName: change.label,
          details: change.details || '',
          eventKey,
          createdAt: FieldValue.serverTimestamp()
        }, {merge: true});
      });

      await activityBatch.commit();

      const devices = await getViewerDevices(projectId, actorUid);

      if (devices.length) {
        const firstChange = changes[0];

        const summary = changes.length === 1
          ? `${firstChange.type.toUpperCase()}: ${firstChange.label} — ${firstChange.details}`
          : `${changes.length} changes in ${sheetName}. First: ${firstChange.type.toUpperCase()} ${firstChange.label} — ${firstChange.details}`;

        // FCM multicast supports a maximum of 500 tokens per request.
        for (let i = 0; i < devices.length; i += 500) {
          const group = devices.slice(i, i + 500);
          const tokens = group.map(device => device.token);

          const result = await getMessaging().sendEachForMulticast({
            tokens,
            notification: {
              title: `KSK House: ${sheetName}`,
              body: summary.slice(0, 200)
            },
            data: {
              projectId,
              sheetId,
              actorUid,
              sheetName,
              changeCount: String(changes.length)
            },
            android: {
              priority: 'high',
              notification: {
                channelId: 'construction-updates'
              }
            }
          });

          const invalidDevices = [];

          result.responses.forEach((response, index) => {
            if (response.success) return;

            const code = response.error?.code;

            if (
              code === 'messaging/invalid-registration-token' ||
              code === 'messaging/registration-token-not-registered'
            ) {
              invalidDevices.push(group[index]);
            }
          });

          if (invalidDevices.length) {
            await disableInvalidDevices(invalidDevices);
          }

          // A partial or complete batch failure must be retried.
          if (result.failureCount > 0) {
            const failures = result.responses
              .filter(response => !response.success)
              .map(response => response.error?.code || 'unknown-error');

            console.error('FCM delivery failures:', failures);

            const nonInvalidFailures = result.responses.some(response => {
              if (response.success) return false;
              const code = response.error?.code;

              return code !== 'messaging/invalid-registration-token' &&
                code !== 'messaging/registration-token-not-registered';
            });

            if (nonInvalidFailures) {
              throw new Error('One or more FCM notifications could not be sent.');
            }
          }
        }
      }

      await eventRef.update({
        status: 'completed',
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lockId: FieldValue.delete()
      });

    } catch (error) {
      console.error('KSK notification processing failed:', error);

      // Mark the event failed only if this execution still owns the claim.
      // Firebase retry can then reclaim it.
      await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(eventRef);

        if (snapshot.exists && snapshot.data().lockId === lockId) {
          transaction.set(eventRef, {
            status: 'failed',
            lastError: String(error?.message || error).slice(0, 1000),
            failedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            lockId: FieldValue.delete()
          }, {merge: true});
        }
      });

      throw error;
    }
  }
);


// Owner-only clearing of the activity log.
// The Admin SDK bypasses client Firestore rules, so authorization is checked here.
exports.clearKskActivityHistory = onCall(
  {region: 'asia-south1'},
  async request => {
    const uid = request.auth?.uid;

    if (!uid) {
      throw new HttpsError('unauthenticated', 'Please sign in first.');
    }

    const projectId = request.data?.projectId;

    if (projectId !== 'ksk') {
      throw new HttpsError('invalid-argument', 'Invalid project.');
    }

    const memberSnapshot = await db.collection('users').doc(uid).get();

    if (!memberSnapshot.exists) {
      throw new HttpsError('permission-denied', 'Project membership was not found.');
    }

    const member = memberSnapshot.data();

    if (member.projectId !== projectId || member.role !== 'owner') {
      throw new HttpsError('permission-denied', 'Only the project owner can clear activity history.');
    }

    const activityCollection = db.collection('projects')
      .doc(projectId)
      .collection('activity');

    let deletedCount = 0;

    // Repeatedly delete the first page so the operation supports collections
    // larger than Firestore's 500-write batch limit.
    while (true) {
      const snapshot = await activityCollection.limit(450).get();

      if (snapshot.empty) break;

      const batch = db.batch();

      snapshot.docs.forEach(document => {
        batch.delete(document.ref);
      });

      await batch.commit();
      deletedCount += snapshot.size;
    }

    return {deletedCount};
  }
);
