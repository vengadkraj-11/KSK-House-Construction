# Historical Cloud Functions (not used by the Spark app)

This directory is retained for reference only. The Expo client does not import or call these functions, and `firebase.json` does not configure a Functions deployment target. The active app uses Firebase Auth, Firestore, and device-local notifications; it does not require FCM, Cloud Functions, or the Blaze plan.

Do not run `firebase deploy --only functions` for the Spark-only application. Cross-device background notifications are not supported by this app.
