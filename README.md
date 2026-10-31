# KSK House Construction — Android app source

A mobile project manager for the KSK G+1 house build, based on the uploaded `KSK_House_Cost.xlsx` workbook.

## What's included

- All **11 original workbook tabs**: Project Dashboard, Project Setup, Detailed Material List Ground, Detailed Material List First, Materials & BOQ, Labour & Work, Professional Fees, Misc & Equipment, Daily Expenses, Work Schedule, and Floor Summary.
- The original Excel workbook is included unchanged at `assets/KSK_House_Cost.xlsx`.
- The imported workbook data and cell formula strings are included at `assets/ksk_workbook.json`. The app keeps each sheet's formula grid when saving a sheet to Firestore, and recalculates the formula-driven budget/summary values for display.
- Live dashboard for estimate, paid-to-date, remaining budget, contingency and construction progress.
- Editable row forms for the owner, including expenses, material receipts, professional fees, equipment, labour and work progress.
- Read-only mode for the father's viewer account.
- Firestore live listeners, Firestore security rules, an activity feed, local device notifications, and structured payment, stock, progress, diary, approval, and reminder records.
- A separate **Quotation Compare** module. It is additional to the 11 workbook tabs because the original dashboard mentions this feature, but the uploaded workbook does not contain a Quotation Compare worksheet.

## Current connection status

This package is the Android app **source project**, not a signed APK. It has not been connected to a Firebase project or deployed from this environment because project configuration and account UIDs were not supplied. Cloud sync becomes active after Firebase setup. The app displays bundled workbook data in local preview mode until then.

## Free-plan architecture and limits

The app uses Firebase Authentication and Cloud Firestore client SDK only and is designed to run on the Firebase Spark plan. It does not require Storage, Cloud Functions, paid APIs, or server-side code. Firestore and Authentication remain subject to Google's current Spark quotas and availability limits. Local notifications are scheduled on the individual device; they do not notify other project members. Cross-device, background push notifications require a separately operated push service and are not included in the free-plan app.

The `functions/` folder contains historical notification code retained for source compatibility only; the app does not call or require it. Do not deploy it as part of the Spark setup.

Bill images are compressed JPEG Base64 documents in Firestore, not Firebase Storage. Firestore has a 1 MiB document limit; the app caps image payloads at 450,000 Base64 characters to leave room for document metadata. Large or numerous images consume Firestore document storage and read quota. All project members with owner or viewer roles can read bill images; only the owner can add, replace, or delete them.

## Firebase setup

### 1. Create a Firebase project

1. Create a Firebase project (a South India region such as `asia-south1` is a sensible choice for this project).
2. Add an Android app with package name `com.ksk.houseconstruction`.
3. Download its `google-services.json` and place it in the project root beside `app.json`.
4. In Firebase Authentication, enable **Email/Password** sign-in.
5. Create the two sign-in accounts: your owner account and your father's account.
6. Create a Cloud Firestore database.

The Firebase web app configuration is also needed by the Firebase JavaScript SDK. Set the `EXPO_PUBLIC_FIREBASE_*` values in a local `.env` file. These client configuration values are identifiers, not administrator secrets. Never put a service-account private key in `.env` or in the mobile app.

### 2. Assign the two roles

In Firebase Console → Authentication, copy the UID for each account. In Firestore, create these documents manually:

- Collection: `users`, document ID: **your UID**, fields: `role` = `owner`, `projectId` = `ksk`
- Collection: `users`, document ID: **your father's UID**, fields: `role` = `viewer`, `projectId` = `ksk`

Do not create role fields in the mobile app. The rules intentionally deny all client-side changes to role documents, so the viewer cannot grant himself edit access.

### 3. Deploy Firestore security rules

Install the Firebase CLI and sign in to the same Firebase project:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

The rules permit project access only for users whose `projectId` is `ksk` and whose role is `owner` or `viewer`. Sheet and structured record writes are owner-only. Bill image reads are available to both project roles. Unknown accounts have no project access. Do not deploy any broader rules from another project.

### 5. Build the Android APK

Use Node.js 22.13+ and an Expo account. From this project folder:

```bash
npm install
cp .env.example .env
# Fill in the Firebase web app configuration in .env
npx expo install --fix
npx eas-cli login
npx eas-cli init
```

After `eas init`, replace `REPLACE_WITH_EAS_PROJECT_ID` in `app.json` with the created EAS project ID. Then build an installable internal-test APK:

```bash
npx eas-cli build --platform android --profile preview
```

For a Play Store bundle, use:

```bash
npx eas-cli build --platform android --profile production
```

The app's notifications are local to the device. They do not require FCM tokens or a Cloud Function and do not notify a second phone.

### 6. First cloud import

1. Sign in on your phone with the account assigned `owner`.
2. Open Settings → Cloud workbook → **Import workbook to cloud**.
3. The app copies all 11 sheets into `projects/ksk/sheets` and creates the extra Quotation Compare document.
4. Sign in on the viewer's phone using the `viewer` account. They can read the same permitted project data through Firestore listeners.

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
- Structured Project Records are streamed without an arbitrary 150-record cap so totals and person balances include the full collection. Very large collections therefore use more device memory and Firestore reads; archive/export before approaching service quotas.
- Project Records include person payment history and balance summaries, inventory movements, floor/activity progress, site diary entries, owner-only approval/reminder records, and bill images for payment entries. Workbook sheets remain compatible and unchanged.
- Export/import of the entire Firestore project and scheduled reminder management are not currently implemented. The workbook can still be exported using the existing report/export flow; local device notifications are not a shared reminder system.
- Before using the data for construction payments or quantities, continue to verify measurements, bills and engineer-approved quantities at site.
