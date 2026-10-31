const {onDocumentUpdated} = require('firebase-functions/v2/firestore');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');
const {getMessaging} = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

exports.notifyKskSheetUpdated = onDocumentUpdated(
  'projects/{projectId}/sheets/{sheetId}',
  async event => {
    const after = event.data.after.data();
    const before = event.data.before.data();
    if (!after || !before) return;

    const actorUid = after.updatedBy || '';
    const sheetName = after.name || event.params.sheetId;
    const projectId = event.params.projectId;
    const activityRef = db.collection('projects').doc(projectId).collection('activity').doc();
    await activityRef.set({
      title: `${sheetName} updated`,
      body: 'KSK House construction data has changed.',
      sheetId: event.params.sheetId,
      sheetName,
      actorUid,
      createdAt: FieldValue.serverTimestamp()
    });

    const viewerQuery = await db.collection('users').where('role', '==', 'viewer').get();
    const viewers = viewerQuery.docs.filter(viewer => viewer.data().projectId === projectId);
    const tokens = [];
    for (const viewer of viewers) {
      const deviceSnap = await viewer.ref.collection('devices').where('enabled', '==', true).get();
      deviceSnap.docs.forEach(device => {
        const token = device.data().token;
        if (token && typeof token === 'string') tokens.push(token);
      });
    }
    if (!tokens.length) return;

    const uniqueTokens = [...new Set(tokens)].slice(0, 500);
    const result = await getMessaging().sendEachForMulticast({
      tokens: uniqueTokens,
      notification: {
        title: 'KSK House update',
        body: `${sheetName} was updated. Open KSK House to view the latest figures.`
      },
      data: {projectId, sheetId: event.params.sheetId, actorUid},
      android: {priority: 'high', notification: {channelId: 'construction-updates'}}
    });

    const invalid = [];
    result.responses.forEach((response, index) => {
      if (!response.success && response.error && [
        'messaging/invalid-registration-token',
        'messaging/registration-token-not-registered'
      ].includes(response.error.code)) invalid.push(uniqueTokens[index]);
    });
    if (invalid.length) {
      const batch = db.batch();
      const allUsers = await db.collection('users').get();
      allUsers.docs.forEach(user => {
        invalid.forEach(token => {
          const deviceId = token.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
          batch.delete(user.ref.collection('devices').doc(deviceId));
        });
      });
      await batch.commit();
    }
  }
);
