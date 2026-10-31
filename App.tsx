import React, {useEffect, useMemo, useState} from 'react';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StatusBar, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import {Picker} from '@react-native-picker/picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import {SafeAreaView} from 'react-native-safe-area-context';
import {onAuthStateChanged, signInWithEmailAndPassword, signOut, User} from 'firebase/auth';
import {collection, doc, getDoc, onSnapshot} from 'firebase/firestore';
import BillAttachments from './src/components/BillAttachments';
import {auth, db, isFirebaseConfigured} from './src/firebase';
import {LOCAL_WORKBOOK, SHEET_ORDER, SHEET_TITLES, ICONS, headersForSheet, meaningfulRows, displayCell, excelSerialToDate, dateToExcelSerial} from './src/data';
import {calculateDashboard, calculateFloorSummary, countMaterials} from './src/services/calculations';
import {enableNotifications, showActivityNotification} from './src/services/notifications';
import {saveSheet, seedWorkbook, subscribeActivities, subscribeSheets, ensureQuoteSheet, ensureSheetRecordIds, clearActivityHistory} from './src/services/projectSync';
import {ActivityItem, Role, SheetDocument, SheetMap} from './src/types';
import ProjectRecords from './src/components/ProjectRecords';

const C = {
  ink: '#17302D', muted: '#6F817C', green: '#1C6255', green2: '#E6F1EC',
  mint: '#D9E9E1', paper: '#F5F7F4', white: '#FFFFFF', line: '#E2E9E5',
  gold: '#C58D3D', goldBg: '#FAF1E1', red: '#B64D43', redBg: '#F9E8E6',
  dark: '#112B28', blueBg: '#EAF0F7'
};

