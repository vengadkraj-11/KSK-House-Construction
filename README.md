# KSK House Construction — Android and Firebase Hosting

A mobile project manager for the KSK G+1 house build, based on the uploaded `KSK_House_Cost.xlsx` workbook.

## What's included

- All **11 original workbook tabs**: Project Dashboard, Project Setup, Detailed Material List Ground, Detailed Material List First, Materials & BOQ, Labour & Work, Professional Fees, Misc & Equipment, Daily Expenses, Work Schedule, and Floor Summary.
- The original Excel workbook is included unchanged at `assets/KSK_House_Cost.xlsx`.
- The imported workbook data and cell formula strings are included at `assets/ksk_workbook.json`. The app keeps each sheet's formula grid when saving a sheet to Firestore, and recalculates the formula-driven budget/summary values for display.
- Live dashboard for estimate, paid-to-date, remaining budget, contingency and construction progress.
- Editable row forms for the owner, including expenses, material receipts, professional fees, equipment, labour and work progress.
- Read-only mode for the father's viewer account.
- A dedicated English/Tamil family portal at `/family`, with browser-persisted accounts and owner approval/revocation.
- Viewer membership and attachment permissions enforced by Firestore Security Rules.
- Firestore live listeners, Firestore security rules, an activity feed, local device notifications, and structured payment, stock, progress, diary, approval, and reminder records.
- A separate **Quotation Compare** module. It is additional to the 11 workbook tabs because the original dashboard mentions this feature, but the uploaded workbook does not contain a Quotation Compare worksheet.

## Current connection status

This package is the Android and browser app source project. It uses the existing `ksk-house-construction` Firebase project and Firebase Hosting site. Cloud sync is active when the `EXPO_PUBLIC_FIREBASE_*` settings are present; otherwise the app displays bundled workbook data in local preview mode.

## Website access

The owner app remains at the website root. Family viewers use the dedicated **Family viewer** link or open:

```text
https://ksk-house-construction.web.app/family
```

Family registration asks only for a name and mobile number. It creates a pending request for the owner to approve under Settings → **Viewer access management**. An approved member's browser session is saved so they can return without another approval. A phone number is not an authentication factor: on a fresh device, the member must request recovery and the owner must verify their identity before access is restored. No SMS OTP, paid services, or Cloud Functions are used. Owners continue to use their existing Firebase Authentication account and provider.

For local development, set the existing Firebase web client values in `.env` and run `npm run web`. These client identifiers are not service-account credentials. Do not put private keys or passwords in `.env`.

Firebase Authentication → Settings → Authorized domains must include the website host. The existing `ksk-house-construction.web.app` and Firebase Auth domains are configured for this project.

Browser exports download XLSX, JSON and image files directly. PDF actions open a print view; choose **Save to PDF** in the browser print dialog. Image attachments can be selected from the browser file picker; camera capture and device notifications/reminders remain Android-only. Family viewer sign-in requires Firebase's persistent browser storage; the portal fails closed rather than falling back to an in-memory session.

## Free-plan architecture and limits

The app uses Firebase Authentication and Cloud Firestore client SDK only and is designed to run on the Firebase Spark plan. It does not require Storage, Cloud Functions, paid APIs, or server-side code. Firestore and Authentication remain subject to Google's current Spark quotas and availability limits. Local notifications are scheduled on the individual device; they do not notify other project members. Cross-device, background push notifications require a separately operated push service and are not included in the free-plan app.

The `functions/` folder contains historical notification code retained for source compatibility only; the app does not call or require it. Do not deploy it as part of the Spark setup.

Bill and site diary images are compressed JPEG Base64 documents in Firestore, not Firebase Storage. Firestore has a 1 MiB document limit; the app caps each image payload at 450,000 Base64 characters and filenames at 200 characters to leave room for document metadata. Large or numerous images consume Firestore document storage and read quota. All project members with owner or viewer roles can read receipt and diary images; only the owner can add, replace, or delete them.

## Firebase setup

### 1. Create a Firebase project

1. Create a Firebase project (a South India region such as `asia-south1` is a sensible choice for this project).
2. Add an Android app with package name `com.ksk.houseconstruction`.
3. Download its `google-services.json` and place it in the project root beside `app.json`.
4. In Firebase Authentication, retain the existing owner provider (for example, Email/Password). Family viewers use persistent anonymous browser sessions; phone numbers are contact details only.
5. Create or retain the owner sign-in account.
6. Create a Cloud Firestore database.

The Firebase web app configuration is also needed by the Firebase JavaScript SDK. Set the `EXPO_PUBLIC_FIREBASE_*` values in a local `.env` file. These client configuration values are identifiers, not administrator secrets. Never put a service-account private key in `.env` or in the mobile app. Email/Password Authentication and Firestore require no paid SMS OTP or Blaze plan. No Firebase Storage bucket setting is used.

### 2. Assign the owner role

In Firebase Console → Authentication, copy the owner's UID. In Firestore, retain or create the owner membership:

- Collection: `users`, document ID: **owner UID**, fields: `role` = `owner`, `projectId` = `ksk`

Keep existing viewer membership documents unchanged. New family accounts register at `/family`; requests are bound to their authenticated Firebase UID, and only the owner can approve, reject, or revoke access. Owner-created approved invitations require the member to establish a secure session and complete owner-verified recovery before they can view data. A viewer cannot edit their role or approval status. A typed mobile number never identifies or authenticates an account.

