import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator, Platform, ScrollView, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import {
  browserLocalPersistence, onAuthStateChanged, setPersistence, signInAnonymously, signOut, User
} from 'firebase/auth';
import {doc, getDoc} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BillAttachments from './BillAttachments';
import {auth, db, isFirebaseConfigured} from '../firebase';
import {headersForSheet, meaningfulRows, excelSerialToDate} from '../data';
import {calculateDashboard, calculateFloorProgress, calculateFloorSummary, countMaterials} from '../services/calculations';
import {subscribeViewerSheets} from '../services/projectSync';
import {ProjectRecord, subscribeProjectRecords} from '../services/projectRecords';
import {summarizeContracts, summarizeInventory} from '../services/recordMath';
import {
  canContinueWithApprovedSession, lookupViewerAccessByPhone, normalizePhoneNumber, registerViewerRequest,
  requestViewerRecovery, saveViewerLanguage, subscribeViewerRequest,
  saveLegacyViewerLanguage, ViewerAccessRequest, ViewerLanguage
} from '../services/viewerAccess';
import {getPreferredLanguage, savePreferredLanguage} from '../services/websiteAccess';
import {KSK_DESIGN} from '../theme/kskDesignSystem';

type Section = 'dashboard' | 'expenses' | 'stock' | 'payments' | 'progress';
type SheetMap = Record<string, any>;
const colors = KSK_DESIGN.colors;
const tMap: Record<string, string> = {
  'Overall Dashboard': 'மொத்த மேலோட்டம்',
  'Daily Expenses': 'தினசரி செலவுகள்',
  'Stock Management': 'இருப்பு மேலாண்மை',
  'Payment Records': 'கட்டணப் பதிவுகள்',
  'Work Progress': 'பணி முன்னேற்றம்',
  'Total project cost': 'திட்டத்தின் மொத்தச் செலவு',
  'Total daily expenses': 'மொத்த தினசரிச் செலவுகள்',
  'Total paid': 'மொத்தம் செலுத்தியது',
  'Dashboard totals use Daily Expenses; payment records are separate and may overlap.': 'முகப்பு மொத்தங்கள் தினசரிச் செலவுகளைப் பயன்படுத்துகின்றன; கட்டணப் பதிவுகள் தனியானவை, ஒரே செலவைக் குறிக்கலாம்.',
  'Agreement balance': 'ஒப்பந்த மீதித் தொகை',
  'Material summary': 'பொருள் சுருக்கம்',
  'Overall work progress': 'மொத்தப் பணி முன்னேற்றம்',
  'Ground floor': 'தரைத் தளம்',
  'First floor': 'முதல் தளம்',
  'Available': 'இருப்பு',
  'Received': 'பெறப்பட்டது',
  'Used': 'பயன்படுத்தப்பட்டது',
  'Date': 'தேதி',
  'Category': 'வகை',
  'Description': 'விவரம்',
  'Amount': 'தொகை',
  'View details': 'விவரங்களைக் காண்க',
  'Hide details': 'விவரங்களை மறை',
  'Download bill / receipt': 'பில் / ரசீதைப் பதிவிறக்கவும்',
  'No records available yet.': 'இதுவரை பதிவுகள் இல்லை.',
  'Loading project records…': 'திட்டப் பதிவுகள் ஏற்றப்படுகின்றன…',
  'Read only': 'படிக்க மட்டும்',
  'Family viewer': 'குடும்பப் பார்வையாளர்',
  'Sign out': 'வெளியேறு',
  'Change language': 'மொழியை மாற்று',
  'English': 'ஆங்கிலம்',
  'Tamil': 'தமிழ்',
  'Owner Login': 'உரிமையாளர் உள்நுழைவு',
  'Sign In': 'உள்நுழை',
  'Sign Up': 'பதிவு செய்',
  'Submit Registration': 'பதிவைச் சமர்ப்பிக்கவும்',
  'Back': 'பின்செல்',
  'Your registration is awaiting owner approval.': 'உங்கள் பதிவு உரிமையாளர் அனுமதிக்காகக் காத்திருக்கிறது.',
  'Your sign-in recovery is awaiting owner verification.': 'உங்கள் உள்நுழைவு மீட்பு உரிமையாளர் சரிபார்ப்புக்காகக் காத்திருக்கிறது.',
  'This number is already approved. Sign in on its saved browser or request secure recovery.': 'இந்த எண் ஏற்கனவே அனுமதிக்கப்பட்டுள்ளது. சேமித்த உலாவியில் உள்நுழையவும் அல்லது பாதுகாப்பான மீட்பைக் கோரவும்.',
  'No approved account uses this number. Please Sign Up.': 'இந்த எண்ணுக்கு அனுமதிக்கப்பட்ட கணக்கு இல்லை. பதிவு செய்யவும்.',
  'This account has been rejected. Contact the project owner.': 'இந்தக் கணக்கு நிராகரிக்கப்பட்டது. திட்ட உரிமையாளரைத் தொடர்புகொள்ளவும்.',
  'Access to this account was revoked. Contact the project owner.': 'இந்தக் கணக்கின் அணுகல் நீக்கப்பட்டது. திட்ட உரிமையாளரைத் தொடர்புகொள்ளவும்.',
  'This mobile number already has an approved account. Use Sign In for secure recovery.': 'இந்த மொபைல் எண்ணுக்கு ஏற்கனவே அனுமதிக்கப்பட்ட கணக்கு உள்ளது. பாதுகாப்பான மீட்புக்கு உள்நுழையவும்.',
  'This mobile number already has a pending registration.': 'இந்த மொபைல் எண்ணுக்கு பதிவு ஏற்கனவே நிலுவையில் உள்ளது.',
  'This mobile number is already associated with a member account. Contact the project owner.': 'இந்த மொபைல் எண் ஏற்கனவே உறுப்பினர் கணக்குடன் இணைக்கப்பட்டுள்ளது. திட்ட உரிமையாளரைத் தொடர்புகொள்ளவும்.',
  'Name': 'பெயர்',
  'Continue / Submit': 'தொடரவும் / சமர்ப்பிக்கவும்',
  'Continue': 'தொடரவும்',
  'The authenticated session and mobile number do not match an approved member.': 'அங்கீகரிக்கப்பட்ட உறுப்பினரின் உள்நுழைவும் மொபைல் எண்ணும் பொருந்தவில்லை.',
  'If this device lost its saved session, submit a new request and ask the owner to verify it.': 'இந்தச் சாதனத்தின் சேமித்த அமர்வு நீங்கியிருந்தால், புதிய கோரிக்கையைச் சமர்ப்பித்து உரிமையாளரிடம் சரிபார்க்கச் சொல்லவும்.',
  'Enter a mobile number with its country code.': 'நாட்டுக் குறியீட்டுடன் மொபைல் எண்ணை உள்ளிடவும்.',
  'Enter your full name (2–120 characters).': 'உங்கள் முழுப் பெயரை உள்ளிடவும் (2–120 எழுத்துகள்).',
  'Secure family access is unavailable. Contact the project owner.': 'பாதுகாப்பான குடும்ப அணுகல் கிடைக்கவில்லை. திட்ட உரிமையாளரைத் தொடர்புகொள்ளவும்.',
  'Agreement': 'ஒப்பந்தம்',
  'Agreed': 'ஒப்புக்கொண்ட தொகை',
  'Paid': 'செலுத்தப்பட்டது',
  'Balance': 'மீதம்',
  'Material': 'பொருள்',
  'Quantity': 'அளவு',
  'Unit': 'அலகு',
  'Movement': 'நகர்வு',
  'Activity': 'பணி',
  'Floor / area': 'தளம் / பகுதி',
  'Completion': 'நிறைவு',
  'Status': 'நிலை',
  'Registration': 'பதிவு',
  'Login': 'உள்நுழைவு',
  'Email address': 'மின்னஞ்சல் முகவரி',
  'Password': 'கடவுச்சொல்',
  'Enter your email and password.': 'உங்கள் மின்னஞ்சல் மற்றும் கடவுச்சொல்லை உள்ளிடவும்.',
  'Sign in': 'உள்நுழை',
  'I have an account': 'எனக்கு ஏற்கனவே கணக்கு உள்ளது',
  'Full name': 'முழுப் பெயர்',
  'Mobile number': 'மொபைல் எண்',
  'Include country code, e.g. +91': 'நாட்டுக் குறியீட்டுடன் உள்ளிடவும், எ.கா. +91',
  'Owner approval required': 'உரிமையாளர் அனுமதி தேவை',
  'Your access request is awaiting owner approval.': 'உங்கள் அணுகல் கோரிக்கை உரிமையாளர் அனுமதிக்காகக் காத்திருக்கிறது.',
  'Project information remains locked until approval.': 'அனுமதி கிடைக்கும் வரை திட்டத் தகவல் பூட்டப்பட்டிருக்கும்.',
  'Access rejected': 'அணுகல் நிராகரிக்கப்பட்டது',
  'Access revoked': 'அணுகல் நீக்கப்பட்டது',
  'This account does not currently have family viewer access. Contact the project owner.': 'இந்தக் கணக்கிற்கு தற்போது குடும்பப் பார்வையாளர் அணுகல் இல்லை. திட்ட உரிமையாளரைத் தொடர்புகொள்ளவும்.',
  'Your mobile number is contact information, not a sign-in credential.': 'உங்கள் மொபைல் எண் தொடர்புத் தகவல் மட்டுமே; உள்நுழைவு சான்று அல்ல.',
  'Your secure session is saved on this browser. You can return without asking for approval again.': 'உங்கள் பாதுகாப்பான அமர்வு இந்த உலாவியில் சேமிக்கப்பட்டுள்ளது. மீண்டும் அனுமதி கோராமல் திரும்பலாம்.',
  'Your secure session is saved on this browser. You can return if the owner restores access.': 'உங்கள் பாதுகாப்பான அமர்வு இந்த உலாவியில் சேமிக்கப்பட்டுள்ளது. உரிமையாளர் அணுகலை மீட்டமைத்தால் திரும்பலாம்.',
  'Secure browser storage is unavailable. Enable browser storage and reload to continue.': 'பாதுகாப்பான உலாவி சேமிப்பு கிடைக்கவில்லை. தொடர உலாவி சேமிப்பை இயக்கி மீண்டும் ஏற்றவும்.',
  'Email and password sign-in is unavailable. Please contact the project owner.': 'மின்னஞ்சல் மற்றும் கடவுச்சொல் உள்நுழைவு கிடைக்கவில்லை. திட்ட உரிமையாளரைத் தொடர்புகொள்ளவும்.',
  'The email or password is incorrect.': 'மின்னஞ்சல் அல்லது கடவுச்சொல் தவறானது.',
  'Choose a password with at least 6 characters.': 'குறைந்தது 6 எழுத்துகள் கொண்ட கடவுச்சொல்லைத் தேர்ந்தெடுக்கவும்.',
  'An account already uses this email. Sign in instead.': 'இந்த மின்னஞ்சலுக்கு ஏற்கனவே கணக்கு உள்ளது. உள்நுழையவும்.',
  'Choose your preferred language': 'உங்களுக்கு விருப்பமான மொழியைத் தேர்ந்தெடுக்கவும்',
  'Create access request': 'அணுகல் கோரிக்கையை உருவாக்கு',
  'Viewer access is read-only. You cannot edit project records or attachments.': 'பார்வையாளர் அணுகல் படிக்க மட்டும். திட்டப் பதிவுகள் அல்லது இணைப்புகளைத் திருத்த முடியாது.',
  'No project data is available yet.': 'திட்டத் தரவு இன்னும் கிடைக்கவில்லை.',
  'materials': 'பொருட்கள்',
  'workbook items': 'பணிப்புத்தக உருப்படிகள்',
  'No access request exists for this account yet.': 'இந்தக் கணக்கிற்கு அணுகல் கோரிக்கை இன்னும் இல்லை.',
  'An owner account is currently signed in. Sign out, then create a family viewer access request.': 'உரிமையாளர் கணக்கு தற்போது உள்நுழைந்துள்ளது. வெளியேறி குடும்பப் பார்வையாளர் அணுகல் கோரிக்கையை உருவாக்கவும்.',
  'Enter your full name.': 'உங்கள் முழுப் பெயரை உள்ளிடவும்.',
  'The access request could not be saved.': 'அணுகல் கோரிக்கையைச் சேமிக்க முடியவில்லை.',
  'Could not save your language preference.': 'மொழி விருப்பத்தைச் சேமிக்க முடியவில்லை.',
  'Could not verify your approved sign-in. Sign out and sign in again.': 'உங்கள் அனுமதிக்கப்பட்ட உள்நுழைவைச் சரிபார்க்க முடியவில்லை. வெளியேறி மீண்டும் உள்நுழையவும்.',
  'Access approved — sign in again to activate.': 'அணுகல் அனுமதிக்கப்பட்டது — செயல்படுத்த மீண்டும் உள்நுழையவும்.',
  'Owner approval is complete. Sign out, then sign in again with your private email and password to activate viewer access.': 'உரிமையாளர் அனுமதி வழங்கியுள்ளார். பார்வையாளர் அணுகலைச் செயல்படுத்த உங்கள் தனிப்பட்ட மின்னஞ்சல் மற்றும் கடவுச்சொல்லுடன் வெளியேறி மீண்டும் உள்நுழையவும்.',
  'Use your private email and password to sign in. Firebase Authentication protects this credential; it is never saved in project records.': 'உங்கள் தனிப்பட்ட மின்னஞ்சல் மற்றும் கடவுச்சொல்லைப் பயன்படுத்தி உள்நுழையவும். Firebase Authentication இதைப் பாதுகாக்கிறது; இது திட்டப் பதிவுகளில் சேமிக்கப்படாது.',
  'Back to access selection': 'அணுகல் தேர்வுக்குத் திரும்பு',
  'Family Viewer Login': 'குடும்பப் பார்வையாளர் உள்நுழைவு',
  'Could not save the access request. Contact the project owner if the issue continues.': 'அணுகல் கோரிக்கையைச் சேமிக்க முடியவில்லை. சிக்கல் தொடர்ந்தால் திட்ட உரிமையாளரைத் தொடர்புகொள்ளவும்.',
  'Recent changes': 'சமீபத்திய மாற்றங்கள்',
  'Stock movements': 'இருப்பு நகர்வுகள்',
  'Agreements and payment history': 'ஒப்பந்தங்கள் மற்றும் கட்டண வரலாறு',
  'Work stages and history': 'பணிக் கட்டங்கள் மற்றும் வரலாறு',
  'Ground Floor': 'தரைத் தளம்',
  'First Floor': 'முதல் தளம்',
  'Common/External': 'பொது / வெளிப்புறம்',
  'Expense Category': 'செலவு வகை',
  'Item / Description': 'பொருள் / விவரம்',
  'Vendor / Person': 'விற்பனையாளர் / நபர்',
  'Amount Paid (₹)': 'செலுத்திய தொகை (₹)',
  'Payment Mode': 'கட்டண முறை',
  'Bill Status': 'பில் நிலை',
  'Bill / Voucher No.': 'பில் / வவுச்சர் எண்',
  'Floor / Area': 'தளம் / பகுதி',
  'Work Stage': 'பணிக் கட்டம்',
  'Paid By': 'செலுத்தியவர்',
  'Received by': 'பெற்றவர்',
  'Bill Received?': 'பில் பெறப்பட்டதா?',
  'Material / Item': 'பொருள் / உருப்படி',
  'Specification / Grade': 'விவரக்குறிப்பு / தரம்',
  'Estimated Qty': 'மதிப்பிடப்பட்ட அளவு',
  'Rate (₹/unit)': 'அலகு விலை (₹)',
  'Wastage %': 'விரயம் %',
  'Estimated Amount (₹)': 'மதிப்பிடப்பட்ட தொகை (₹)',
  'Supplier / Brand': 'வழங்குநர் / பிராண்ட்',
  'Order Date': 'ஆர்டர் தேதி',
  'Qty Received': 'பெறப்பட்ட அளவு',
  'Qty Balance': 'மீதமுள்ள அளவு',
  'Actual Amount (₹)': 'உண்மையான தொகை (₹)',
  'Activity ID': 'பணி அடையாள எண்',
  'Construction Activity': 'கட்டுமானப் பணி',
  'Planned Start': 'திட்டமிட்ட தொடக்கம்',
  'Planned Finish': 'திட்டமிட்ட நிறைவு',
  'Actual Start': 'உண்மையான தொடக்கம்',
  'Actual Finish': 'உண்மையான நிறைவு',
  'Duration (days)': 'காலம் (நாட்கள்)',
  'Predecessor / Dependency': 'முன் பணி / சார்பு',
  '% Complete': 'நிறைவு %',
  'Planned Budget (₹)': 'திட்டமிட்ட செலவு (₹)',
  'Actual Cost (₹)': 'உண்மையான செலவு (₹)',
  'Delay (days)': 'தாமதம் (நாட்கள்)',
  amount: 'தொகை',
  agreedAmount: 'ஒப்புக்கொண்ட தொகை',
  person: 'நபர்',
  paymentTo: 'செலுத்தியவர்',
  paymentKind: 'கட்டண வகை',
  category: 'வகை',
  date: 'தேதி',
  description: 'விவரம்',
  notes: 'குறிப்புகள்',
  material: 'பொருள்',
  quantity: 'அளவு',
  unit: 'அலகு',
  direction: 'நகர்வு',
  unitRate: 'அலகு விலை',
  supplier: 'வழங்குநர்',
  stage: 'பணி நிலை',
  floor: 'தளம் / பகுதி',
  percent: 'நிறைவு சதவீதம்',
  plannedDate: 'திட்டமிட்ட தேதி',
  actualDate: 'உண்மையான தேதி',
  responsiblePerson: 'பொறுப்பாளர்',
  status: 'நிலை',
  paidBy: 'செலுத்தியவர்',
  method: 'முறை',
  receivedBy: 'பெற்றவர்',
  receiptReference: 'ரசீது குறிப்பு',
  paymentReference: 'கட்டணக் குறிப்பு',
  voucherNumber: 'வவுச்சர் எண்',
  balance: 'மீதம்'
};
const text = (language: ViewerLanguage, english: string) => language === 'ta' ? tMap[english] || english : english;
function localizedError(issue: any, language: ViewerLanguage, fallback: string) {
  const code = String(issue?.code || '');
  if (code === 'auth/operation-not-allowed') return text(language, 'Secure family access is unavailable. Contact the project owner.');
  if (['auth/invalid-credential', 'auth/invalid-login-credentials', 'auth/user-not-found', 'auth/wrong-password', 'auth/invalid-email'].includes(code)) return text(language, 'The email or password is incorrect.');
  if (code === 'auth/weak-password') return text(language, 'Choose a password with at least 6 characters.');
  if (code === 'auth/email-already-in-use') return text(language, 'An account already uses this email. Sign in instead.');
  if (code === 'permission-denied' || code === 'firestore/permission-denied') return text(language, 'Could not save the access request. Contact the project owner if the issue continues.');
  return text(language, String(issue?.message || fallback));
}
const money = (value: number) => `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;
const fieldsOf = (record: ProjectRecord) => Object.entries(record)
  .filter(([key, value]) => !['id', 'type', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'schemaVersion'].includes(key) && value !== '' && value !== null && value !== undefined)
  .map(([key, value]) => [key, typeof value === 'object' && value?.toDate ? value.toDate().toLocaleDateString() : String(value)] as const);

function Card({children}: {children: React.ReactNode}) {
  return <View style={{backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 15, marginBottom: 11}}>{children}</View>;
}

function ActionButton({label, onPress, disabled = false, secondary = false}: {label: string; onPress: () => void; disabled?: boolean; secondary?: boolean}) {
  return <TouchableOpacity disabled={disabled} onPress={onPress} style={{minHeight: 46, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 15, borderRadius: 11, backgroundColor: secondary ? colors.primarySoft : colors.primary, opacity: disabled ? 0.55 : 1}}>
    <Text style={{fontWeight: '800', color: secondary ? colors.primary : '#FFF'}}>{label}</Text>
  </TouchableOpacity>;
}

function StatusPanel({title, detail, color = colors.primary}: {title: string; detail: string; color?: string}) {
  return <View style={{flex: 1, padding: 15, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: 10}}>
    <Text style={{fontSize: 11, color: colors.inkMuted, fontWeight: '800'}}>{title}</Text>
    <Text style={{fontSize: 19, color, fontWeight: '900', marginTop: 6}}>{detail}</Text>
  </View>;
}

function AccessHeader({language, onLanguageChange, onOwnerLogin}: {
  language: ViewerLanguage;
  onLanguageChange: (value: ViewerLanguage) => void;
  onOwnerLogin?: () => void;
}) {
  return <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18}}>
    <View style={{flexDirection: 'row', gap: 12}}>
      {(['en', 'ta'] as const).map(value => <TouchableOpacity key={value} accessibilityRole="button" accessibilityState={{selected: language === value}} onPress={() => onLanguageChange(value)}>
        <Text style={{fontSize: 12, color: language === value ? colors.primary : colors.inkMuted, fontWeight: '800'}}>{value === 'en' ? 'English' : 'தமிழ்'}</Text>
      </TouchableOpacity>)}
    </View>
    {onOwnerLogin ? <TouchableOpacity accessibilityRole="link" onPress={onOwnerLogin} style={{padding: 5}}>
      <Text style={{fontSize: 11, color: colors.inkMuted, fontWeight: '700'}}>{text(language, 'Owner Login')}</Text>
    </TouchableOpacity> : null}
  </View>;
}

function AccessHome({language, onLanguageChange, onOwnerLogin, onSignIn, onSignUp}: {
  language: ViewerLanguage;
  onLanguageChange: (value: ViewerLanguage) => void;
  onOwnerLogin?: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  return <ScrollView contentContainerStyle={{flexGrow: 1, justifyContent: 'center', padding: 18, backgroundColor: colors.canvas}}>
    <View style={{width: '100%', maxWidth: 480, alignSelf: 'center'}}>
      <AccessHeader language={language} onLanguageChange={onLanguageChange} onOwnerLogin={onOwnerLogin}/>
      <View style={{alignSelf: 'center', width: 54, height: 54, borderRadius: 17, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center', marginBottom: 12}}>
        <Text style={{fontSize: 17, color: '#FFF', fontWeight: '900'}}>KSK</Text>
      </View>
      <Text style={{fontSize: 24, fontWeight: '900', color: colors.ink, textAlign: 'center', marginBottom: 20}}>KSK House Construction</Text>
      <Card>
        <View style={{gap: 10, marginTop: 4}}>
          <ActionButton label={text(language, 'Sign In')} onPress={onSignIn}/>
          <ActionButton label={text(language, 'Sign Up')} onPress={onSignUp} secondary/>
        </View>
      </Card>
    </View>
  </ScrollView>;
}

function AccessForm({mode, language, user, onLanguageChange, onSignIn, onBack, onApproved, onOwnerLogin}: {
  mode: 'sign-in' | 'sign-up';
  language: ViewerLanguage;
  user?: User | null;
  onLanguageChange: (value: ViewerLanguage) => void;
  onSignIn: (user: User) => void;
  onBack: () => void;
  onApproved: (request: ViewerAccessRequest) => void;
  onOwnerLogin?: () => void;
}) {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const signUp = mode === 'sign-up';
  const t = (value: string) => text(language, value);

  const submit = async () => {
    if (!auth || busy) return;
    setError('');
    setMessage('');
    try {
      const normalizedPhone = normalizePhoneNumber(phone);
      if (!/^\+[1-9]\d{7,14}$/.test(normalizedPhone)) throw new Error('Enter a mobile number with its country code.');
      if (signUp && (fullName.trim().length < 2 || fullName.trim().length > 120)) throw new Error('Enter your full name (2–120 characters).');
      setBusy(true);
      const requester = user || (await signInAnonymously(auth)).user;
      onSignIn(requester);
      if (signUp) {
        const result = await registerViewerRequest(requester.uid, normalizedPhone, fullName, language);
        if (result.status === 'pending') setMessage('Your registration is awaiting owner approval.');
        else if (result.status === 'approved' && result.currentSession) setMessage('This mobile number already has an approved account. Use Sign In for secure recovery.');
        else if (result.status === 'approved') setMessage('This number is already approved. Sign in on its saved browser or request secure recovery.');
        else if (result.status === 'rejected') setMessage('This account has been rejected. Contact the project owner.');
        else setMessage('Access to this account was revoked. Contact the project owner.');
        return;
      }

      const result = await lookupViewerAccessByPhone(requester.uid, normalizedPhone);
      if (result?.status === 'pending') {
        setMessage('Your registration is awaiting owner approval.');
      } else if (result?.status === 'rejected') {
        setMessage('This account has been rejected. Contact the project owner.');
      } else if (result?.status === 'revoked') {
        setMessage('Access to this account was revoked. Contact the project owner.');
      } else if (result?.currentSession && result.uid === requester.uid && canContinueWithApprovedSession(requester.uid, result.request, normalizedPhone)) {
        onApproved(result.request!);
      } else {
        let recovery;
        try {
          recovery = await requestViewerRecovery(requester.uid, normalizedPhone);
        } catch (issue: any) {
          if (issue?.code === 'permission-denied') {
            setMessage('This number could not be matched to an active approved membership. Check the number or contact the project owner.');
            return;
          }
          throw issue;
        }
        if (recovery.status === 'pending') setMessage('Your sign-in recovery is awaiting owner verification.');
        else if (recovery.status === 'approved' && recovery.currentSession) setMessage('This mobile number is already associated with a member account. Contact the project owner.');
        else setMessage('This number is already approved. Sign in on its saved browser or request secure recovery.');
      }
    } catch (issue: any) {
      const message = localizedError(issue, language, 'The access request could not be saved.');
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return <ScrollView contentContainerStyle={{flexGrow: 1, justifyContent: 'center', padding: 18, backgroundColor: colors.canvas}}>
    <View style={{width: '100%', maxWidth: 480, alignSelf: 'center'}}>
      <AccessHeader language={language} onLanguageChange={onLanguageChange} onOwnerLogin={onOwnerLogin}/>
      <Text style={{fontSize: 22, fontWeight: '900', color: colors.ink, textAlign: 'center', marginBottom: 20}}>KSK House Construction</Text>
      <Card>
        <Text style={headingStyle}>{t(signUp ? 'Sign Up' : 'Sign In')}</Text>
        {signUp ? <TextInput value={fullName} onChangeText={setFullName} placeholder={t('Name')} autoComplete="name" style={inputStyle}/> : null}
        <TextInput value={phone} onChangeText={setPhone} placeholder={t('Mobile number')} keyboardType="phone-pad" autoComplete="tel" style={inputStyle}/>
        <View style={{marginTop: 4}}><ActionButton label={busy ? '…' : t(signUp ? 'Submit Registration' : 'Sign In')} onPress={() => void submit()} disabled={busy}/></View>
        <View style={{marginTop: 9}}><ActionButton label={t('Back')} onPress={onBack} disabled={busy} secondary/></View>
        {message ? <Text accessibilityLiveRegion="polite" style={{fontSize: 12, color: colors.primary, lineHeight: 18, marginTop: 9}}>{t(message)}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={{fontSize: 12, color: colors.danger, lineHeight: 18, marginTop: 9}}>{text(language, error)}</Text> : null}
      </Card>
    </View>
  </ScrollView>;
}

const inputStyle = {
  backgroundColor: colors.canvas, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
  paddingHorizontal: 13, paddingVertical: 12, color: colors.ink, minHeight: 48, marginTop: 12, marginBottom: 10
};

function FamilyData({uid, language, onLanguageChange, onSignOut, sheets, records, loading, errors}: {
  uid: string;
  language: ViewerLanguage;
  onLanguageChange: (value: ViewerLanguage) => void;
  onSignOut: () => void;
  sheets: SheetMap;
  records: Record<string, ProjectRecord[]>;
  loading: boolean;
  errors: string[];
}) {
  const [section, setSection] = useState<Section>('dashboard');
  const [expanded, setExpanded] = useState('');
  const t = (value: string) => text(language, value);
  const dashboard = useMemo(() => calculateDashboard(sheets), [sheets]);
  const floorProgress = useMemo(() => calculateFloorProgress(sheets), [sheets]);
  const floorSummary = useMemo(() => calculateFloorSummary(sheets), [sheets]);
  const materialCounts = useMemo(() => countMaterials(sheets), [sheets]);
  const inventory = useMemo(() => summarizeInventory(records.stock || []), [records.stock]);
  const agreements = useMemo(() => summarizeContracts(records.contracts || [], records.payments || []), [records.contracts, records.payments]);
  const expenseSheet = sheets.daily_expenses;
  const expenseHeaders = headersForSheet('daily_expenses', expenseSheet || {values: []});
  const expenses = expenseSheet ? meaningfulRows(expenseSheet).map(({row, index}) => ({
    id: String(expenseSheet.recordIds?.[index] || `expense-${index}`),
    row,
    fields: expenseHeaders.map((header: string, column: number) => [header, row[column]] as const).filter(([, value]: any) => value !== '' && value !== null && value !== undefined)
  })) : [];
  const sectionName: Record<Section, string> = {dashboard: 'Overall Dashboard', expenses: 'Daily Expenses', stock: 'Stock Management', payments: 'Payment Records', progress: 'Work Progress'};

  const renderDetails = (id: string, values: readonly (readonly [string, any])[]) => <View style={{marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8}}>
    {values.map(([label, value], index) => <View key={`${label}-${index}`} style={{flexDirection: 'row', justifyContent: 'space-between', gap: 14, paddingVertical: 4}}>
      <Text style={{flex: 1, fontSize: 11, color: colors.inkMuted}}>{t(label)}</Text>
      <Text selectable style={{flex: 1.4, fontSize: 11, color: colors.ink, textAlign: 'right'}}>{String(value)}</Text>
    </View>)}
  </View>;

  const workbookValue = (header: string, value: any) => {
    const raw = typeof value === 'number' && /date/i.test(header) ? excelSerialToDate(value) || String(value) : String(value);
    return [header, raw] as const;
  };

  const renderDashboard = () => <View>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8}}>
      <StatusPanel title={t('Total project cost')} detail={money(dashboard.totalBudget)}/>
      <StatusPanel title={t('Total daily expenses')} detail={money(dashboard.dailyExpenses)} color={colors.gold}/>
      <StatusPanel title={t('Total paid')} detail={money(dashboard.totalPaid)}/>
      <StatusPanel title={t('Agreement balance')} detail={money(agreements.reduce((sum: number, entry: any) => sum + entry.balance, 0))}/>
    </View>
    <Text style={bodyStyle}>{t('Dashboard totals use Daily Expenses; payment records are separate and may overlap.')}</Text>
    <Card>
      <Text style={headingStyle}>{t('Material summary')}</Text>
      <Text style={bodyStyle}>{t('Received')}: {materialCounts.received.toLocaleString('en-IN')} · {t('Available')}: {inventory.reduce((sum, item) => sum + item.available, 0).toLocaleString('en-IN')} · {t('Used')}: {inventory.reduce((sum, item) => sum + item.used, 0).toLocaleString('en-IN')}</Text>
      <Text style={[bodyStyle, {marginTop: 7}]}>{inventory.length} {t('materials')} · {materialCounts.stockLines} {t('workbook items')}</Text>
    </Card>
    <Card>
      <Text style={headingStyle}>{t('Overall work progress')}</Text>
      <Text style={{fontSize: 22, color: colors.primary, fontWeight: '900', marginTop: 8}}>{Math.round(dashboard.progress)}%</Text>
      <View style={{height: 8, backgroundColor: colors.primarySoft, borderRadius: 8, overflow: 'hidden', marginTop: 9}}>
        <View style={{height: 8, width: `${Math.min(100, Math.max(0, dashboard.progress))}%`, backgroundColor: colors.primary}}/>
      </View>
      {floorProgress.map(item => item.progress === null ? null : <Text key={item.floor} style={[bodyStyle, {marginTop: 7}]}>{t(item.floor)}: {Math.round(item.progress)}%</Text>)}
    </Card>
    <Card>
      <Text style={headingStyle}>{t('Ground floor')} · {t('First floor')}</Text>
      {floorSummary.slice(0, 2).map(item => <Text key={item.floor} style={[bodyStyle, {marginTop: 7}]}>{t(item.floor)}: {money(item.total)}</Text>)}
    </Card>
    <Card><Text style={headingStyle}>{t('Read only')}</Text><Text style={bodyStyle}>{t('Viewer access is read-only. You cannot edit project records or attachments.')}</Text></Card>
  </View>;

  const renderExpenses = () => !expenses.length ? <Empty language={language}/> : expenses.map(expense => {
    const amount = expense.fields.find(([header]) => /amount paid|amount/i.test(header))?.[1];
    return <Card key={expense.id}>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 12}}>
        <Text style={{flex: 1, fontSize: 13, fontWeight: '800', color: colors.ink}}>{String(expense.fields.find(([header]) => /item|description/i.test(header))?.[1] || t('Daily Expenses'))}</Text>
        <Text style={{fontSize: 13, fontWeight: '900', color: colors.primary}}>{money(Number(amount) || 0)}</Text>
      </View>
      <Text style={bodyStyle}>{String(expense.fields.find(([header]) => /^date$/i.test(header))?.[1] || '')} · {String(expense.fields.find(([header]) => /category/i.test(header))?.[1] || '')}</Text>
      <TouchableOpacity onPress={() => setExpanded(expanded === expense.id ? '' : expense.id)} style={{paddingVertical: 9}}>
        <Text style={{fontSize: 11, color: colors.primary, fontWeight: '800'}}>{t(expanded === expense.id ? 'Hide details' : 'View details')}</Text>
      </TouchableOpacity>
      {expanded === expense.id ? <>
        {renderDetails(expense.id, expense.fields.map(([label, value]) => workbookValue(label, value)))}
        <BillAttachments recordId={expense.id} canEdit={false} language={language}/>
      </> : null}
    </Card>;
  });

  const renderStock = () => !inventory.length && !(records.stock || []).length ? <Empty language={language}/> : <>
    {inventory.map(item => <Card key={`${item.material}-${item.unit}`}>
      <Text style={headingStyle}>{item.material}</Text>
      <Text style={bodyStyle}>{t('Received')}: {item.received} {item.unit} · {t('Used')}: {item.used} {item.unit}</Text>
      <Text style={[bodyStyle, {fontWeight: '800', color: colors.primary, marginTop: 4}]}>{t('Available')}: {item.available} {item.unit}</Text>
    </Card>)}
    <Text style={[headingStyle, {marginHorizontal: 2, marginVertical: 8}]}>{t('Stock movements')}</Text>
    {(records.stock || []).map(record => <Card key={record.id}>
      <Text style={headingStyle}>{record.material || '—'} · {record.direction || '—'}</Text>
      <Text style={bodyStyle}>{record.date || '—'} · {record.quantity ?? '—'} {record.unit || ''}</Text>
      {expanded === record.id ? renderDetails(record.id, fieldsOf(record)) : null}
      <TouchableOpacity onPress={() => setExpanded(expanded === record.id ? '' : record.id)} style={{paddingTop: 9}}>
        <Text style={{fontSize: 11, color: colors.primary, fontWeight: '800'}}>{t(expanded === record.id ? 'Hide details' : 'View details')}</Text>
      </TouchableOpacity>
    </Card>)}
  </>;

  const renderPayments = () => !agreements.length && !(records.payments || []).length ? <Empty language={language}/> : <>
    <Text style={[headingStyle, {marginHorizontal: 2, marginBottom: 9}]}>{t('Agreements and payment history')}</Text>
    {agreements.map((entry: any) => <Card key={entry.contract.id}>
      <Text style={headingStyle}>{entry.contract.person || entry.contract.category || '—'}</Text>
      <Text style={bodyStyle}>{t('Agreed')}: {money(entry.agreed)} · {t('Paid')}: {money(entry.paid)}</Text>
      <Text style={[bodyStyle, {fontWeight: '800', color: colors.primary, marginTop: 4}]}>{t('Balance')}: {money(entry.balance)}</Text>
      {expanded === entry.contract.id ? <>
        {renderDetails(entry.contract.id, fieldsOf(entry.contract))}
        {entry.history.map((payment: ProjectRecord) => <View key={payment.id} style={{marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border}}>
          <Text style={bodyStyle}>{payment.date || '—'} · {money(Number(payment.amount) || 0)} · {payment.paymentKind || 'payment'}</Text>
          <BillAttachments recordId={payment.id} canEdit={false} language={language}/>
        </View>)}
      </> : null}
      <TouchableOpacity onPress={() => setExpanded(expanded === entry.contract.id ? '' : entry.contract.id)} style={{paddingTop: 9}}>
        <Text style={{fontSize: 11, color: colors.primary, fontWeight: '800'}}>{t(expanded === entry.contract.id ? 'Hide details' : 'View details')}</Text>
      </TouchableOpacity>
    </Card>)}
    {(records.payments || []).filter(record => !record.contractId).map(payment => <Card key={payment.id}>
      <Text style={headingStyle}>{payment.paymentTo || payment.person || payment.description || '—'}</Text>
      <Text style={bodyStyle}>{payment.date || '—'} · {money(Number(payment.amount) || 0)}</Text>
      <BillAttachments recordId={payment.id} canEdit={false} language={language}/>
    </Card>)}
  </>;

  const renderProgress = () => {
    const workbookStages = sheets.work_schedule ? meaningfulRows(sheets.work_schedule).map(({row, index}) => ({
      id: String(sheets.work_schedule.recordIds?.[index] || `stage-${index}`),
      fields: headersForSheet('work_schedule', sheets.work_schedule).map((header: string, column: number) => [header, row[column]] as const).filter(([, value]: any) => value !== '' && value !== null && value !== undefined)
    })) : [];
    if (!workbookStages.length && !(records.progress || []).length) return <Empty language={language}/>;
    return <>
      {workbookStages.map(item => <Card key={item.id}>
        <Text style={headingStyle}>{String(item.fields.find(([header]) => /activity|stage|task/i.test(header))?.[1] || '—')}</Text>
        <Text style={bodyStyle}>{String(item.fields.find(([header]) => /floor|area/i.test(header))?.[1] || '')} · {String(item.fields.find(([header]) => /complete|progress/i.test(header))?.[1] || '—')}%</Text>
        {expanded === item.id ? renderDetails(item.id, item.fields.map(([label, value]) => workbookValue(label, value))) : null}
        <TouchableOpacity onPress={() => setExpanded(expanded === item.id ? '' : item.id)} style={{paddingTop: 9}}>
          <Text style={{fontSize: 11, color: colors.primary, fontWeight: '800'}}>{t(expanded === item.id ? 'Hide details' : 'View details')}</Text>
        </TouchableOpacity>
      </Card>)}
      {(records.progress || []).map(record => <Card key={record.id}>
        <Text style={headingStyle}>{record.stage || '—'}</Text>
        <Text style={bodyStyle}>{record.floor || '—'} · {record.percent ?? 0}% · {record.actualDate || record.plannedDate || ''}</Text>
        {expanded === record.id ? renderDetails(record.id, fieldsOf(record)) : null}
        <TouchableOpacity onPress={() => setExpanded(expanded === record.id ? '' : record.id)} style={{paddingTop: 9}}>
          <Text style={{fontSize: 11, color: colors.primary, fontWeight: '800'}}>{t(expanded === record.id ? 'Hide details' : 'View details')}</Text>
        </TouchableOpacity>
      </Card>)}
    </>;
  };

  const sectionContent: Record<Section, () => React.ReactNode> = {
    dashboard: renderDashboard, expenses: renderExpenses, stock: renderStock, payments: renderPayments, progress: renderProgress
  };
  const nav: Section[] = ['dashboard', 'expenses', 'stock', 'payments', 'progress'];
  return <View style={{flex: 1, backgroundColor: colors.canvas}}>
    <View style={{backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
      <View style={{flex: 1}}>
        <Text style={{fontSize: 16, color: colors.ink, fontWeight: '900'}}>KSK House</Text>
        <Text style={{fontSize: 10, color: colors.inkMuted}}>{t('Family viewer')} · {t('Read only')}</Text>
      </View>
      <TouchableOpacity onPress={() => onLanguageChange(language === 'en' ? 'ta' : 'en')} style={{padding: 8}}>
        <Text style={{fontSize: 11, fontWeight: '800', color: colors.primary}}>{language === 'en' ? 'தமிழ்' : 'English'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={onSignOut} style={{padding: 8}}>
        <Text style={{fontSize: 11, fontWeight: '800', color: colors.danger}}>{t('Sign out')}</Text>
      </TouchableOpacity>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{maxHeight: 58, flexGrow: 0, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border}} contentContainerStyle={{paddingHorizontal: 8, alignItems: 'center'}}>
      {nav.map(id => <TouchableOpacity key={id} onPress={() => {setSection(id); setExpanded('');}} style={{paddingVertical: 10, paddingHorizontal: 12, marginHorizontal: 3, borderRadius: 10, backgroundColor: section === id ? colors.primarySoft : 'transparent'}}>
        <Text style={{fontSize: 11, fontWeight: '800', color: section === id ? colors.primary : colors.inkMuted}}>{t(sectionName[id])}</Text>
      </TouchableOpacity>)}
    </ScrollView>
    {errors.length ? <View style={{padding: 11, backgroundColor: colors.dangerSoft}}><Text style={{fontSize: 11, color: colors.danger}}>{errors.join(' · ')}</Text></View> : null}
    <ScrollView contentContainerStyle={{padding: 14, paddingBottom: 34}}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 11}}>
        <Text style={{fontSize: 20, color: colors.ink, fontWeight: '900'}}>{t(sectionName[section])}</Text>
        <View style={{backgroundColor: colors.primarySoft, paddingVertical: 5, paddingHorizontal: 9, borderRadius: 12}}>
          <Text style={{fontSize: 9, color: colors.primary, fontWeight: '900'}}>{t('Read only').toUpperCase()}</Text>
        </View>
      </View>
      {loading ? <ActivityIndicator color={colors.primary} style={{margin: 20}}/> : sectionContent[section]()}
    </ScrollView>
  </View>;
}

const headingStyle = {fontSize: 14, color: colors.ink, fontWeight: '900' as const};
const bodyStyle = {fontSize: 11, color: colors.inkMuted, lineHeight: 17, marginTop: 5};
function Empty({language}: {language: ViewerLanguage}) {
  return <Card><Text style={{fontSize: 12, color: colors.inkMuted}}>{text(language, 'No records available yet.')}</Text></Card>;
}

export default function FamilyViewer({onOwnerLogin, onLanguageChange, onBeforeSignOut}: {
  onOwnerLogin?: () => void;
  onLanguageChange?: (value: ViewerLanguage) => void;
  onBeforeSignOut?: () => Promise<void>;
}) {
  const [accessMode, setAccessMode] = useState<'home' | 'sign-in' | 'sign-up'>('home');
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<ViewerAccessRequest | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [legacyViewer, setLegacyViewer] = useState(false);
  const [language, setLanguage] = useState<ViewerLanguage>(() => {
    try {
      return typeof window !== 'undefined'
        ? getPreferredLanguage(window.localStorage) || 'en'
        : 'en';
    } catch {
      return 'en';
    }
  });
  const [languageReady, setLanguageReady] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [mobileConfirmed, setMobileConfirmed] = useState(false);
  const [legacyCheckComplete, setLegacyCheckComplete] = useState(false);
  const [sheets, setSheets] = useState<SheetMap>({});
  const [sheetsLoading, setSheetsLoading] = useState(true);
  const [records, setRecords] = useState<Record<string, ProjectRecord[]>>({});
  const [recordLoaded, setRecordLoaded] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [ownerAccount, setOwnerAccount] = useState(false);

  useEffect(() => {
    const browserAuth = auth;
    if (!browserAuth || Platform.OS !== 'web') {
      setAuthReady(true);
      setLanguageReady(true);
      return;
    }
    let active = true;
    let stop = () => {};
    void setPersistence(browserAuth, browserLocalPersistence).then(() => {
      if (!active) return;
      setAuthReady(true);
      stop = onAuthStateChanged(browserAuth, next => {
        setUser(next);
        setAccess(null);
        setAccessChecked(!next);
        setLegacyViewer(false);
        setLegacyCheckComplete(!next);
        setOwnerAccount(false);
        setMobileConfirmed(false);
        setLanguageReady(!next);
      });
    }).catch(issue => {
      if (!active) return;
      setAuthError(issue?.message || 'Persistent browser authentication is unavailable.');
      setAuthReady(true);
      setLanguageReady(true);
    });
    return () => {active = false; stop();};
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    let active = true;
    setAccessChecked(false);
    const stop = subscribeViewerRequest(user.uid, request => {
      if (!active) return;
      setAccess(request);
      setLegacyViewer(false);
      setMobileConfirmed(request?.status === 'approved');
      const savedLanguage = request?.preferredLanguage;
      if (savedLanguage === 'en' || savedLanguage === 'ta') {
        setLanguage(savedLanguage);
        try {
          savePreferredLanguage(window.localStorage, savedLanguage);
          void AsyncStorage.setItem('ksk_app_language', savedLanguage).catch(issue => {
            setErrors(current => [...current, localizedError(issue, savedLanguage, 'Could not save your language preference.')]);
          });
        } catch (issue: any) {
          setErrors(current => [...current, localizedError(issue, savedLanguage, 'Could not save your language preference.')]);
        }
      }
      setAccessChecked(true);
      setLanguageReady(true);
      if (request?.status === 'revoked' || request?.status === 'rejected' || request?.status === 'pending') {
        setSheets({});
        setRecords({});
        setRecordLoaded({});
        setSheetsLoading(false);
      }
    }, issue => {
      if (!active) return;
      setErrors(current => [...current, issue.message]);
      setAccessChecked(true);
    });
    void Promise.all([
      getDoc(doc(db, 'users', user.uid)),
      getDoc(doc(db, 'viewerAccess', user.uid))
    ]).then(([membership, viewerRequest]) => {
      if (active && membership.exists() && membership.data()?.projectId === 'ksk' && membership.data()?.role === 'owner') {
        setOwnerAccount(true);
        setAccessChecked(true);
        setLegacyCheckComplete(true);
        setLanguageReady(true);
        return;
      }
      if (active && !viewerRequest.exists() && membership.exists() && membership.data()?.projectId === 'ksk' && membership.data()?.role === 'viewer') {
        setLegacyViewer(true);
        const savedLanguage = membership.data()?.preferredLanguage;
        if (savedLanguage === 'en' || savedLanguage === 'ta') {
          setLanguage(savedLanguage);
          try {
            savePreferredLanguage(window.localStorage, savedLanguage);
            void AsyncStorage.setItem('ksk_app_language', savedLanguage).catch(issue => {
              setErrors(current => [...current, localizedError(issue, savedLanguage, 'Could not save your language preference.')]);
            });
          } catch (issue: any) {
            setErrors(current => [...current, localizedError(issue, savedLanguage, 'Could not save your language preference.')]);
          }
        }
        setAccessChecked(true);
        setLegacyCheckComplete(true);
        setLanguageReady(true);
        return;
      }
      if (active) setLegacyCheckComplete(true);
    }).catch(() => {
      // Older viewer accounts may not be permitted to inspect membership.
      if (active) setLegacyCheckComplete(true);
    });
    return () => {active = false; stop();};
  }, [user?.uid]);

  const canRead = !!user && (legacyViewer || (access?.status === 'approved' && mobileConfirmed));
  useEffect(() => {
    if (!canRead || !user || !db) {
      setSheets({});
      setRecords({});
      setRecordLoaded({});
      setSheetsLoading(!accessChecked);
      return;
    }
    setSheetsLoading(true);
    const stops = [
      subscribeViewerSheets(remote => {setSheets(remote); setSheetsLoading(false);}, message => {
        setErrors(current => [...current, message]);
        setSheetsLoading(false);
      }),
      ...(['payments', 'contracts', 'stock', 'progress'] as const).map(type => subscribeProjectRecords(type, items => {
        setRecords(current => ({...current, [type]: items}));
        setRecordLoaded(current => ({...current, [type]: true}));
      }, message => {
        setErrors(current => [...current, message]);
        setRecordLoaded(current => ({...current, [type]: true}));
      }, user.uid))
    ];
    return () => stops.forEach(stop => stop());
  }, [canRead, user?.uid, accessChecked]);

  const changeLanguage = async (value: ViewerLanguage) => {
    setLanguage(value);
    onLanguageChange?.(value);
    try {
      savePreferredLanguage(window.localStorage, value);
      await AsyncStorage.setItem('ksk_app_language', value);
    } catch (issue: any) {
      setErrors(current => [...current, localizedError(issue, language, 'Could not save your language preference.')]);
      return;
    }
    if (!user) return;
    try {
      if (legacyViewer) await saveLegacyViewerLanguage(user.uid, value);
      else if (access) await saveViewerLanguage(user.uid, value);
    } catch (issue: any) {
      setErrors(current => [...current, localizedError(issue, language, 'Could not save your language preference.')]);
    }
  };

  const t = (english: string) => text(language, english);
  if (!isFirebaseConfigured || !auth || !db) return <View style={{flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.canvas}}>
    <Card><Text style={headingStyle}>KSK House Construction</Text><Text style={bodyStyle}>{t('Secure family access is unavailable. Contact the project owner.')}</Text></Card>
  </View>;
  const viewerAuth = auth;

  if (!authReady) return <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas}}><ActivityIndicator color={colors.primary}/></View>;
  if (authError) return <View style={{flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.canvas}}><Card><Text style={headingStyle}>{t('Secure browser storage is unavailable. Enable browser storage and reload to continue.')}</Text><Text style={bodyStyle}>{authError}</Text></Card></View>;
  if (!languageReady) return <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas}}><ActivityIndicator color={colors.primary}/></View>;
  if (user && accessMode === 'home' && (!accessChecked || !legacyCheckComplete)) return <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.canvas}}><ActivityIndicator color={colors.primary}/><Text style={bodyStyle}>{t('Loading project records…')}</Text></View>;
  if (ownerAccount) return <View style={{flex: 1, justifyContent: 'center', padding: 20, backgroundColor: colors.canvas}}>
    <Card><Text style={headingStyle}>{t('Family viewer')}</Text><Text style={bodyStyle}>{t('An owner account is currently signed in. Sign out, then create a family viewer access request.')}</Text><View style={{marginTop: 14}}><ActionButton label={t('Sign out')} onPress={() => void (async () => {
      try {
        await onBeforeSignOut?.();
        await signOut(viewerAuth);
      } catch (issue: any) {
        setErrors(current => [...current, localizedError(issue, language, 'Could not sign out securely.')]);
      }
    })()}/></View></Card>
  </View>;
  if (!user || (!mobileConfirmed && !legacyViewer)) {
    if (accessMode === 'home') return <AccessHome
      language={language}
      onLanguageChange={value => void changeLanguage(value)}
      onOwnerLogin={onOwnerLogin}
      onSignIn={() => setAccessMode('sign-in')}
      onSignUp={() => setAccessMode('sign-up')}
    />;
    return <AccessForm
      mode={accessMode}
      user={user}
      language={language}
      onLanguageChange={value => void changeLanguage(value)}
      onSignIn={setUser}
      onBack={() => setAccessMode('home')}
      onApproved={request => {
        setAccess(request);
        setAccessChecked(true);
        setMobileConfirmed(true);
      }}
      onOwnerLogin={onOwnerLogin}
    />;
  }

  return <FamilyData
    uid={user.uid}
    language={language}
    onLanguageChange={value => void changeLanguage(value)}
    onSignOut={() => {
      setMobileConfirmed(false);
      setAccessMode('home');
      void (async () => {
        try {
          await onBeforeSignOut?.();
          await signOut(viewerAuth);
        } catch (issue: any) {
          setErrors(current => [...current, localizedError(issue, language, 'Could not sign out securely.')]);
        }
      })();
    }}
    sheets={sheets}
    records={records}
    loading={sheetsLoading || !(['payments', 'contracts', 'stock', 'progress'] as const).every(type => recordLoaded[type])}
    errors={errors}
  />;
}