const money = (value: number) => `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
const n = (v: any) => Number(v) || 0;
const isBlank = (v: any) => v === null || v === undefined || v === '';

function dateCell(value: any) {
  const iso = excelSerialToDate(value);
  if (!iso) return '';
  const [y,m,d] = iso.slice(0,10).split('-');
  return `${d}/${m}/${y}`;
}

function isDateHeader(header: string) {
  return /date|start|finish|needed|due/i.test(header || '');
}

function datePickerValue(value: any): Date {
  const text = String(value || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  }
  const parsed = new Date(text);
  return !Number.isNaN(parsed.getTime()) ? parsed : new Date();
}

function formatPickerDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isMoneyHeader(header: string) {
  return /amount|cost|rate|fee|budget|paid|balance|₹/i.test(header || '');
}

function pretty(value: any, header = ''): string {
  if (isBlank(value)) return '—';
  if (isDateHeader(header) && (typeof value === 'number' || /^\d{4}-\d{2}-\d{2}/.test(String(value)))) return dateCell(value) || String(value);
  if (isMoneyHeader(header) && typeof value === 'number') return money(value);
  if (typeof value === 'number') return Number.isInteger(value) ? value.toLocaleString('en-IN') : value.toFixed(2);
  return String(value);
}

function cardStyle(extra: any = {}) { return {backgroundColor: C.white, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.line, ...extra}; }
function buttonStyle(disabled = false, secondary = false) {
  return {backgroundColor: disabled ? '#DCE4DF' : secondary ? C.green2 : C.green, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 15, alignItems: 'center' as const, justifyContent: 'center' as const};
}

function Pill({children, color = C.green2, textColor = C.green}: any) {
  return <View style={{backgroundColor: color, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5}}><Text style={{fontSize: 11, fontWeight: '800', color: textColor}}>{children}</Text></View>;
}

function SectionTitle({title, right, onRight}: any) {
  return <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12}}>
    <Text style={{fontSize: 17, fontWeight: '800', color: C.ink}}>{title}</Text>
    {right ? <TouchableOpacity onPress={onRight}><Text style={{color: C.green, fontWeight: '800', fontSize: 12}}>{right}</Text></TouchableOpacity> : null}
  </View>;
}

function LoginScreen({onLogin, demo}: {onLogin: (email: string, password: string) => void; demo?: () => void}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  return <SafeAreaView style={{flex: 1, backgroundColor: C.paper}}>
    <StatusBar barStyle="dark-content" />
    <ScrollView contentContainerStyle={{flexGrow: 1, justifyContent: 'center', padding: 24}}>
      <View style={{alignSelf: 'center', width: 72, height: 72, borderRadius: 22, backgroundColor: C.dark, alignItems: 'center', justifyContent: 'center', marginBottom: 20}}>
        <Text style={{fontSize: 25, color: '#FFFFFF', fontWeight: '900', letterSpacing: 1}}>KSK</Text>
      </View>
      <Text style={{fontSize: 28, fontWeight: '900', textAlign: 'center', color: C.ink}}>KSK House</Text>
      <Text style={{fontSize: 14, textAlign: 'center', color: C.muted, marginTop: 7, marginBottom: 28}}>Construction manager · Thuvar</Text>
      <View style={cardStyle()}>
        {!isFirebaseConfigured ? <>
          <Pill color={C.goldBg} textColor={C.gold}>LOCAL PREVIEW</Pill>
          <Text style={{fontSize: 19, fontWeight: '800', color: C.ink, marginTop: 14}}>Cloud connection not set up</Text>
          <Text style={{fontSize: 13, lineHeight: 20, color: C.muted, marginTop: 7}}>The workbook data is bundled in this app project. Add your Firebase project settings and deploy the access rules to enable account sign-in, live sync and father’s read-only access.</Text>
          <Text style={{fontSize: 12, fontWeight: '700', color: C.ink, marginTop: 18}}>Firebase setup is described in README.md.</Text>
        </> : <>
          <Text style={{fontSize: 18, fontWeight: '800', color: C.ink, marginBottom: 14}}>Sign in to your project</Text>
          <Text style={{fontSize: 12, fontWeight: '700', color: C.muted, marginBottom: 6}}>EMAIL</Text>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor="#9AA8A2" style={{backgroundColor: C.paper, borderRadius: 11, borderWidth: 1, borderColor: C.line, padding: 13, color: C.ink, marginBottom: 13}} />
          <Text style={{fontSize: 12, fontWeight: '700', color: C.muted, marginBottom: 6}}>PASSWORD</Text>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry={!showPassword} placeholder="Enter password" placeholderTextColor="#9AA8A2" style={{backgroundColor: C.paper, borderRadius: 11, borderWidth: 1, borderColor: C.line, padding: 13, color: C.ink, marginBottom: 15}} />
          <TouchableOpacity disabled={loading || !email || !password} onPress={async () => {setLoading(true); await onLogin(email.trim(), password); setLoading(false);}} style={buttonStyle(loading || !email || !password)}>
            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={{color: '#FFF', fontWeight: '800'}}>Sign in securely</Text>}
          </TouchableOpacity>
          <Text style={{fontSize: 11, color: C.muted, textAlign: 'center', marginTop: 13}}>Your role is assigned by the project administrator. Only the owner account can edit construction data.</Text>
        </>}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

function MetricCard({label, value, helper, accent = false}: any) {
  return <View style={cardStyle({flex: 1, minWidth: 145, padding: 15, backgroundColor: accent ? C.dark : C.white, borderColor: accent ? C.dark : C.line})}>
    <Text style={{fontSize: 11, color: accent ? '#C7DAD2' : C.muted, fontWeight: '700'}}>{label.toUpperCase()}</Text>
    <Text style={{fontSize: 22, color: accent ? '#FFFFFF' : C.ink, fontWeight: '900', marginTop: 8}}>{value}</Text>
    {helper ? <Text style={{fontSize: 11, color: accent ? '#C7DAD2' : C.muted, marginTop: 5}}>{helper}</Text> : null}
  </View>;
}


function Dashboard({sheets, activities, role, syncLabel, onOpen, onAddExpense, language}: any) {
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;

  const stats = calculateDashboard(sheets);
  const setup = sheets.project_setup?.values || [];
  const project = setup?.[1]?.[1] || 'KSK';
  const location = setup?.[2]?.[1] || 'Thuvar';
  const builtUp = n(setup?.[4]?.[1]) + n(setup?.[5]?.[1]);
  const materialStats = countMaterials(sheets);
  const pctSpent = stats.totalBudget > 0 ? Math.min(100, stats.totalPaid / stats.totalBudget * 100) : 0;

  const translatedSync = language === 'ta'
    ? ({
        'LIVE SYNC': 'நேரடி ஒத்திசைவு',
        'SAVING': 'சேமிக்கிறது',
        'PREVIEW': 'முன்னோட்டம்',
        'LOCAL PREVIEW': 'உள்ளூர் முன்னோட்டம்',
        'SYNC ERROR': 'ஒத்திசைவு பிழை',
        'CONNECTING': 'இணைக்கிறது'
      } as Record<string, string>)[syncLabel] || syncLabel
    : syncLabel;

  return <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 30}}>
    <View style={{backgroundColor: C.dark, borderRadius: 22, padding: 19, marginBottom: 15}}>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
        <View>
          <Text style={{color: '#BBD1C8', fontSize: 11, fontWeight: '800', letterSpacing: 1}}>
            {t('HOUSE CONSTRUCTION', 'வீடு கட்டுமானம்')}
          </Text>
          <Text style={{color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 5}}>
            {project} {t('Project', 'திட்டம்')}
          </Text>
          <Text style={{color: '#D0E0D9', fontSize: 13, marginTop: 4}}>
            {location} · {builtUp.toLocaleString('en-IN')} {t('sq ft', 'சதுர அடி')} · {t('G + 1', 'தரை + முதல் தளம்')}
          </Text>
        </View>
        <View style={{width: 52, height: 52, borderRadius: 17, backgroundColor: '#274C45', alignItems: 'center', justifyContent: 'center'}}>
          <Text style={{color: '#FFF', fontSize: 17, fontWeight: '900'}}>KSK</Text>
        </View>
      </View>

      <View style={{marginTop: 18, borderTopColor: '#31564F', borderTopWidth: 1, paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
          <View style={{width: 7, height: 7, borderRadius: 5, backgroundColor: syncLabel === 'LIVE SYNC' ? '#6DD3A5' : '#E8B968'}}/>
          <Text style={{color: '#D0E0D9', fontSize: 11, fontWeight: '800'}}>{translatedSync}</Text>
        </View>
        <Pill color={role === 'owner' ? '#D8EBE1' : '#EAF0F7'} textColor={role === 'owner' ? '#1C6255' : '#365775'}>
          {role === 'owner'
            ? t('OWNER · EDITOR', 'உரிமையாளர் · திருத்துபவர்')
            : role === 'viewer'
              ? t('FAMILY · VIEW ONLY', 'குடும்பம் · பார்வைக்கு மட்டும்')
              : t('LOCAL PREVIEW', 'உள்ளூர் முன்னோட்டம்')}
        </Pill>
      </View>
    </View>

    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 15}}>
      <MetricCard label={t('Estimated budget', 'மதிப்பிடப்பட்ட பட்ஜெட்')} value={money(stats.totalBudget)} helper={`${t('Includes', 'இதில்')} ${money(stats.contingency)} ${t('contingency', 'எதிர்பாராத செலவு')}`} accent />
      <MetricCard label={t('Paid so far', 'இதுவரை செலுத்தியது')} value={money(stats.totalPaid)} helper={`${pctSpent.toFixed(1)}% ${t('of total budget', 'மொத்த பட்ஜெட்டில்')}`} />
      <MetricCard label={t('Balance budget', 'மீதமுள்ள பட்ஜெட்')} value={money(stats.totalRemaining)} helper={t('Budget remaining', 'மீதமுள்ள தொகை')} />
      <MetricCard label={t('Construction progress', 'கட்டுமான முன்னேற்றம்')} value={`${Math.round(stats.progress)}%`} helper={t('Average across scheduled activities', 'திட்டமிட்ட பணிகளின் சராசரி')} />
    </View>

    <View style={cardStyle({marginBottom: 14})}>
      <SectionTitle title={t('Budget utilisation', 'பட்ஜெட் பயன்பாடு')} right={t('View breakdown', 'விரிவாகப் பார்க்க')} onRight={() => onOpen('floor_summary')} />
      <View style={{height: 10, backgroundColor: '#EAF0EC', borderRadius: 8, overflow: 'hidden'}}>
        <View style={{height: 10, width: `${pctSpent}%`, backgroundColor: C.green, borderRadius: 8}} />
      </View>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 10}}>
        <Text style={{fontSize: 11, color: C.muted}}>{t('Paid', 'செலுத்தியது')} {money(stats.totalPaid)}</Text>
        <Text style={{fontSize: 11, color: C.muted}}>{t('Budget', 'பட்ஜெட்')} {money(stats.totalBudget)}</Text>
      </View>
      <View style={{marginTop: 14, gap: 10}}>
        {[
          [t('Materials', 'பொருட்கள்'), stats.materialsBudget, stats.materialsPaid],
          [t('Labour & subcontractors', 'தொழிலாளர்கள் மற்றும் துணை ஒப்பந்ததாரர்கள்'), stats.labourBudget, stats.labourPaid],
          [t('Engineer / professional fees', 'பொறியாளர் / தொழில்முறை கட்டணங்கள்'), stats.feesBudget, stats.feesPaid],
          [t('Equipment & misc.', 'உபகரணங்கள் மற்றும் இதர செலவுகள்'), stats.miscBudget, stats.miscPaid]
        ].map(([label, budget, paid]: any) => <View key={label}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4}}>
            <Text style={{fontSize: 12, color: C.ink, fontWeight: '700'}}>{label}</Text>
            <Text style={{fontSize: 12, color: C.muted}}>{money(paid)} / {money(budget)}</Text>
          </View>
          <View style={{height: 5, backgroundColor: '#EEF2EF', borderRadius: 5}}>
            <View style={{height: 5, width: `${budget ? Math.min(100, paid / budget * 100) : 0}%`, backgroundColor: C.green, borderRadius: 5}}/>
          </View>
        </View>)}
      </View>
    </View>

    <View style={{flexDirection: 'row', gap: 10, marginBottom: 14}}>
      <View style={cardStyle({flex: 1})}>
        <Text style={{fontSize: 11, color: C.muted, fontWeight: '700'}}>{t('MATERIAL STOCK LINES', 'பொருள் இருப்புப் பதிவுகள்')}</Text>
        <Text style={{fontSize: 24, fontWeight: '900', color: C.ink, marginTop: 8}}>{materialStats.stockLines}</Text>
        <Text style={{fontSize: 11, color: C.muted, marginTop: 4}}>{materialStats.received.toLocaleString('en-IN')} {t('received units logged', 'பெறப்பட்ட அலகுகள் பதிவு செய்யப்பட்டுள்ளன')}</Text>
      </View>
      <View style={cardStyle({flex: 1})}>
        <Text style={{fontSize: 11, color: C.muted, fontWeight: '700'}}>{t('DAILY EXPENSES', 'தினசரி செலவுகள்')}</Text>
        <Text style={{fontSize: 24, fontWeight: '900', color: C.ink, marginTop: 8}}>{money(stats.dailyExpenses)}</Text>
        <Text style={{fontSize: 11, color: C.muted, marginTop: 4}}>
          {t('Across', 'மொத்தம்')} {meaningfulRows(sheets.daily_expenses || {values: [], formulas: [], name: '', range: ''}).length} {t('payment entries', 'கட்டணப் பதிவுகள்')}
        </Text>
      </View>
    </View>

    <View style={cardStyle({marginBottom: 14})}>
      <SectionTitle title={t('Quick actions', 'விரைவான செயல்கள்')} />
      <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 9}}>
        <TouchableOpacity onPress={onAddExpense} style={{...buttonStyle(role !== 'owner'), width: '48%', minHeight: 46, opacity: role === 'owner' ? 1 : 0.55}}>
          <Text style={{fontWeight: '800', color: '#FFF'}}>＋ {t('Add expense', 'செலவைச் சேர்')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onOpen('materials_boq')} style={{...buttonStyle(false, true), width: '48%', minHeight: 46}}>
          <Text style={{fontWeight: '800', color: C.green}}>▤ {t('Materials', 'பொருட்கள்')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onOpen('labour_work')} style={{...buttonStyle(false, true), width: '48%', minHeight: 46}}>
          <Text style={{fontWeight: '800', color: C.green}}>♧ {t('Labour', 'தொழிலாளர்கள்')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onOpen('professional_fees')} style={{...buttonStyle(false, true), width: '48%', minHeight: 46}}>
          <Text style={{fontWeight: '800', color: C.green}}>▣ {t('Professional fees', 'தொழில்முறை கட்டணங்கள்')}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onOpen('work_schedule')} style={{...buttonStyle(false, true), width: '48%', minHeight: 46}}>
          <Text style={{fontWeight: '800', color: C.green}}>◷ {t('Work progress', 'வேலை முன்னேற்றம்')}</Text>
        </TouchableOpacity>
      </View>
    </View>

    <View style={cardStyle({marginBottom: 14, paddingVertical: 13})}>
      <SectionTitle title={t('Recent project updates', 'சமீபத்திய திட்டப் புதுப்பிப்புகள்')} />
      {activities.length ? activities.slice(0, 3).map((item: ActivityItem) => <View key={item.id} style={{paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line}}>
        <Text style={{fontSize: 12, fontWeight: '800', color: C.ink}}>{item.title || t('Project updated', 'திட்டம் புதுப்பிக்கப்பட்டது')}</Text>
        <Text style={{fontSize: 11, color: C.muted, marginTop: 3}}>{item.body || t('Workbook data changed', 'பணிப்புத்தகத் தரவு மாற்றப்பட்டது')}</Text>
      </View>) : <Text style={{fontSize: 12, color: C.muted}}>{t('Updates will appear here after cloud sync is connected.', 'கிளவுட் ஒத்திசைப்பு இணைக்கப்பட்டதும் புதுப்பிப்புகள் இங்கே தோன்றும்.')}</Text>}
    </View>
  </ScrollView>;
}


function SheetMenu({onOpen, language}: any) {
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;
  return <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 35}}>
    <Text style={{fontSize: 13, color: C.muted, lineHeight: 19, marginBottom: 15}}>{t('All 11 tabs from the workbook are available here. Quote comparison is added as a separate module because it is referenced in the workbook instructions but not present as an Excel tab.', 'பணிப்புத்தகத்தில் உள்ள 11 தாவல்களும் இங்கே கிடைக்கும். மேற்கோள் ஒப்பீடு தனிப் பகுதியாகச் சேர்க்கப்பட்டுள்ளது.')}</Text>
    <View style={{gap: 9}}>
      {[...SHEET_ORDER, 'quotation_compare'].map(id => <TouchableOpacity key={id} onPress={() => onOpen(id)} style={{...cardStyle({padding: 15}), flexDirection: 'row', alignItems: 'center'}}>
        <View style={{width: 42, height: 42, borderRadius: 14, backgroundColor: C.green2, alignItems: 'center', justifyContent: 'center', marginRight: 13}}><Text style={{fontSize: 20, color: C.green, fontWeight: '800'}}>{ICONS[id]}</Text></View>
        <View style={{flex: 1}}><Text style={{fontSize: 14, fontWeight: '800', color: C.ink}}>{SHEET_TITLES[id]}</Text><Text style={{fontSize: 11, color: C.muted, marginTop: 3}}>{id === 'quotation_compare' ? t('Compare up to three supplier quotations', 'மூன்று சப்ளையர்களின் விலைப்புள்ளிகளை ஒப்பிடவும்') : t('Open worksheet and manage records', 'பணித்தாளைத் திறந்து பதிவுகளை நிர்வகிக்கவும்')}</Text></View>
        <Text style={{fontSize: 20, color: C.muted}}>›</Text>
      </TouchableOpacity>)}
    </View>
  </ScrollView>;
}

function titleIndex(headers: string[], candidates: string[]) {
  return headers.findIndex(h => candidates.some(c => h.toLowerCase().includes(c)));
}

function RecordCard({sheetId, sheet, row, rowIndex, recordId, canEdit, canDelete, onEdit, onDelete, language}: any) {
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;
  const headers = headersForSheet(sheetId, sheet);
  const primaryIndex = titleIndex(headers, ['material / item', 'item / description', 'construction activity', 'service / fee head', 'expense / equipment', 'labour / contractor work', 'cost head', 'setting']);
  const primary = primaryIndex >= 0 ? displayCell(sheetId, sheet, rowIndex, primaryIndex) : row.find((v: any) => !isBlank(v));
  const amountIndex = sheetId === 'daily_expenses' ? headers.findIndex(h => /amount\s*paid/i.test(h)) : -1;
  const subIndices = headers.map((h, i) => ({h, i})).filter(x => x.i !== primaryIndex && x.i !== amountIndex && x.h && !/notes|receipt|supplier|brand|vendor|contractor|person|payment/i.test(x.h)).slice(0, 3);
  const info = [
    ...(amountIndex >= 0 ? [`${headers[amountIndex]}: ${pretty(displayCell(sheetId, sheet, rowIndex, amountIndex), headers[amountIndex])}`] : []),
    ...subIndices.map(x => {
      const value = displayCell(sheetId, sheet, rowIndex, x.i);
      return !isBlank(value) ? `${x.h}: ${pretty(value, x.h)}` : '';
    })
  ].filter(Boolean);
  const formulaCount = (sheet.formulas?.[rowIndex] || []).filter(Boolean).length;
  return <View style={cardStyle({padding: 14, marginBottom: 9})}>
    <View style={{flexDirection: 'row', alignItems: 'flex-start'}}>
      <View style={{flex: 1}}>
        <Text style={{fontSize: 14, color: C.ink, fontWeight: '800'}}>{String(primary || t('Untitled record', 'பெயரிடப்படாத பதிவு'))}</Text>
        {info.slice(0, 2).map((item, i) => <Text key={i} style={{fontSize: 11, color: C.muted, marginTop: 4}}>{item}</Text>)}
      </View>
      {canEdit ? <View style={{flexDirection: 'row', gap: 6}}>
        <TouchableOpacity onPress={() => onEdit(rowIndex)} style={{paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: C.green2}}><Text style={{fontSize: 11, color: C.green, fontWeight: '800'}}>{t('Edit', 'திருத்து')}</Text></TouchableOpacity>
        {canDelete ? <TouchableOpacity onPress={() => onDelete(rowIndex)} style={{paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: '#FDECEC'}}><Text style={{fontSize: 11, color: '#B42318', fontWeight: '800'}}>{t('Delete', 'நீக்கு')}</Text></TouchableOpacity> : null}
      </View> : <Pill color={C.blueBg} textColor="#365775">{t('VIEW', 'பார்வை')}</Pill>}
    </View>
    {info.length > 2 || formulaCount ? <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10}}>
      {info.slice(2).map((item, i) => <Pill key={i}>{item}</Pill>)}
      {formulaCount ? <Pill color={C.goldBg} textColor={C.gold}>{language === 'ta' ? `${formulaCount} கணக்கீட்டு புலங்கள்` : `${formulaCount} formula field${formulaCount > 1 ? 's' : ''}`}</Pill> : null}
    </View> : null}
    {sheetId === 'daily_expenses' && recordId && db ? (
      <BillAttachments recordId={recordId} canEdit={canEdit} language={language}/>
    ) : null}
  </View>;
}

function SheetView({sheetId, sheet, allSheets, role, onBack, onEdit, onAdd, onDelete, language}: any) {
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;
  const [searchText, setSearchText] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [filterDateTarget, setFilterDateTarget] = useState<'dateFrom' | 'dateTo' | null>(null);

  if (!sheet) return <View style={{padding: 24}}><Text style={{color: C.muted}}>{language === 'ta' ? 'இந்தப் பணித்தாள் இன்னும் கிளவுடில் இல்லை. உரிமையாளர் அமைப்புகளில் இருந்து பணிப்புத்தகத்தைத் தொடங்கலாம்.' : 'This sheet is not available in the cloud yet. The owner can initialise the workbook from Settings.'}</Text></View>;

  const headers = headersForSheet(sheetId, sheet);
  const readOnly = role !== 'owner' || ['project_dashboard', 'floor_summary'].includes(sheetId);
  const records = ['project_dashboard', 'floor_summary'].includes(sheetId) ? [] : meaningfulRows(sheet);
  const title = SHEET_TITLES[sheetId] || sheet.name;
  const isDailyExpenses = sheetId === 'daily_expenses';
  const isSummary = ['project_dashboard', 'floor_summary'].includes(sheetId);

  const columnIndex = (name: string) => headers.findIndex((h: string) => h?.toLowerCase() === name.toLowerCase());
  const dateIndex = columnIndex('Date');

  const filterFields = headers
    .filter((header: string) => header && /floor|area|stage|status|unit|category|payment mode|paid by|bill received|supplier|contractor|responsible person|construction activity|work type|specification/i.test(header))
    .map((header: string) => ({key: header, label: header, header}));

  const getOptions = (header: string) => {
    const index = columnIndex(header);
    if (index < 0) return [];
    return Array.from(new Set(records.map(({row}: any) => String(row[index] ?? '').trim()).filter(Boolean))).sort();
  };

  const filteredRecords = records.filter(({row}: any) => {
    const query = searchText.trim().toLowerCase();
    if (query) {
      const searchableText = row.map((value: any) => String(value ?? '')).join(' ').toLowerCase();
      if (!searchableText.includes(query)) return false;
    }

    for (const field of filterFields) {
      const selected = filters[field.key];
      const index = columnIndex(field.header);
      if (selected && index >= 0 && String(row[index] ?? '') !== selected) return false;
    }

    if (filters.dateFrom || filters.dateTo) {
      const date = dateIndex >= 0 ? excelSerialToDate(row[dateIndex]) : '';
      if (!date || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return false;
      if (filters.dateFrom && date < filters.dateFrom) return false;
      if (filters.dateTo && date > filters.dateTo) return false;
    }

    return true;
  });

  const clearFilters = () => {
    setFilters({});
    setSearchText('');
  };

  return <View style={{flex: 1}}>
    <View style={{paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
      <TouchableOpacity onPress={onBack} style={{padding: 8, marginLeft: -8}}><Text style={{fontSize: 14, color: C.green, fontWeight: '800'}}>{t('‹ All sheets', '‹ அனைத்து பணித்தாள்களும்')}</Text></TouchableOpacity>
      {!readOnly ? <TouchableOpacity onPress={onAdd} style={{...buttonStyle(), paddingVertical: 9}}><Text style={{fontSize: 12, color: '#FFF', fontWeight: '800'}}>{t('＋ Add record', '＋ பதிவு சேர்')}</Text></TouchableOpacity> : <Pill color={C.blueBg} textColor="#365775">{t('READ ONLY', 'படிக்க மட்டும்')}</Pill>}
    </View>
    <ScrollView contentContainerStyle={{paddingHorizontal: 16, paddingBottom: 30}}>
      <View style={cardStyle({marginBottom: 13, padding: 14})}>
        <Text style={{fontSize: 18, fontWeight: '900', color: C.ink}}>{title}</Text>
        <Text style={{fontSize: 11, color: C.muted, marginTop: 4}}>{language === 'ta' ? (!isSummary ? `${filteredRecords.length} / ${records.length} பதிவுகள் காட்டப்படுகின்றன` : `${records.length} பதிவுகள்`) : (!isSummary ? `${filteredRecords.length} of ${records.length} records shown` : `${records.length} populated record${records.length === 1 ? '' : 's'}`)} · {t('Imported from KSK_House_Cost.xlsx', 'KSK_House_Cost.xlsx இலிருந்து இறக்குமதி செய்யப்பட்டது')}</Text>
        {sheetId === 'project_setup' ? <Text style={{fontSize: 11, color: C.muted, marginTop: 6}}>{t('Select a setting row to edit its value or notes.', 'அதன் மதிப்பு அல்லது குறிப்புகளைத் திருத்த ஒரு அமைப்பு வரியைத் தேர்ந்தெடுக்கவும்.')}</Text> : null}
        {sheetId === 'project_dashboard' ? <DashboardFormulaSummary stats={calculateDashboard(allSheets || {})} language={language} /> : null}
        {sheetId === 'floor_summary' ? <FloorSummaryBlock sheets={allSheets || {}} language={language} /> : null}
      </View>

      {!isSummary ? <>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9}}>
          <View style={{flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 11, paddingHorizontal: 12}}>
            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder={language === "ta" ? `${title} தேடுக...` : `Search ${title.toLowerCase()}...`}
              placeholderTextColor={C.muted}
              style={{fontSize: 13, color: C.ink, paddingVertical: 11}}
              autoCapitalize="none"
            />
          </View>
          <TouchableOpacity onPress={() => setShowFilters(value => !value)} style={{backgroundColor: C.green2, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 13}}>
            <Text style={{fontSize: 12, color: C.green, fontWeight: '800'}}>{showFilters ? t('Hide filters', 'வடிகட்டிகளை மறை') : t('⚙ Filters', '⚙ வடிகட்டிகள்')}</Text>
          </TouchableOpacity>
        </View>

        {showFilters ? <View style={cardStyle({padding: 13, marginBottom: 12})}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8}}>
            <Text style={{fontSize: 13, color: C.ink, fontWeight: '800'}}>{t('Filter', 'வடிகட்டு')} {title}</Text>
            <TouchableOpacity onPress={clearFilters}><Text style={{fontSize: 11, color: C.green, fontWeight: '800'}}>{t('Clear all', 'அனைத்தையும் அழி')}</Text></TouchableOpacity>
          </View>
          {filterFields.map(field => <View key={field.key} style={{marginBottom: 9}}>
            <Text style={{fontSize: 11, color: C.muted, fontWeight: '700', marginBottom: 4}}>{field.label}</Text>
            <View style={{backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: 'hidden'}}>
              <Picker
                selectedValue={filters[field.key] || ''}
                onValueChange={value => setFilters(previous => ({...previous, [field.key]: value}))}
                style={{color: C.ink}}
              >
                <Picker.Item label={language === 'ta' ? `அனைத்தும்: ${field.label}` : `All ${field.label}`} value="" />
                {getOptions(field.header).map(option => <Picker.Item key={option} label={option} value={option} />)}
              </Picker>
            </View>
          </View>)}
          {dateIndex >= 0 ? <>
            <Text style={{fontSize: 11, color: C.muted, fontWeight: '700', marginBottom: 5}}>{t('Date range (YYYY-MM-DD)', 'தேதி வரம்பு (YYYY-MM-DD)')}</Text>
            <View style={{flexDirection: 'row', gap: 8}}>
              {(['dateFrom', 'dateTo'] as const).map(key => (
                <TouchableOpacity
                  key={key}
                  onPress={() => setFilterDateTarget(key)}
                  style={{flex: 1, backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 12}}
                >
                  <Text style={{fontSize: 12, color: filters[key] ? C.ink : C.muted}}>
                    {filters[key] || (key === 'dateFrom' ? t('From date', 'தொடக்க தேதி') : t('To date', 'முடிவு தேதி'))}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {filterDateTarget ? (
              <DateTimePicker
                value={datePickerValue(filters[filterDateTarget])}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={(event, selectedDate) => {
                  if (event.type === 'set' && selectedDate) {
                    setFilters(previous => ({...previous, [filterDateTarget]: formatPickerDate(selectedDate)}));
                  }
                  if (Platform.OS === 'android' || event.type === 'dismissed') {
                    setFilterDateTarget(null);
                  }
                }}
              />
            ) : null}
          </> : null}
        </View> : null}
      </> : null}

      {filteredRecords.length ? filteredRecords.map(({row, index}: any) => <RecordCard key={`${sheetId}-${index}`} language={language} sheetId={sheetId} sheet={sheet} row={row} rowIndex={index} recordId={sheet.recordIds?.[index]} canEdit={!readOnly} canDelete={!readOnly && ['daily_expenses', 'materials_ground', 'materials_first', 'materials_boq', 'work_schedule', 'labour_work'].includes(sheetId)} onEdit={onEdit} onDelete={onDelete} />) : !['project_dashboard', 'floor_summary'].includes(sheetId) ? <View style={cardStyle()}><Text style={{color: C.muted, fontSize: 13}}>{searchText || Object.values(filters).some(Boolean) ? t('No records match your search or filters.', 'உங்கள் தேடல் அல்லது வடிகட்டிகளுக்குப் பொருத்தமான பதிவுகள் இல்லை.') : t('No records entered yet.', 'இதுவரை பதிவுகள் எதுவும் சேர்க்கப்படவில்லை.')}</Text></View> : null}
    </ScrollView>
  </View>;
}
function DashboardFormulaSummary({stats, language}: any) {
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;
  const cells = [
    ['Materials', stats.materialsBudget, stats.materialsPaid],
    ['Labour & subcontractors', stats.labourBudget, stats.labourPaid],
    ['Professional fees', stats.feesBudget, stats.feesPaid],
    ['Equipment & misc.', stats.miscBudget, stats.miscPaid],
    ['Contingency', stats.contingency, 0],
    ['TOTAL', stats.totalBudget, stats.totalPaid]
  ];
  return <View style={{marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, gap: 8}}>
    <View style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{fontSize:10,color:C.muted,fontWeight:'800',flex:1}}>{t('COST HEAD', 'செலவுத் தலைப்பு')}</Text><Text style={{fontSize:10,color:C.muted,fontWeight:'800',width:88,textAlign:'right'}}>{t('BUDGET', 'பட்ஜெட்')}</Text><Text style={{fontSize:10,color:C.muted,fontWeight:'800',width:88,textAlign:'right'}}>{t('PAID', 'செலுத்தியது')}</Text></View>
    {cells.map(([label,budget,paid]: any) => <View key={label} style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><Text style={{fontSize:11,color:C.ink,fontWeight:label === 'TOTAL' ? '900' : '600',flex:1}}>{language === 'ta' ? ({Materials:'பொருட்கள்', 'Labour & subcontractors':'தொழிலாளர் மற்றும் ஒப்பந்ததாரர்கள்', 'Professional fees':'நிபுணர் கட்டணம்', 'Equipment & misc.':'உபகரணங்கள் மற்றும் இதர செலவுகள்', Contingency:'எதிர்பாராத செலவு', TOTAL:'மொத்தம்'} as Record<string, string>)[label] || label : label}</Text><Text style={{fontSize:11,color:C.ink,fontWeight:'800',width:88,textAlign:'right'}}>{money(budget)}</Text><Text style={{fontSize:11,color:C.green,fontWeight:'800',width:88,textAlign:'right'}}>{money(paid)}</Text></View>)}
    <Text style={{fontSize:10,color:C.muted}}>{t('Daily expense ledger', 'தினசரி செலவுப் பதிவு')}: {money(stats.dailyExpenses)} · {t('Remaining budget', 'மீதமுள்ள பட்ஜெட்')}: {money(stats.totalRemaining)}</Text>
  </View>;
}

function FloorSummaryBlock({sheets, language}: any) {
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;
  const values = calculateFloorSummary(sheets);
  return <View style={{marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, gap: 8}}>{values.map(item => <View key={item.floor} style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}><View style={{flex: 1}}><Text style={{fontSize: 12, color: C.ink, fontWeight: '800'}}>{item.floor}</Text><Text style={{fontSize: 10, color: C.muted, marginTop: 2}}>{t('Materials', 'பொருட்கள்')} {money(item.materials)} · {t('Labour', 'தொழிலாளர்')} {money(item.labour)}</Text></View><Text style={{fontSize: 12, color: C.ink, fontWeight: '900'}}>{money(item.total)}</Text></View>)}</View>;
}

function RowEditor({visible, sheetId, sheet, allSheets, rowIndex, isNew, onClose, onSave, language}: any) {
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;
  const headers = headersForSheet(sheetId, sheet || {values: [[]]});
  const [values, setValues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [datePickerIndex, setDatePickerIndex] = useState<number | null>(null);
  useEffect(() => {
    if (!visible || !sheet || rowIndex === null) return;
    setValues(headers.map((h: string, i: number) => {
      const v = displayCell(sheetId, sheet, rowIndex, i);
      if (isDateHeader(h) && !isBlank(v)) return excelSerialToDate(v) || String(v);
      return isBlank(v) ? '' : String(v);
    }));
  }, [visible, sheetId, rowIndex, sheet]);

  const save = async () => {
    setSaving(true);
    try {
      const next = {...sheet, values: sheet.values.map((r: any[]) => [...r]), formulas: sheet.formulas.map((r: any[]) => [...r])};
      const row = next.values[rowIndex] || [];
      values.forEach((v, i) => {
        const formula = next.formulas?.[rowIndex]?.[i];
        if (formula) return; // keep workbook formula cells intact
        const h = headers[i] || '';
        if (isDateHeader(h) && v) row[i] = dateToExcelSerial(v);
        else if (v.trim() === '') row[i] = null;
        else if (/qty|rate|amount|paid|balance|complete|duration|delay|contingency|area|%|fee/i.test(h) && /^-?\d+(\.\d+)?$/.test(v.trim())) row[i] = Number(v);
        else row[i] = v;
      });
      next.values[rowIndex] = row;
      await onSave(next);
      onClose();
    } catch (e: any) {
      Alert.alert(t('Could not save', 'சேமிக்க முடியவில்லை'), e?.message || t('Please try again.', 'மீண்டும் முயற்சிக்கவும்.'));
    } finally { setSaving(false); }
  };

  if (!sheet || rowIndex === null) return null;
  const currentFormulaRow = sheet.formulas?.[rowIndex] || [];
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={{flex: 1, backgroundColor: 'rgba(11,28,24,0.45)', justifyContent: 'flex-end'}}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{backgroundColor: C.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', padding: 18}}>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12}}>
            <View><Text style={{fontSize: 18, fontWeight: '900', color: C.ink}}>{isNew ? t('New record', 'புதிய பதிவு') : t('Edit record', 'பதிவைத் திருத்து')}</Text><Text style={{fontSize: 11, color: C.muted, marginTop: 3}}>{SHEET_TITLES[sheetId] || sheet.name}</Text></View>
            <TouchableOpacity onPress={onClose} style={{padding: 8}}><Text style={{fontSize: 22, color: C.muted}}>×</Text></TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom: 12}}>
            {headers.map((h: string, i: number) => {
              if (!h) return null;
              if (sheetId === 'work_schedule' && /predecessor|planned budget|actual cost/i.test(h)) return null;
              const formula = !!currentFormulaRow[i];
              return <View key={`${h}-${i}`} style={{marginBottom: 11}}>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5}}>
                  <Text style={{fontSize: 11, fontWeight: '800', color: C.muted}}>{h.toUpperCase()}</Text>
                  {formula ? <Text style={{fontSize: 10, color: C.gold, fontWeight: '800'}}>{t('FORMULA · LOCKED', 'சூத்திரம் · பூட்டப்பட்டது')}</Text> : null}
                </View>
                {(() => {
                  const optionsByHeader: Record<string, string[]> = {
                    'Floor / Area': ['Ground Floor', 'First Floor', 'Common/External'],
                    'Construction Activity': [
                      'Site setup & setting out',
                      'Excavation',
                      'PCC / footing preparation',
                      'Footing reinforcement & concrete',
                      'Foundation / column up to plinth',
                      'Plinth beam & filling',
                      'Ground floor columns & beams',
                      'Ground floor slab / roof over GF',
                      'First floor masonry',
                      'First floor columns / beams (if applicable)',
                      'First floor roof slab',
                      'Brickwork / partitions',
                      'Plumbing rough-in',
                      'Electrical conduit rough-in',
                      'Door/window frames',
                      'Internal & external plaster',
                      'Waterproofing',
                      'Floor & wall tiling',
                      'Plumbing fixtures',
                      'Electrical wiring & fittings',
                      'Doors, windows & grills',
                      'Putty & painting',
                      'Septic / drainage / rainwater works',
                      'Compound wall / gate / external paving',
                      'Testing, snag list & handover'
                    ],
                    'Work Stage': ['Site Prep', 'Foundation', 'Plinth', 'Structure', 'Brickwork', 'Roof Slab', 'Plastering', 'Plumbing', 'Electrical', 'Flooring', 'Painting', 'Finishing', 'External Works'],
                    'Expense Category': ['Material', 'Engineer/Architect', 'Labour', 'Equipment', 'Transport', 'Other'],
                    'Payment Mode': ['UPI', 'Bank Transfer', 'Cash', 'Cheque'],
                    'Paid By': ['Vengadesh', 'Kanakaraj'],
                    'Bill Received?': ['Yes', 'No'],
                    'Status': ['Not Started', 'In Progress', 'On Hold', 'Delayed', 'Completed'],
                    'Unit': ['Sq.ft', 'Sq.m', 'Running ft', 'Cft', 'Cum', 'Nos', 'Days', 'Hours', 'Job', 'Lumpsum'],
                    'Work Status': ['Not Started', 'In Progress', 'On Hold', 'Delayed', 'Completed'],
                    'Service / Fee Head': [
                      'Architect / plan preparation',
                      'Site engineer / supervision',
                      'Approval / permit / local body fees',
                      'Other professional fee'
                    ]
                  };
                  const materialOptions = [...new Set(['materials_ground','materials_first','materials_boq'].flatMap(id=>{const data=allSheets?.[id];const hs=(data?.values?.[0]||[]).map((x:any)=>String(x||''));const col=hs.findIndex((x:string)=>/material|item|description/i.test(x));return col<0?[]:(data.values||[]).slice(1).map((row:any[])=>String(row?.[col]||'').trim()).filter(Boolean);} ))];
                  const isMaterialField = /^(material|material \/ item|item|description)$/i.test(h.trim());
                  const dynamicOptions = /floor|area/i.test(h) ? optionsByHeader['Floor / Area'] : /stage|work stage/i.test(h) ? optionsByHeader['Work Stage'] : /^unit$/i.test(h) ? optionsByHeader.Unit : undefined;
                  const options = (['daily_expenses', 'work_schedule', 'labour_work', 'professional_fees','materials_ground','materials_first','materials_boq'].includes(sheetId) ? optionsByHeader[h] : undefined) || (isMaterialField ? materialOptions : undefined) || dynamicOptions;

                  if (options) {
                    return (
                      <View style={{backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 11, overflow: 'hidden'}}>
                        <Picker
                          selectedValue={values[i] || ''}
                          onValueChange={v => setValues(prev => {
                            const next = [...prev];
                            next[i] = v;
                            return next;
                          })}
                          enabled={!formula}
                        >
                          <Picker.Item label={language === 'ta' ? `${h} தேர்ந்தெடுக்கவும்` : `Select ${h}`} value="" />
                          {options.map(option => (
                            <Picker.Item key={option} label={language === 'ta' ? ({
                              'Ground Floor': 'தரைத் தளம்',
                              'First Floor': 'முதல் தளம்',
                              'Common/External': 'பொதுவான / வெளிப்புறம்',
                              'Foundation': 'அஸ்திவாரம்',
                              'Brickwork': 'செங்கல் வேலை',
                              'Plumbing': 'குழாய் வேலை',
                              'Electrical': 'மின்சார வேலை',
                              'Painting': 'வண்ணம் பூசுதல்',
                              'Not Started': 'தொடங்கவில்லை',
                              'In Progress': 'நடைபெறுகிறது',
                              'Completed': 'முடிந்தது',
                              'Yes': 'ஆம்',
                              'No': 'இல்லை',
                              'Material': 'பொருள்',
                              'Labour': 'தொழிலாளர்',
                              'Transport': 'போக்குவரத்து',
                              'Other': 'மற்றவை'
                            } as Record<string, string>)[option] || option : option} value={option} />
                          ))}
                        </Picker>
                        <TextInput value={values[i]||''} onChangeText={value=>setValues(prev=>{const next=[...prev];next[i]=value;return next;})} placeholder={language==='ta'?`தனிப்பயன் ${h}`:`Custom ${h}`} editable={!formula} style={{marginHorizontal:10,marginBottom:10,borderWidth:1,borderColor:C.line,borderRadius:8,padding:9,color:C.ink}}/>
                      </View>
                    );
                  }

                  if (isDateHeader(h)) {
                    return (
                      <View>
                        <TouchableOpacity
                          disabled={formula}
                          onPress={() => setDatePickerIndex(i)}
                          style={{backgroundColor: formula ? '#E8EDE9' : C.white, borderWidth: 1, borderColor: C.line, borderRadius: 11, padding: 12, minHeight: 45, justifyContent: 'center'}}
                        >
                          <Text style={{color: values[i] ? (formula ? C.muted : C.ink) : '#9AA8A2', fontSize: 14}}>
                            {values[i] || (language === 'ta' ? 'தேதியைத் தேர்ந்தெடுக்கவும்' : 'Select date')}
                          </Text>
                        </TouchableOpacity>
                        {datePickerIndex === i ? (
                          <DateTimePicker
                            value={datePickerValue(values[i])}
                            mode="date"
                            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                            onChange={(event, selectedDate) => {
                              if (event.type === 'set' && selectedDate) {
                                const formatted = formatPickerDate(selectedDate);
                                setValues(prev => {
                                  const next = [...prev];
                                  next[i] = formatted;
                                  return next;
                                });
                              }
                              if (Platform.OS === 'android' || event.type === 'dismissed') {
                                setDatePickerIndex(null);
                              }
                            }}
                          />
                        ) : null}
                      </View>
                    );
                  }

                  return (
                    <TextInput
                      value={values[i] || ''}
                      onChangeText={v => setValues(prev => {const next=[...prev]; next[i]=v; return next;})}
                      editable={!formula}
                      keyboardType={isMoneyHeader(h) || /qty|complete|duration|delay|area|%/i.test(h) ? 'numeric' : 'default'}
                      multiline={/notes|scope|specification/i.test(h)}
                      placeholder={language === 'ta' ? `${h} உள்ளிடவும்` : `Enter ${h.toLowerCase()}`}
                      placeholderTextColor="#9AA8A2"
                      style={{backgroundColor: formula ? '#E8EDE9' : C.white, borderWidth: 1, borderColor: C.line, borderRadius: 11, padding: 12, color: formula ? C.muted : C.ink, minHeight: /notes|scope|specification/i.test(h) ? 68 : 45, textAlignVertical: 'top'}}
                    />
                  );
                })()}
              </View>;
            })}
          </ScrollView>
          <View style={{flexDirection: 'row', gap: 9, paddingTop: 10}}>
            <TouchableOpacity onPress={onClose} style={{...buttonStyle(false, true), flex: 1}}><Text style={{fontWeight: '800', color: C.green}}>{t('Cancel', 'ரத்து செய்')}</Text></TouchableOpacity>
            <TouchableOpacity disabled={saving} onPress={save} style={{...buttonStyle(saving), flex: 1}}>{saving ? <ActivityIndicator color="#FFF"/> : <Text style={{fontWeight: '800', color: '#FFF'}}>{t('Save changes', 'மாற்றங்களைச் சேமி')}</Text>}</TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  </Modal>;
}

function makeFormulaRow(sheetId: string, excelRow: number, width: number) {
  const result = Array(width).fill('');
  const set = (col: number, formula: string) => { if (col < width) result[col] = formula; };
  if (sheetId === 'materials_boq') {
    set(9, `=IF(OR(G${excelRow}="",H${excelRow}=""),"",G${excelRow}*H${excelRow}*(1+IF(I${excelRow}="",0,I${excelRow})))`);
    set(13, `=IF(G${excelRow}="","",G${excelRow}-IF(M${excelRow}="",0,M${excelRow}))`);
  }
  if (sheetId === 'labour_work') {
    set(7, `=IF(OR(F${excelRow}="",G${excelRow}=""),"",F${excelRow}*G${excelRow})`);
    set(13, `=IF(H${excelRow}="","",H${excelRow}-IF(M${excelRow}="",0,M${excelRow}))`);
  }
  if (sheetId === 'professional_fees') {
    set(5, `=IF(E${excelRow}="","",E${excelRow})`);
    set(10, `=IF(F${excelRow}="","",F${excelRow}-IF(J${excelRow}="",0,J${excelRow}))`);
  }
  if (sheetId === 'misc_equipment') set(6, `=IF(OR(E${excelRow}="",F${excelRow}=""),"",E${excelRow}*F${excelRow})`);
  if (sheetId === 'work_schedule') {
    set(7, `=IF(OR(D${excelRow}="",E${excelRow}=""),"",E${excelRow}-D${excelRow}+1)`);
    set(14, `=IF(OR(E${excelRow}="",G${excelRow}=""),"",MAX(0,G${excelRow}-E${excelRow}))`);
  }
  if (sheetId === 'materials_ground' || sheetId === 'materials_first') {
    set(9, `=IF(OR(G${excelRow}="",H${excelRow}=""),"",G${excelRow}*H${excelRow}*(1+IF(I${excelRow}="",0,I${excelRow})))`);
    set(15, `=IF(OR(O${excelRow}="",H${excelRow}=""),"",O${excelRow}*H${excelRow})`);
    set(16, `=IF(G${excelRow}="","",G${excelRow}-IF(O${excelRow}="",0,O${excelRow}))`);
  }
  return result;
}

function appendedSheet(sheetId: string, sheet: SheetDocument): {next: SheetDocument; rowIndex: number} {
  const next: SheetDocument = {
    ...sheet,
    values: sheet.values.map(r => [...r]),
    formulas: sheet.formulas.map(r => [...r]),
    recordIds: [...(sheet.recordIds || Array(sheet.values.length).fill(''))]
  };
  while (next.recordIds!.length < next.values.length) {
    next.recordIds!.push(`record_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  }
  const width = Math.max(next.values[0]?.length || 0, 1);
  const row = Array(width).fill(null);
  const headers = headersForSheet(sheetId, sheet);
  const firstHeader = headers[0] || '';
  if (/id|s\.no\./i.test(firstHeader)) {
    const ids = next.values.slice(1).map(r => n(r[0]));
    row[0] = Math.max(0, ...ids) + 1;
  }
  if (sheetId === 'quotation_compare') row[0] = '';
  next.values.push(row);
  next.formulas.push(makeFormulaRow(sheetId, next.values.length, width));
  next.recordIds!.push(`record_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
  if (sheetId === 'professional_fees' && next.formulas[2]) {
    // Keep the original payment roll-up formula but extend it to include appended payment rows.
    next.formulas[2][9] = `=SUM(H4:H${next.values.length})`;
  }
  return {next, rowIndex: next.values.length - 1};
}


function formatActivityDate(value: any): string {
  if (!value) return '—';

  let date: Date;

  if (typeof value?.toDate === 'function') {
    date = value.toDate();
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return '—';

  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  })}`;
}

