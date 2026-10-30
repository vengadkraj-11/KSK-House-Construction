# KSK House Construction — Android app source

A mobile project manager for the KSK G+1 house build, based on the uploaded `KSK_House_Cost.xlsx` workbook.

## What's included

- All **11 original workbook tabs**: Project Dashboard, Project Setup, Detailed Material List Ground, Detailed Material List First, Materials & BOQ, Labour & Work, Professional Fees, Misc & Equipment, Daily Expenses, Work Schedule, and Floor Summary.
- The original Excel workbook is included unchanged at `assets/KSK_House_Cost.xlsx`.
- The imported workbook data and cell formula strings are included at `assets/ksk_workbook.json`. The app keeps each sheet's formula grid when saving a sheet to Firestore, and recalculates the formula-driven budget/summary values for display.
- Live dashboard for estimate, paid-to-date, remaining budget, contingency and construction progress.
- Editable row forms for the owner, including expenses, material receipts, professional fees, equipment, labour and work progress.
- Read-only mode for the father's viewer account.
- Firestore live listeners, Firestore security rules, an activity feed, Android push-token registration, and a Cloud Function to notify viewer devices after sheet edits.
- A separate **Quotation Compare** module. It is additional to the 11 workbook tabs because the original dashboard mentions this feature, but the uploaded workbook does not contain a Quotation Compare worksheet.

## Current connection status

This package is the Android app **source project**, not a signed APK. It has not been connected to a Firebase project or deployed from this environment because the Firebase project configuration, account UIDs, FCM credentials, and an Android build/signing environment were not supplied. Real cloud sync and push notifications become active after the setup below. The app displays the bundled workbook in local preview mode until then.

## Firebase setup

### 1. Create a Firebase project

1. Create a Firebase project (a South India region such as `asia-south1` is a sensible choice for this project).
2. Add an Android app with package name `com.ksk.houseconstruction`.
3. Download its `google-services.json` and place it in the project root beside `app.json`.
4. In Firebase Authentication, enable **Email/Password** sign-in.
5. Create the two sign-in accounts: your owner account and your father's account.
6. Create a Cloud Firestore database.

The Firebase web app configuration is also needed by the Firebase JavaScript SDK. Copy the web app values into a local `.env` file using `.env.example` as the template. These Firebase client configuration values are identifiers, not administrator secrets. Never put a service-account private key in `.env` or in the mobile app.

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

The rules permit reads only for users whose `projectId` is `ksk` and whose role is `owner` or `viewer`; sheet writes are allowed only for the KSK owner. The notification function also filters viewer devices by that same project ID. Unknown accounts have no project access. Device-token documents can be written only by the signed-in account to its own user subcollection.

### 4. Configure and deploy push notifications

The app asks Android for notification permission and saves the native Android FCM token in `users/{uid}/devices/{tokenId}`. The Cloud Function sends an FCM notification to viewer-role devices when a project sheet is updated.

1. Confirm Firebase Cloud Messaging is enabled for the project.
2. Ensure the `google-services.json` file belongs to the Android package `com.ksk.houseconstruction`.
3. Install function dependencies and deploy:

```bash
cd functions
npm install
cd ..
firebase deploy --only functions
```

Cloud Functions deployment requires the Blaze billing plan for deployment; review the current Firebase pricing/usage limits before enabling it. Check the current Firebase Console requirements for the project before deploying.

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

Remote Android push notifications require a real development/production build with the app's Firebase/FCM credentials; they are not available in Expo Go. Install the APK on both phones, sign in with the assigned accounts, and press **Enable this device** in Settings on your father's phone.

### 6. First cloud import

1. Sign in on your phone with the account assigned `owner`.
2. Open Settings → Cloud workbook → **Import workbook to cloud**.
3. The app copies all 11 sheets into `projects/ksk/sheets` and creates the extra Quotation Compare document.
4. Sign in on your father's phone using the `viewer` account. He will see the same Firestore data through real-time listeners and receive push notifications after your edits once notifications are enabled and the function is deployed.

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
- Before using the data for construction payments or quantities, continue to verify measurements, bills and engineer-approved quantities at site.