### 3. Deploy Firestore security rules

Install the Firebase CLI and sign in to the same Firebase project:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules,hosting --project ksk-house-construction
```

The rules preserve existing KSK owner/viewer access. New viewers require an approved `viewerAccess/{uid}` record tied to the authenticated UID. Viewers can read authorized KSK records and bill/receipt attachments but cannot create, update, or delete project records or attachments. Approval data and owner management remain owner-only.

### 4. Build the Android APK

Use Node.js 22.13+ and the local Android SDK. From this project folder:

```bash
npm install
cp .env.example .env
# Fill in the Firebase web app configuration in .env
npx expo install --fix
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

The release APK is written under `android/app/build/outputs/apk/release/`. The build needs the existing `google-services.json` and Firebase web client environment values. No Firebase service-account key or Storage bucket is required.

The app's notifications are local to the device. They do not require FCM tokens or a Cloud Function and do not notify a second phone.

### 5. First cloud import

1. Sign in on your phone with the account assigned `owner`.
2. Open Settings → Cloud workbook → **Import workbook to cloud**.
3. The app copies all 11 sheets into `projects/ksk/sheets` and creates the extra Quotation Compare document.
4. Family members register at `/family` and wait for owner approval before viewing project data.

The import button refuses to overwrite a non-empty cloud workbook. This avoids replacing any existing cloud edits accidentally.

## Sheet behaviour

| Workbook sheet | App functionality |
|---|---|
| Project Dashboard | Live budget, actual paid, balance, contingency and cost summary |
| Project Setup | Owner-editable project dimensions, dates, contingency and construction choices |
| Detailed Material List Ground | Ground-floor item catalogue, quantities, rates, wastage, supplier and receiving fields |
| Detailed Material List First | First-floor item catalogue with the same material planning fields |
| Materials & BOQ | Main purchase register, quantities received, balances, supplier and actual amount |
| Labour & Work | Planned work quantities, rates, contractors, paid amounts and balances |
| Professional Fees | Architect/engineer/approval fees, payment details and remaining balances |
| Misc & Equipment | Hire, transport, utility, septic, compound wall, gate and other external cost items |
| Daily Expenses | Date-wise payments, voucher, category, payee, payment mode and bill status |
| Work Schedule | Construction activity, dates, status, percentage complete, cost and delays |
| Floor Summary | Recalculated Ground Floor, First Floor and Common/External cost totals |
| Quotation Compare (extra) | Compare supplier quotes side by side; not in the original XLSX |

## Important notes

- The original workbook is kept intact in the app assets. Firebase stores an editable data copy, not a rewritten XLSX file. Spreadsheet formulas are retained as formula strings in each Firestore sheet document; the app calculates the key formula-driven summaries while displaying the mobile records.
- The Excel template's existing blank rows remain blank. New app records are appended with formula templates for the supported calculated columns.
- The dashboard's expense ledger and BOQ purchase actuals are both displayed. The total actual in the dashboard follows the workbook's original formula model (materials + labour + fees + misc); the daily expense total is shown separately to avoid double counting.
- Only project roles `owner` and `viewer` are supported. Create exactly one owner user and one viewer user in Firestore for the intended access model.
- Structured records are read through bounded pages of 250 documents, including records without timestamps. The screen renders 50 entries at a time. Exact project-wide summaries still require fetching every page into the device, so memory use and Firestore reads grow with project size; keep exports and old receipt volume within Spark quotas.
- Agreements store the agreed amount once. Payment transactions reference an agreement and are classified as either advances or later payments; outstanding is agreed amount minus both. Legacy unlinked payments remain viewable and their balance is not guessed.
- Inventory formula: available = received + returned-to-stock − returned-to-supplier − used − wastage. Purchase movements represent ordered quantity only and do not increase stock. Legacy `returned` movements are excluded from stock because their destination is unknown.
- Owners can create approval requests and make one pending-to-approved/rejected decision with actor UID, timestamp, notes and an appended history entry. Firestore rules restrict those writes to owners.
- Reminders are shared as project records, but each scheduled notification and its identifier are stored on the device that scheduled it. Rescheduling replaces the local schedule; cancellation updates the project record and removes that device's local schedule. Other members are not notified.
- The Project Records screen waits for a nonempty cloud workbook snapshot and all accessible structured collections before enabling XLSX/PDF reports. Exports include separate totals and date/category/person summaries for the structured ledger and historic workbook daily expenses, plus agreement balances, stock and progress. Keeping those sources separate avoids accidental double-counting. Full JSON backup exports workbook sheets, structured collections and linked receipt/diary image documents, with a 50 MiB total limit, unique document-ID validation and a 900,000-byte per-document restore limit. Restore adds only missing document IDs and skips existing documents; it never overwrites them. Finalized approvals require a valid decision history to restore. User role documents, activity history and device-local reminder schedules are not part of that backup.
- Project workbook sheet sync still uses a real-time Firestore listener because worksheets are stored as individual bounded documents. The app does not use Cloud Functions or FCM; `functions/` is retained historical source and is not part of the Spark app or Android workflow.
- Before using the data for construction payments or quantities, continue to verify measurements, bills and engineer-approved quantities at site.