function ActivityScreen({activities, language, canClear, onClear}: any) {
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;

  const translatedChange = (value: string) => {
    if (language !== 'ta') return value;

    const labels: Record<string, string> = {
      CREATE: 'உருவாக்கம்',
      UPDATE: 'புதுப்பிப்பு',
      DELETE: 'நீக்கம்',
      ADD: 'சேர்த்தல்',
      EDIT: 'திருத்தம்',
      IMPORT: 'இறக்குமதி'
    };

    return labels[value] || value;
  };

  const confirmClear = () => {
    Alert.alert(
      t('Clear activity history?', 'செயல்பாட்டு வரலாற்றை அழிக்கவா?'),
      t(
        'This permanently deletes all project activity history. Construction worksheets, expenses, payments, bills and attachments will not be deleted.',
        'இது திட்டத்தின் அனைத்து செயல்பாட்டு வரலாற்றையும் நிரந்தரமாக நீக்கும். கட்டுமானப் பணித்தாள்கள், செலவுகள், பணப்பரிவர்த்தனைகள், ரசீதுகள் மற்றும் இணைப்புகள் நீக்கப்படாது.'
      ),
      [
        {
          text: t('Cancel', 'ரத்துசெய்'),
          style: 'cancel'
        },
        {
          text: t('Clear history', 'வரலாற்றை அழி'),
          style: 'destructive',
          onPress: () => onClear()
        }
      ]
    );
  };

  return (
    <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 30}}>
      <View style={cardStyle({marginBottom: 12})}>
        <Text style={{fontSize: 18, fontWeight: '900', color: C.ink}}>
          {t('Project notifications', 'திட்ட அறிவிப்புகள்')}
        </Text>

        <Text style={{fontSize: 12, lineHeight: 18, color: C.muted, marginTop: 5}}>
          {t(
            'Construction changes made by the owner appear here.',
            'உரிமையாளர் செய்யும் கட்டுமான மாற்றங்கள் இங்கே தோன்றும்.'
          )}
        </Text>

        {canClear && activities.length > 0 ? (
          <TouchableOpacity
            onPress={confirmClear}
            style={{
              backgroundColor: C.redBg,
              padding: 12,
              borderRadius: 10,
              marginTop: 14,
              borderWidth: 1,
              borderColor: '#EBCBC7'
            }}
          >
            <Text style={{color: C.red, fontWeight: '800', textAlign: 'center'}}>
              {t('Clear all activity history', 'அனைத்து செயல்பாட்டு வரலாற்றையும் அழி')}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {activities.length ? activities.map((a: ActivityItem) => (
        <View key={a.id} style={cardStyle({marginBottom: 9})}>
          <Pill>{a.sheetName || t('Project update', 'திட்டப் புதுப்பிப்பு')}</Pill>

          <Text style={{fontSize: 14, fontWeight: '900', color: C.ink, marginTop: 9}}>
            {a.changeType
              ? translatedChange(a.changeType.toUpperCase())
              : t('UPDATE', 'புதுப்பிப்பு')}: {a.itemName || a.title || t('KSK House updated', 'KSK வீடு புதுப்பிக்கப்பட்டது')}
          </Text>

          <Text style={{fontSize: 12, color: C.muted, marginTop: 5}}>
            {t('Changed by:', 'மாற்றியவர்:')} {a.actorName || t('Project owner', 'திட்ட உரிமையாளர்')}
          </Text>

          <Text style={{fontSize: 12, color: C.muted, marginTop: 4}}>
            {t('Date & time:', 'தேதி மற்றும் நேரம்:')} {formatActivityDate(a.createdAt)}
          </Text>

          <Text style={{fontSize: 12, lineHeight: 19, color: C.ink, marginTop: 8}}>
            {a.details || a.body || t('New construction data is available.', 'புதிய கட்டுமானத் தகவல்கள் உள்ளன.')}
          </Text>
        </View>
      )) : (
        <View style={cardStyle()}>
          <Text style={{fontSize: 12, color: C.muted}}>
            {t('No cloud updates yet.', 'இதுவரை கிளவுட் புதுப்பிப்புகள் இல்லை.')}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function SettingsScreen({role, user, syncCount, cloudReady, initialising, onSeed, onNotifications, onSignOut, onOriginal, language, onLanguageChange, onExportExcel, onExportPdf}: any) {
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;
  return <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 35}}>
    <View style={cardStyle({marginBottom: 12})}>
      <Text style={{fontSize: 18, fontWeight: '900', color: C.ink}}>{t('Account & access', 'கணக்கு மற்றும் அணுகல்')}</Text>
      <Text style={{fontSize: 12, color: C.muted, marginTop: 9}}>{user?.email || t('Local workbook preview', 'உள்ளூர் பணிப்புத்தக முன்னோட்டம்')}</Text>
      <View style={{flexDirection: 'row', gap: 8, marginTop: 12}}><Pill color={role === 'owner' ? C.green2 : C.blueBg} textColor={role === 'owner' ? C.green : '#365775'}>{role === 'owner' ? t('OWNER · EDITOR', 'உரிமையாளர் · திருத்துபவர்') : role === 'viewer' ? t('FATHER · READ ONLY', 'பார்வையாளர் · படிக்க மட்டும்') : t('PREVIEW', 'முன்னோட்டம்')}</Pill><Pill color={C.green2}>{cloudReady ? t('Cloud connected', 'கிளவுட் இணைக்கப்பட்டுள்ளது') : t('Cloud not connected', 'கிளவுட் இணைக்கப்படவில்லை')}</Pill></View>
      <Text style={{fontSize: 11, lineHeight: 18, color: C.muted, marginTop: 13}}>{t('The owner account can update every worksheet. A viewer account can read and receive notifications but cannot write to the project. Access is enforced by Firestore security rules, not just by hiding edit buttons.', 'உரிமையாளர் கணக்கு அனைத்து பணித்தாள்களையும் புதுப்பிக்கலாம். பார்வையாளர் கணக்கு தகவல்களைப் படிக்கவும் அறிவிப்புகளைப் பெறவும் முடியும்; ஆனால் திட்டத்தில் மாற்றங்களைச் செய்ய முடியாது. அணுகல் Firestore பாதுகாப்பு விதிகளால் கட்டுப்படுத்தப்படுகிறது.')}</Text>
    </View>
    <View style={cardStyle({marginBottom: 12})}>
      <Text style={{fontSize: 16, fontWeight: '800', color: C.ink}}>Language / மொழி</Text>
      <Text style={{fontSize: 12, color: C.muted, marginTop: 5}}>{t('Choose your preferred app language.', 'உங்களுக்கு விருப்பமான செயலி மொழியைத் தேர்ந்தெடுக்கவும்.')}</Text>
      <View style={{borderWidth: 1, borderColor: C.line, borderRadius: 10, marginTop: 10, overflow: 'hidden'}}>
        <Picker
          selectedValue={language}
          onValueChange={(value: 'en' | 'ta') => onLanguageChange(value)}
          style={{color: C.ink}}
        >
          <Picker.Item label="English" value="en" />
          <Picker.Item label="தமிழ்" value="ta" />
        </Picker>
      </View>
    </View>

    <View style={cardStyle({marginBottom: 12})}>
      <Text style={{fontSize: 16, fontWeight: '800', color: C.ink}}>
        {t('Export project data', 'திட்டத் தரவை ஏற்றுமதி செய்க')}
      </Text>
      <Text style={{fontSize: 12, color: C.muted, marginTop: 5}}>
        {t('Export all available worksheets into one Excel workbook or one PDF report.', 'அனைத்து பணித்தாள்களையும் ஒரே Excel கோப்பாக அல்லது PDF அறிக்கையாக ஏற்றுமதி செய்யவும்.')}
      </Text>
      <TouchableOpacity
        onPress={onExportExcel}
        style={{backgroundColor: C.green, padding: 13, borderRadius: 10, marginTop: 12}}
      >
        <Text style={{color: '#fff', fontWeight: '800', textAlign: 'center'}}>
          {t('Export all data to Excel (.xlsx)', 'Excel கோப்பாக ஏற்றுமதி செய்க (.xlsx)')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onExportPdf}
        style={{backgroundColor: C.blueBg, padding: 13, borderRadius: 10, marginTop: 8}}
      >
        <Text style={{color: C.ink, fontWeight: '800', textAlign: 'center'}}>
          {t('Export all data to PDF (.pdf)', 'PDF கோப்பாக ஏற்றுமதி செய்க (.pdf)')}
        </Text>
      </TouchableOpacity>
    </View>

    <View style={cardStyle({marginBottom: 12})}>
      <Text style={{fontSize: 16, fontWeight: '800', color: C.ink}}>{t('Cloud workbook', 'கிளவுட் பணிப்புத்தகம்')}</Text>
      <Text style={{fontSize: 12, color: C.muted, marginTop: 5}}>{syncCount} {t('workbook sheets currently stored in the cloud.', 'பணித்தாள்கள் தற்போது கிளவுடில் சேமிக்கப்பட்டுள்ளன.')}</Text>
      {role === 'owner' && cloudReady && syncCount === 0 ? <TouchableOpacity disabled={initialising} onPress={onSeed} style={{...buttonStyle(initialising), marginTop: 14}}>{initialising ? <ActivityIndicator color="#FFF"/> : <Text style={{color: '#FFF', fontWeight: '800'}}>{t('Import workbook to cloud', 'பணிப்புத்தகத்தை கிளவுடில் பதிவேற்றவும்')}</Text>}</TouchableOpacity> : null}
      {role === 'viewer' && syncCount === 0 ? <Text style={{fontSize: 12, color: C.gold, marginTop: 12}}>{t('Waiting for the owner to import the workbook into the cloud.', 'உரிமையாளர் பணிப்புத்தகத்தை கிளவுடில் பதிவேற்றுவதற்காகக் காத்திருக்கிறது.')}</Text> : null}
      <TouchableOpacity onPress={onOriginal} style={{...buttonStyle(false, true), marginTop: 10}}><Text style={{color: C.green, fontWeight: '800'}}>{t('Original Excel workbook included in project', 'அசல் Excel பணிப்புத்தகம் திட்டத்தில் சேர்க்கப்பட்டுள்ளது')}</Text></TouchableOpacity>
    </View>
    <View style={cardStyle({marginBottom: 12})}>
      <Text style={{fontSize: 16, fontWeight: '800', color: C.ink}}>{t('Notifications', 'அறிவிப்புகள்')}</Text>
      <Text style={{fontSize: 12, color: C.muted, lineHeight: 18, marginTop: 5}}>{t('Enable notifications on this device for project updates while the app is active and locally scheduled reminders. These do not notify other members.', 'செயலி திறந்திருக்கும் போது திட்டப் புதுப்பிப்புகள் மற்றும் இந்தச் சாதனத்தில் திட்டமிடப்பட்ட நினைவூட்டல்களுக்கு அறிவிப்புகளை இயக்கவும். இவை மற்ற உறுப்பினர்களுக்கு அனுப்பப்படாது.')}</Text>
      <TouchableOpacity onPress={onNotifications} style={{...buttonStyle(false, true), marginTop: 13}}><Text style={{color: C.green, fontWeight: '800'}}>{t('Enable this device', 'இந்தச் சாதனத்தைச் செயல்படுத்தவும்')}</Text></TouchableOpacity>
    </View>
    <TouchableOpacity onPress={onSignOut} style={{...buttonStyle(false, true), marginTop: 3}}><Text style={{color: C.red, fontWeight: '800'}}>{t('Sign out', 'வெளியேறு')}</Text></TouchableOpacity>
  </ScrollView>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [roleChecked, setRoleChecked] = useState(false);
  const [sheets, setSheets] = useState<SheetMap>(LOCAL_WORKBOOK);
  const [cloudSheetsLoaded, setCloudSheetsLoaded] = useState(false);
  const [cloudCount, setCloudCount] = useState(0);
  const [syncState, setSyncState] = useState('LOCAL PREVIEW');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [screen, setScreen] = useState<'Dashboard'|'Sheets'|'Expenses'|'Progress'|'Records'|'Activity'|'Settings'>('Dashboard');
  const [selectedSheet, setSelectedSheet] = useState('');
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editingSheetId, setEditingSheetId] = useState('');
  const [editingIsNew, setEditingIsNew] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [initialising, setInitialising] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [language, setLanguage] = useState<'en' | 'ta'>('en');
  const [languageLoaded, setLanguageLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem('ksk_app_language')
      .then(saved => {
        if (active && (saved === 'en' || saved === 'ta')) {
          setLanguage(saved);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLanguageLoaded(true);
      });
    return () => { active = false; };
  }, []);

  const changeLanguage = async (next: 'en' | 'ta') => {
    setLanguage(next);
    try {
      await AsyncStorage.setItem('ksk_app_language', next);
    } catch {
      Alert.alert('Language', 'Could not save language preference.');
    }
  };

  useEffect(() => {
    if (!auth) { setRoleChecked(true); return; }
    return onAuthStateChanged(auth, next => {
      setUser(next);
      if (!next) { setRole(null); setRoleChecked(true); }
      else { setRoleChecked(false); }
    });
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const ref = doc(db, 'users', user.uid);
    return onSnapshot(ref, snapshot => {
      const membership = snapshot.data();
      const assigned = membership?.projectId === 'ksk' ? membership?.role : null;
      setRole(assigned === 'owner' || assigned === 'viewer' ? assigned : null);
      setRoleChecked(true);
    }, () => {setRole(null); setRoleChecked(true);});
  }, [user]);

  useEffect(() => {
    if (!user || !db || !role) return;
    setCloudSheetsLoaded(false);
    setSyncState('CONNECTING');
    const stopSheets = subscribeSheets((remote, count) => {
      setCloudCount(count);
      setSheets(current => ({...current, ...remote}));
      setCloudSheetsLoaded(true);
      if (role === 'owner') {
        Object.entries(remote).forEach(([id, sheet]) => {
          if (!sheet.recordIds || sheet.recordIds.length !== (sheet.values || []).length ||
              (sheet.recordIds || []).some((recordId, index) => index > 0 && !recordId)) {
            void ensureSheetRecordIds(id, sheet).catch(error => {
              console.warn('Could not initialise expense record IDs:', error?.message || error);
            });
          }
        });
      }
      setSyncState('LIVE SYNC');
    }, () => setSyncState('SYNC ERROR'));
    // Ignore the initial activity snapshot to avoid notifying old updates.
    let activityBaselineLoaded = false;
    const seenActivityIds = new Set<string>();

    const stopActivity = subscribeActivities(items => {
      setActivities(items);

      if (!activityBaselineLoaded) {
        items.forEach(item => seenActivityIds.add(item.id));
        activityBaselineLoaded = true;
        return;
      }

      const newItems = items.filter(item => !seenActivityIds.has(item.id));
      items.forEach(item => seenActivityIds.add(item.id));

      // Only viewer devices receive local alerts for owner-created activity.
      if (role === 'viewer') {
        newItems.slice(0, 3).reverse().forEach(item => {
          void showActivityNotification(
            item.title || 'KSK House updated',
            item.body || 'A project worksheet was updated.'
          );
        });
      }
    }, () => {});

    return () => {stopSheets(); stopActivity();};
  }, [user, role]);

  const signIn = async (email: string, password: string) => {
    try {
      if (!auth) throw new Error('Firebase configuration is missing.');
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      Alert.alert('Sign-in failed', e?.message || 'Check your email and password.');
    }
  };

  const performSignOut = async () => {
    if (auth) await signOut(auth);
    setDemoMode(false);
    setScreen('Dashboard');
  };

  const openSheet = (id: string) => {
    setSelectedSheet(id);
    setScreen('Sheets');
  };

  const addExpense = () => {
    if (role !== 'owner') {Alert.alert('Read-only access', 'Only the owner can add expenses.'); return;}
    openSheet('daily_expenses');
    setTimeout(() => startAdd('daily_expenses'), 100);
  };

  const startEdit = (sheetId: string, rowIndex: number) => {
    if (role !== 'owner') return;
    setEditingSheetId(sheetId); setEditingRow(rowIndex); setEditingIsNew(false); setModalVisible(true);
  };

  const startAdd = (sheetId: string) => {
    if (role !== 'owner') return;
    const sheet = sheets[sheetId];
    if (!sheet) {Alert.alert('Sheet not loaded', 'Import the workbook first.'); return;}
    const {next, rowIndex} = appendedSheet(sheetId, sheet);
    setSheets(current => ({...current, [sheetId]: next}));
    setEditingSheetId(sheetId); setEditingRow(rowIndex); setEditingIsNew(true); setModalVisible(true);
  };

  const saveEditedSheet = async (next: SheetDocument) => {
    if (role !== 'owner') throw new Error('This account is read-only.');
    if (demoMode || !user || !db) throw new Error('Cloud sync is not connected. Changes have not been saved.');
    setSyncState('SAVING');
    await saveSheet(editingSheetId, next, user.uid, user.displayName || user.email || 'Project owner');
    setSheets(current => ({...current, [editingSheetId]: next}));
    setSyncState('LIVE SYNC');
  };

  const deleteRecord = (sheetId: string, rowIndex: number) => {
    if (role !== 'owner' || !user || !db || demoMode) {
      Alert.alert('Cannot delete', 'Only the connected project owner can delete records.');
      return;
    }

    const current = sheets[sheetId];
    const headers = headersForSheet(sheetId, current);

    const primaryIndex = titleIndex(headers, [
      'material / item', 'item / description', 'construction activity',
      'labour / contractor work', 'service / fee head'
    ]);
    const itemName = primaryIndex >= 0
      ? String(current?.values?.[rowIndex]?.[primaryIndex] || 'this record')
      : 'this record';

    Alert.alert(
      'Delete record?',
      `Permanently delete "${itemName}" from ${SHEET_TITLES[sheetId] || sheetId}?`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!current || rowIndex <= 0 || rowIndex >= (current.values || []).length) {
              Alert.alert('Delete failed', 'The selected record could not be found.');
              return;
            }

            const next: SheetDocument = {
              ...current,
              values: [...(current.values || [])],
              formulas: [...(current.formulas || [])]
            };

            next.values.splice(rowIndex, 1);
            next.formulas.splice(rowIndex, 1);
            if (next.recordIds) {
              next.recordIds = [...next.recordIds];
              next.recordIds.splice(rowIndex, 1);
            }

            try {
              setSyncState('SAVING');
              await saveSheet(sheetId, next, user.uid, user.displayName || user.email || 'Project owner');
              setSheets(previous => ({...previous, [sheetId]: next}));
              setSyncState('LIVE SYNC');
              Alert.alert('Deleted', 'The record has been deleted successfully.');
            } catch (e: any) {
              setSyncState('SYNC ERROR');
              Alert.alert('Delete failed', e?.message || 'Please try again.');
            }
          }
        }
      ]
    );
  };

  const exportExcel = async () => {
    try {
      const ids = Object.keys(sheets)
        .filter(id => sheets[id]?.values)
        .sort((a, b) => {
          const ai = SHEET_ORDER.indexOf(a);
          const bi = SHEET_ORDER.indexOf(b);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });

      if (!ids.length) {
        Alert.alert('No data', 'There are no worksheets to export.');
        return;
      }

      const workbook = XLSX.utils.book_new();
      const usedNames = new Set<string>();

      ids.forEach(id => {
        const sheet = sheets[id];
        const baseName = (SHEET_TITLES[id] || sheet.name || id)
          .replace(/[:\\/?*\[\]]/g, ' ')
          .slice(0, 31);

        let sheetName = baseName;
        let number = 2;

        while (usedNames.has(sheetName.toLowerCase())) {
          const suffix = ` ${number++}`;
          sheetName = baseName.slice(0, 31 - suffix.length) + suffix;
        }

        usedNames.add(sheetName.toLowerCase());

        XLSX.utils.book_append_sheet(
          workbook,
          XLSX.utils.aoa_to_sheet(sheet.values || []),
          sheetName
        );
      });

      const base64 = XLSX.write(workbook, {
        bookType: 'xlsx',
        type: 'base64'
      });

      const fileUri =
        `${FileSystem.cacheDirectory}KSK_House_Construction_${new Date().toISOString().slice(0, 10)}.xlsx`;

      await FileSystem.writeAsStringAsync(fileUri, base64, {
        encoding: FileSystem.EncodingType.Base64
      });

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('File sharing is not available on this device.');
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: 'Export KSK House Excel'
      });
    } catch (error: any) {
      Alert.alert(
        language === 'ta' ? 'Excel ஏற்றுமதி தோல்வியடைந்தது' : 'Excel export failed',
        error?.message || 'Please try again.'
      );
    }
  };

  const exportPdf = async () => {
    try {
      const ids = Object.keys(sheets)
        .filter(id => sheets[id]?.values)
        .sort((a, b) => {
          const ai = SHEET_ORDER.indexOf(a);
          const bi = SHEET_ORDER.indexOf(b);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });

      if (!ids.length) {
        Alert.alert('No data', 'There are no worksheets to export.');
        return;
      }

      const escapeHtml = (value: any) =>
        String(value ?? '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');

      const sections = ids.map(id => {
        const sheet = sheets[id];
        const title = SHEET_TITLES[id] || sheet.name || id;

        const rows = (sheet.values || []).map((row: any[], index: number) => {
          const cells = (row || []).map((cell: any) => {
            const tag = index === 0 ? 'th' : 'td';
            return `<${tag}>${escapeHtml(cell)}</${tag}>`;
          }).join('');

          return `<tr>${cells}</tr>`;
        }).join('');

        return `
          <section>
            <h2>${escapeHtml(title)}</h2>
            <table>
              <tbody>${rows}</tbody>
            </table>
          </section>
        `;
      }).join('');

      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              body {
                font-family: Arial, sans-serif;
                padding: 20px;
                color: #222;
                font-size: 10px;
              }
              h1 {
                font-size: 20px;
                margin-bottom: 5px;
              }
              h2 {
                font-size: 15px;
                margin-top: 25px;
                color: #245b45;
              }
              .date {
                color: #666;
                margin-bottom: 20px;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 15px;
              }
              th, td {
                border: 1px solid #ccc;
                padding: 5px;
                text-align: left;
                word-break: break-word;
              }
              th {
                background: #e8eee9;
                font-weight: bold;
              }
              tr {
                page-break-inside: avoid;
              }
            </style>
          </head>
          <body>
            <h1>KSK House Construction</h1>
            <div class="date">
              Project data export: ${new Date().toLocaleDateString()}
            </div>
            ${sections}
          </body>
        </html>
      `;

      const result = await Print.printToFileAsync({html});

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('File sharing is not available on this device.');
      }

      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Export KSK House PDF'
      });
    } catch (error: any) {
      Alert.alert(
        language === 'ta' ? 'PDF ஏற்றுமதி தோல்வியடைந்தது' : 'PDF export failed',
        error?.message || 'Please try again.'
      );
    }
  };

  const doSeed = async () => {
    if (role !== 'owner' || !user) return;
    setInitialising(true);
    try {
      await seedWorkbook(user.uid);
      await ensureQuoteSheet(user.uid);
      Alert.alert('Workbook imported', 'All 11 original Excel sheets have been copied to the KSK cloud project.');
    } catch (e: any) { Alert.alert('Import stopped', e?.message || 'Please try again.'); }
    finally {setInitialising(false);}
  };

  const doNotifications = async () => {
    if (!user || demoMode) {Alert.alert('Sign in required', 'Sign in to enable notifications on this device.'); return;}
    try {const message = await enableNotifications(user.uid); Alert.alert('Notifications', message);}
    catch (e: any) {Alert.alert('Notification setup', e?.message || 'Could not register this device.');}
  };

  if (isFirebaseConfigured && !demoMode && (!user || !roleChecked || !role)) {
    if (!user) return <LoginScreen onLogin={signIn} demo={() => {setDemoMode(true); setSheets(LOCAL_WORKBOOK);}} />;
    if (!roleChecked) return <SafeAreaView style={{flex:1, backgroundColor:C.paper, justifyContent:'center', alignItems:'center'}}><ActivityIndicator color={C.green}/><Text style={{color:C.muted, marginTop:12}}>{language === 'ta' ? 'திட்ட அணுகலைச் சரிபார்க்கிறது…' : 'Checking project access…'}</Text></SafeAreaView>;
    return <SafeAreaView style={{flex:1, backgroundColor:C.paper, justifyContent:'center', padding:24}}><View style={cardStyle()}><Text style={{fontSize:20, fontWeight:'900', color:C.ink}}>{language === 'ta' ? 'அணுகல் ஒதுக்கப்படவில்லை' : 'Access not assigned'}</Text><Text style={{fontSize:13, lineHeight:20, color:C.muted, marginTop:9}}>{language === 'ta' ? 'இந்த Firebase கணக்கிற்கு KSK திட்டத்தில் உரிமையாளர் அல்லது பார்வையாளர் அனுமதி இல்லை. Firestore-இல் அனுமதியை ஒதுக்க திட்ட நிர்வாகியிடம் கேட்டு மீண்டும் உள்நுழையவும்.' : 'This Firebase account does not have an owner or viewer role in the KSK project. Ask the project administrator to assign the role in Firestore, then sign in again.'}</Text><TouchableOpacity onPress={performSignOut} style={{...buttonStyle(), marginTop:16}}><Text style={{color:'#FFF', fontWeight:'800'}}>{language === 'ta' ? 'வெளியேறு' : 'Sign out'}</Text></TouchableOpacity></View></SafeAreaView>;
  }

  const syncLabel = demoMode || !user ? 'LOCAL PREVIEW' : syncState;
  const canEdit = role === 'owner' && !demoMode && !!user;
  const selectedData = selectedSheet ? (sheets[selectedSheet] || (selectedSheet === 'quotation_compare' ? undefined : undefined)) : undefined;
  const recordsCount = selectedData ? meaningfulRows(selectedData).length : 0;

  const handleClearActivity = async () => {
    if (!canEdit || !user || demoMode) return;

    try {
      const deletedCount = await clearActivityHistory();

      Alert.alert(
        language === 'ta' ? 'வரலாறு அழிக்கப்பட்டது' : 'History cleared',
        language === 'ta'
          ? `${deletedCount} செயல்பாட்டு பதிவுகள் அழிக்கப்பட்டன.`
          : `${deletedCount} activity records were deleted.`
      );
    } catch (error: any) {
      Alert.alert(
        language === 'ta' ? 'அழிக்க முடியவில்லை' : 'Could not clear history',
        error?.message || 'Please try again.'
      );
    }
  };


  const headerSubtitle = screen === 'Dashboard'
    ? (language === 'ta' ? 'திட்ட மேலோட்டம்' : 'Project overview')
    : screen === 'Sheets'
      ? (selectedSheet
          ? (language === 'ta'
              ? ({project_setup: 'திட்ட அமைப்பு', floor_summary: 'தளச் சுருக்கம்'} as Record<string, string>)[selectedSheet] || SHEET_TITLES[selectedSheet]
              : SHEET_TITLES[selectedSheet])
          : (language === 'ta' ? 'திட்டப் பணித்தாள்கள்' : 'Project worksheets'))
      : language === 'ta'
        ? ({Expenses: 'தினசரி செலவுகள்', Progress: 'வேலை முன்னேற்றம்', Records: 'திட்டப் பதிவுகள்', Activity: 'செயல்பாட்டு பதிவு', Settings: 'அமைப்புகள்'} as Record<string, string>)[screen] || screen
        : screen;

  const renderScreen = () => {
    if (screen === 'Dashboard') return <Dashboard sheets={sheets} activities={activities} role={canEdit ? 'owner' : role} syncLabel={syncLabel} onOpen={openSheet} onAddExpense={addExpense} language={language} />;
    if (screen === 'Sheets') {
      if (!selectedSheet) return <SheetMenu onOpen={openSheet} language={language} />;
      if (selectedSheet === 'quotation_compare' && !sheets.quotation_compare) {
        return <View style={{padding:20}}><Text style={{fontSize:16, fontWeight:'800', color:C.ink}}>{language === 'ta' ? 'விலைப்புள்ளி ஒப்பீடு' : 'Quotation Compare'}</Text><Text style={{color:C.muted, marginTop:6}}>{language === 'ta' ? 'பணிப்புத்தகம் Firebase-இல் பதிவேற்றப்பட்டதும் இந்தக் கூடுதல் பகுதி உருவாக்கப்படும்.' : 'This extra module will be created when the workbook is imported to Firebase.'}</Text>{canEdit ? <TouchableOpacity onPress={async()=>{if(user){await ensureQuoteSheet(user.uid); Alert.alert(language === 'ta' ? 'தயார்' : 'Ready', language === 'ta' ? 'விலைப்புள்ளி ஒப்பீடு இப்போது கிடைக்கிறது.' : 'Quotation Compare is now available.')}}} style={{...buttonStyle(), marginTop:14}}><Text style={{color:'#FFF',fontWeight:'800'}}>{language === 'ta' ? 'ஒப்பீட்டுப் பணித்தாளை உருவாக்கு' : 'Create comparison sheet'}</Text></TouchableOpacity> : null}</View>;
      }
      return <SheetView sheetId={selectedSheet} sheet={selectedData} allSheets={sheets} role={canEdit ? 'owner' : role} language={language} onBack={() => {setSelectedSheet(''); setScreen('Dashboard');}} onEdit={(index: number) => startEdit(selectedSheet, index)} onAdd={() => startAdd(selectedSheet)} onDelete={(index: number) => deleteRecord(selectedSheet, index)} />;
    }
    if (screen === 'Expenses') return <View style={{flex:1}}><SheetView sheetId="daily_expenses" sheet={sheets.daily_expenses} allSheets={sheets} role={canEdit ? 'owner' : role} language={language} onBack={() => setScreen('Dashboard')} onEdit={(index: number) => startEdit('daily_expenses', index)} onAdd={() => startAdd('daily_expenses')} onDelete={(index: number) => deleteRecord('daily_expenses', index)} /></View>;
    if (screen === 'Progress') return <View style={{flex:1}}><SheetView sheetId="work_schedule" sheet={sheets.work_schedule} allSheets={sheets} role={canEdit ? 'owner' : role} language={language} onBack={() => setScreen('Dashboard')} onEdit={(index: number) => startEdit('work_schedule', index)} onAdd={() => startAdd('work_schedule')} onDelete={(index: number) => deleteRecord('work_schedule', index)} /></View>;
    if (screen === 'Records') return user && !demoMode ? <ProjectRecords uid={user.uid} owner={canEdit} sheets={sheets} sheetsLoaded={cloudSheetsLoaded} sheetsReady={cloudSheetsLoaded && cloudCount > 0} /> : <View style={{padding:20}}><Text style={{color:C.muted}}>Sign in to use synced project records.</Text></View>;
    if (screen === 'Activity') return <ActivityScreen activities={activities} language={language} canClear={canEdit} onClear={handleClearActivity}/>;
    return <SettingsScreen role={canEdit ? 'owner' : role} user={user} syncCount={cloudCount} cloudReady={!!db && !demoMode} initialising={initialising} onSeed={doSeed} onNotifications={doNotifications} onSignOut={performSignOut} onOriginal={() => Alert.alert('Original workbook', 'KSK_House_Cost.xlsx is included unchanged in the app project at assets/KSK_House_Cost.xlsx.')} language={language} onLanguageChange={changeLanguage} onExportExcel={exportExcel} onExportPdf={exportPdf}/>;
  };

  return <SafeAreaView style={{flex: 1, backgroundColor: C.paper}}>
    <StatusBar barStyle="dark-content" backgroundColor={C.paper}/>
    <View style={{height: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.paper}}>
      <View style={{flexDirection:'row', alignItems:'center', gap:10}}>
        <View style={{width:36,height:36,borderRadius:12,backgroundColor:C.dark,alignItems:'center',justifyContent:'center'}}><Text style={{color:'#FFF',fontWeight:'900',fontSize:12}}>KSK</Text></View>
        <View><Text style={{fontSize:15,fontWeight:'900',color:C.ink}}>KSK House</Text><Text style={{fontSize:10,color:C.muted}}>{headerSubtitle}</Text></View>
      </View>
      <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
        <View style={{width:7,height:7,borderRadius:6,backgroundColor:syncLabel === 'LIVE SYNC' ? '#2B9A69' : C.gold}}/>
        <Text style={{fontSize:10,fontWeight:'800',color:C.muted}}>{language === 'ta' ? (syncLabel === 'LIVE SYNC' ? 'நேரலை' : syncLabel === 'SAVING' ? 'சேமிப்பு' : 'முன்னோட்டம்') : (syncLabel === 'LIVE SYNC' ? 'LIVE' : syncLabel === 'SAVING' ? 'SAVING' : 'PREVIEW')}</Text>
      </View>
    </View>
    <View style={{flex:1}}>{renderScreen()}</View>

<View style={{height:66, backgroundColor:C.white, borderTopColor:C.line, borderTopWidth:1, flexDirection:'row', alignItems:'center', paddingHorizontal:2}}>
  {[
    ['Dashboard','⌂','Dashboard',''],
    ['Sheets','⚙','Project Setup','project_setup'],
    ['Expenses','₹','Daily Expenses','daily_expenses'],
    ['Sheets','▦','Floor Summary','floor_summary'],
    ['Records','▤','Project Records',''],
    ['Activity','◷','Activity',''],
    ['Settings','☰','Settings','']
  ].map(([id,icon,label,sheetId]) => {
    const active = id === 'Sheets'
      ? screen === 'Sheets' && selectedSheet === sheetId
      : screen === id;

    return (
      <TouchableOpacity
        key={label}
        onPress={() => {
          setScreen(id as any);
          setSelectedSheet(sheetId);
        }}
        style={{
          flex:1,
          alignItems:'center',
          justifyContent:'center',
          height:58,
          minWidth:0
        }}
      >
        <Text style={{
          fontSize:18,
          color:active ? C.green : '#82918B',
          fontWeight:'800'
        }}>
          {icon}
        </Text>
        <Text style={{
          fontSize:9,
          marginTop:3,
          color:active ? C.green : C.muted,
          fontWeight:active ? '900' : '600'
        }}>
          {language === 'ta'
            ? ({
                Dashboard:'முகப்பு',
                'Project Setup':'திட்ட அமைப்பு',
                'Daily Expenses':'தினசரி செலவுகள்',
                'Floor Summary':'தளச் சுருக்கம்',
                Activity:'செயல்பாடு',
                'Project Records':'திட்டப் பதிவுகள்',
                Settings:'அமைப்புகள்'
              } as Record<string,string>)[label] || label
            : label}
        </Text>
      </TouchableOpacity>
    );
  })}
</View>

    <RowEditor visible={modalVisible} sheetId={editingSheetId} sheet={sheets[editingSheetId]} allSheets={sheets} rowIndex={editingRow} isNew={editingIsNew} language={language} onClose={() => setModalVisible(false)} onSave={saveEditedSheet}/>
  </SafeAreaView>;
}
