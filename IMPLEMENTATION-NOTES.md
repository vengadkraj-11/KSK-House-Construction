# KSK House Construction — implementation and production audit notes

## Active architecture

- Expo / React Native / TypeScript client, Firebase Authentication and Cloud Firestore client SDK.
- Designed for Firebase Spark. No active Firebase Storage, Cloud Functions, paid API, FCM or server-side dependency.
- The `functions/` directory and its lockfile are historical source only. The app does not import it and `firebase.json` has no Functions deployment target. Do not deploy it for this app.
- Android builds use the checked-in Expo configuration and GitHub Actions workflow. The workflow requires the following repository Actions secrets: `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_MESSAGING_SENDER_ID`, and `FIREBASE_APP_ID`. Firebase client configuration values are public app identifiers, not service-account credentials. Do not add a service-account key. `google-services.json` is needed by the current Android Expo configuration.

## Project data, access and recovery

- Workbook sheets remain Firestore documents under `projects/ksk/sheets`; structured contracts, payments, stock, progress, diary, approvals and reminders use their own subcollections.
- The owner can write project data. Both owner and viewer can read workbook sheets, payment and contract records, stock, progress, diary entries, activity and all bill/site-photo attachment documents. Approval and reminder records remain owner-only. User role documents cannot be created or changed from the client; users can only manage their own device subcollection.
- Bill and diary images are compressed JPEG Base64 documents, not Storage uploads. The app caps Base64 data at 450,000 characters; the Firestore 1 MiB document cap still applies to the complete document. Image writes are owner-only and member reads are preserved by rules.
- Owner backup exports every workbook sheet, each structured collection and bill/site-photo attachments associated with workbook rows, payment records or diary records. It uses schema version 1 and a 50 MiB serialized-file cap. Restore validates the format, unique IDs, Base64 image data, and a conservative 900,000-byte serialized-document cap; it uses Firestore transactions, adds only absent document IDs, and reports skipped existing IDs. It never replaces existing cloud documents. Rules remain the authority for writes. User roles, activity history and device-local notification schedules are intentionally excluded.
- When importing a finalized approval that lacks a decision history, the restore is rejected by rules instead of inventing an approval audit. Export that record remains possible; it must be reviewed and recreated through the owner workflow if it needs restoration.

## Finance, inventory and reports

- Each contract stores one agreed amount. Payments reference the contract and have one `advance` or `payment` kind. Balance is `max(0, agreed − advances − payments)`; excess is separately shown as overpayment. Unlinked legacy payments remain visible and are not assigned to a contract balance.
- Stock on hand is `received + returned-to-stock − returned-to-supplier − used − wastage`. Purchase is ordered quantity and does not add stock. Historic `returned` movements are excluded because their destination cannot be established. Rate, supplier and low-stock threshold use the newest dated movement metadata when available.
- XLSX and PDF exports keep historic workbook Daily Expenses and structured payment records in separate sections; they do not add them into a combined expense total. Reports include date/category/person groups, contract balances, stock and progress. A nonempty cloud workbook and all accessible structured records must finish loading before report export is enabled.
- Structured collections are fetched using document-ID pages of 250 so records without timestamps are included. Lists render incrementally; full ledgers, exact summaries, reports and backups still read project collections into device memory. Firestore reads, device memory, JSON size and export time grow with project size and Spark quotas remain applicable.

## Approvals, reminders and limits

- New approvals start pending. Only the owner can make one pending-to-approved/rejected decision; rules limit the changed fields and require decision actor, note, timestamp and appended history. Approval deletion is denied so the audit remains intact. Historical finalized approvals can be restored only if their decision history meets validation rules.
- Reminder records are shared with the owner only. Notification identifiers and schedules live in AsyncStorage and Expo Notifications on each device. Reschedules replace the local schedule, cancellations remove it, and overdue dates are not scheduled. Other project members do not receive cloud notifications. Device permission, OS battery policies, app reinstalls and device availability can affect delivery.
- Site photos use the same bounded Firestore Base64 image path as receipts. There is no cloud image resizing or server processing.
- PDFs are ordinary PDFs, not password-encrypted. Offline conflict resolution, server-side push, role administration inside the app, and very large archive streaming are not implemented.

## Validation commands

```bash
npm run typecheck
npm test
npm run test:rules
npx expo export --platform android
git diff --check
```

An APK additionally requires a configured Android SDK or the GitHub Actions runner. Firestore rules tests use the local Firestore emulator; they do not deploy rules.
