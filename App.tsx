import React, {useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView,
  StatusBar, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import {Picker} from '@react-native-picker/picker';
import {SafeAreaView} from 'react-native-safe-area-context';
import {onAuthStateChanged, signInWithEmailAndPassword, signOut, User} from 'firebase/auth';
import {collection, doc, getDoc, onSnapshot} from 'firebase/firestore';
import {auth, db, isFirebaseConfigured} from './src/firebase';
import {LOCAL_WORKBOOK, SHEET_ORDER, SHEET_TITLES, ICONS, headersForSheet, meaningfulRows, displayCell, excelSerialToDate, dateToExcelSerial} from './src/data';
import {calculateDashboard, calculateFloorSummary, countMaterials} from './src/services/calculations';
import {enableNotifications} from './src/services/notifications';
import {saveSheet, seedWorkbook, subscribeActivities, subscribeSheets, ensureQuoteSheet} from './src/services/projectSync';
import {ActivityItem, Role, SheetDocument, SheetMap} from './src/types';

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

function Dashboard({sheets, activities, role, syncLabel, onOpen, onAddExpense}: any) {
  const stats = calculateDashboard(sheets);
  const setup = sheets.project_setup?.values || [];
  const project = setup?.[1]?.[1] || 'KSK';
  const location = setup?.[2]?.[1] || 'Thuvar';
  const builtUp = n(setup?.[4]?.[1]) + n(setup?.[5]?.[1]);
  const materialStats = countMaterials(sheets);
  const pctSpent = stats.totalBudget > 0 ? Math.min(100, stats.totalPaid / stats.totalBudget * 100) : 0;
  return <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 30}}>
    <View style={{backgroundColor: C.dark, borderRadius: 22, padding: 19, marginBottom: 15}}>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
        <View>
          <Text style={{color: '#BBD1C8', fontSize: 11, fontWeight: '800', letterSpacing: 1}}>HOUSE CONSTRUCTION</Text>
          <Text style={{color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 5}}>{project} Project</Text>
          <Text style={{color: '#D0E0D9', fontSize: 13, marginTop: 4}}>{location} · {builtUp.toLocaleString('en-IN')} sq ft · G + 1</Text>
        </View>
        <View style={{width: 52, height: 52, borderRadius: 17, backgroundColor: '#274C45', alignItems: 'center', justifyContent: 'center'}}><Text style={{color: '#FFF', fontSize: 17, fontWeight: '900'}}>KSK</Text></View>
      </View>
      <View style={{marginTop: 18, borderTopColor: '#31564F', borderTopWidth: 1, paddingTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}><View style={{width: 7, height: 7, borderRadius: 5, backgroundColor: syncLabel === 'LIVE SYNC' ? '#6DD3A5' : '#E8B968'}}/><Text style={{color: '#D0E0D9', fontSize: 11, fontWeight: '800'}}>{syncLabel}</Text></View>
        <Pill color={role === 'owner' ? '#D8EBE1' : '#EAF0F7'} textColor={role === 'owner' ? '#1C6255' : '#365775'}>{role === 'owner' ? 'OWNER · EDITOR' : role === 'viewer' ? 'FAMILY · VIEW ONLY' : 'LOCAL PREVIEW'}</Pill>
      </View>
    </View>

    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 15}}>
      <MetricCard label="Estimated budget" value={money(stats.totalBudget)} helper={`Includes ${money(stats.contingency)} contingency`} accent />
      <MetricCard label="Paid so far" value={money(stats.totalPaid)} helper={`${pctSpent.toFixed(1)}% of total budget`} />
      <MetricCard label="Balance budget" value={money(stats.totalRemaining)} helper="Budget remaining" />
      <MetricCard label="Construction progress" value={`${Math.round(stats.progress)}%`} helper="Average across scheduled activities" />
    </View>

    <View style={cardStyle({marginBottom: 14})}>
      <SectionTitle title="Budget utilisation" right="View breakdown" onRight={() => onOpen('floor_summary')} />
      <View style={{height: 10, backgroundColor: '#EAF0EC', borderRadius: 8, overflow: 'hidden'}}><View style={{height: 10, width: `${pctSpent}%`, backgroundColor: C.green, borderRadius: 8}} /></View>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 10}}>
        <Text style={{fontSize: 11, color: C.muted}}>Paid {money(stats.totalPaid)}</Text>
        <Text style={{fontSize: 11, color: C.muted}}>Budget {money(stats.totalBudget)}</Text>
      </View>
      <View style={{marginTop: 14, gap: 10}}>
        {[
          ['Materials', stats.materialsBudget, stats.materialsPaid],
          ['Labour & subcontractors', stats.labourBudget, stats.labourPaid],
          ['Engineer / professional fees', stats.feesBudget, stats.feesPaid],
          ['Equipment & misc.', stats.miscBudget, stats.miscPaid]
        ].map(([label, budget, paid]: any) => <View key={label}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4}}><Text style={{fontSize: 12, color: C.ink, fontWeight: '700'}}>{label}</Text><Text style={{fontSize: 12, color: C.muted}}>{money(paid)} / {money(budget)}</Text></View>
          <View style={{height: 5, backgroundColor: '#EEF2EF', borderRadius: 5}}><View style={{height: 5, width: `${budget ? Math.min(100, paid / budget * 100) : 0}%`, backgroundColor: C.green, borderRadius: 5}}/></View>
        </View>)}
      </View>
    </View>

    <View style={{flexDirection: 'row', gap: 10, marginBottom: 14}}>
      <View style={cardStyle({flex: 1})}><Text style={{fontSize: 11, color: C.muted, fontWeight: '700'}}>MATERIAL STOCK LINES</Text><Text style={{fontSize: 24, fontWeight: '900', color: C.ink, marginTop: 8}}>{materialStats.stockLines}</Text><Text style={{fontSize: 11, color: C.muted, marginTop: 4}}>{materialStats.received.toLocaleString('en-IN')} received units logged</Text></View>
      <View style={cardStyle({flex: 1})}><Text style={{fontSize: 11, color: C.muted, fontWeight: '700'}}>DAILY EXPENSES</Text><Text style={{fontSize: 24, fontWeight: '900', color: C.ink, marginTop: 8}}>{money(stats.dailyExpenses)}</Text><Text style={{fontSize: 11, color: C.muted, marginTop: 4}}>Across {meaningfulRows(sheets.daily_expenses || {values:[],formulas:[],name:'',range:''}).length} payment entries</Text></View>
    </View>

    <View style={cardStyle({marginBottom: 14})}>
      <SectionTitle title="Quick actions" />
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 9}}>
        <TouchableOpacity onPress={onAddExpense} style={{...buttonStyle(role !== 'owner'), flex: 1, minWidth: 125, opacity: role === 'owner' ? 1 : 0.55}}><Text style={{fontWeight: '800', color: '#FFF'}}>＋ Add expense</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => onOpen('materials_boq')} style={{...buttonStyle(false, true), flex: 1, minWidth: 125}}><Text style={{fontWeight: '800', color: C.green}}>▤ Materials</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => onOpen('labour_work')} style={{...buttonStyle(false, true), flex: 1, minWidth: 125}}><Text style={{fontWeight: '800', color: C.green}}>♧ Labour</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => onOpen('professional_fees')} style={{...buttonStyle(false, true), flex: 1, minWidth: 125}}><Text style={{fontWeight: '800', color: C.green}}>▣ Professional fees</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => onOpen('work_schedule')} style={{...buttonStyle(false, true), flex: 1, minWidth: 125}}><Text style={{fontWeight: '800', color: C.green}}>◷ Work progress</Text></TouchableOpacity>
      </View>
    </View>

    <View style={cardStyle()}>
      <SectionTitle title="Recent project updates" />
      {activities.length ? activities.slice(0, 4).map((item: ActivityItem) => <View key={item.id} style={{paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line}}><Text style={{fontSize: 13, fontWeight: '800', color: C.ink}}>{item.title || 'Project updated'}</Text><Text style={{fontSize: 11, color: C.muted, marginTop: 3}}>{item.body || 'Workbook data changed'}</Text></View>) : <Text style={{fontSize: 12, color: C.muted}}>Updates will appear here after cloud sync is connected.</Text>}
    </View>
  </ScrollView>;
}

function SheetMenu({onOpen}: any) {
  return <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 35}}>
    <Text style={{fontSize: 13, color: C.muted, lineHeight: 19, marginBottom: 15}}>All 11 tabs from the workbook are available here. Quote comparison is added as a separate module because it is referenced in the workbook instructions but not present as an Excel tab.</Text>
    <View style={{gap: 9}}>
      {[...SHEET_ORDER, 'quotation_compare'].map(id => <TouchableOpacity key={id} onPress={() => onOpen(id)} style={{...cardStyle({padding: 15}), flexDirection: 'row', alignItems: 'center'}}>
        <View style={{width: 42, height: 42, borderRadius: 14, backgroundColor: C.green2, alignItems: 'center', justifyContent: 'center', marginRight: 13}}><Text style={{fontSize: 20, color: C.green, fontWeight: '800'}}>{ICONS[id]}</Text></View>
        <View style={{flex: 1}}><Text style={{fontSize: 14, fontWeight: '800', color: C.ink}}>{SHEET_TITLES[id]}</Text><Text style={{fontSize: 11, color: C.muted, marginTop: 3}}>{id === 'quotation_compare' ? 'Compare up to three supplier quotations' : 'Open worksheet and manage records'}</Text></View>
        <Text style={{fontSize: 20, color: C.muted}}>›</Text>
      </TouchableOpacity>)}
    </View>
  </ScrollView>;
}

function titleIndex(headers: string[], candidates: string[]) {
  return headers.findIndex(h => candidates.some(c => h.toLowerCase().includes(c)));
}

function RecordCard({sheetId, sheet, row, rowIndex, canEdit, canDelete, onEdit, onDelete}: any) {
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
        <Text style={{fontSize: 14, color: C.ink, fontWeight: '800'}}>{String(primary || 'Untitled record')}</Text>
        {info.slice(0, 2).map((item, i) => <Text key={i} style={{fontSize: 11, color: C.muted, marginTop: 4}}>{item}</Text>)}
      </View>
      {canEdit ? <View style={{flexDirection: 'row', gap: 6}}>
        <TouchableOpacity onPress={() => onEdit(rowIndex)} style={{paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: C.green2}}><Text style={{fontSize: 11, color: C.green, fontWeight: '800'}}>Edit</Text></TouchableOpacity>
        {canDelete ? <TouchableOpacity onPress={() => onDelete(rowIndex)} style={{paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, backgroundColor: '#FDECEC'}}><Text style={{fontSize: 11, color: '#B42318', fontWeight: '800'}}>Delete</Text></TouchableOpacity> : null}
      </View> : <Pill color={C.blueBg} textColor="#365775">VIEW</Pill>}
    </View>
    {info.length > 2 || formulaCount ? <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10}}>
      {info.slice(2).map((item, i) => <Pill key={i}>{item}</Pill>)}
      {formulaCount ? <Pill color={C.goldBg} textColor={C.gold}>{formulaCount} formula field{formulaCount > 1 ? 's' : ''}</Pill> : null}
    </View> : null}
  </View>;
}

function SheetView({sheetId, sheet, allSheets, role, onBack, onEdit, onAdd, onDelete}: any) {
  if (!sheet) return <View style={{padding: 24}}><Text style={{color: C.muted}}>This sheet is not available in the cloud yet. The owner can initialise the workbook from Settings.</Text></View>;
  const headers = headersForSheet(sheetId, sheet);
  const readOnly = role !== 'owner' || ['project_dashboard', 'floor_summary'].includes(sheetId);
  const records = ['project_dashboard', 'floor_summary'].includes(sheetId) ? [] : meaningfulRows(sheet);
  const title = SHEET_TITLES[sheetId] || sheet.name;
  return <View style={{flex: 1}}>
    <View style={{paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
      <TouchableOpacity onPress={onBack} style={{padding: 8, marginLeft: -8}}><Text style={{fontSize: 14, color: C.green, fontWeight: '800'}}>‹ All sheets</Text></TouchableOpacity>
      {!readOnly ? <TouchableOpacity onPress={onAdd} style={{...buttonStyle(), paddingVertical: 9}}><Text style={{fontSize: 12, color: '#FFF', fontWeight: '800'}}>＋ Add record</Text></TouchableOpacity> : <Pill color={C.blueBg} textColor="#365775">READ ONLY</Pill>}
    </View>
    <ScrollView contentContainerStyle={{paddingHorizontal: 16, paddingBottom: 30}}>
      <View style={cardStyle({marginBottom: 13, padding: 14})}>
        <Text style={{fontSize: 18, fontWeight: '900', color: C.ink}}>{title}</Text>
        <Text style={{fontSize: 11, color: C.muted, marginTop: 4}}>{records.length} populated record{records.length === 1 ? '' : 's'} · Imported from KSK_House_Cost.xlsx</Text>
        {sheetId === 'project_setup' ? <Text style={{fontSize: 11, color: C.muted, marginTop: 6}}>Select a setting row to edit its value or notes.</Text> : null}
        {sheetId === 'project_dashboard' ? <DashboardFormulaSummary stats={calculateDashboard(allSheets || {})} /> : null}
        {sheetId === 'floor_summary' ? <FloorSummaryBlock sheets={allSheets || {}} /> : null}
      </View>
      {records.length ? records.map(({row, index}: any) => <RecordCard key={`${sheetId}-${index}`} sheetId={sheetId} sheet={sheet} row={row} rowIndex={index} canEdit={!readOnly} canDelete={!readOnly && sheetId === 'daily_expenses'} onEdit={onEdit} onDelete={onDelete} />) : !['project_dashboard', 'floor_summary'].includes(sheetId) ? <View style={cardStyle()}><Text style={{color: C.muted, fontSize: 13}}>No records entered yet.</Text></View> : null}
    </ScrollView>
  </View>;
}

function DashboardFormulaSummary({stats}: any) {
  const cells = [
    ['Materials', stats.materialsBudget, stats.materialsPaid],
    ['Labour & subcontractors', stats.labourBudget, stats.labourPaid],
    ['Professional fees', stats.feesBudget, stats.feesPaid],
    ['Equipment & misc.', stats.miscBudget, stats.miscPaid],
    ['Contingency', stats.contingency, 0],
    ['TOTAL', stats.totalBudget, stats.totalPaid]
  ];
  return <View style={{marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, gap: 8}}>
    <View style={{flexDirection:'row',justifyContent:'space-between'}}><Text style={{fontSize:10,color:C.muted,fontWeight:'800',flex:1}}>COST HEAD</Text><Text style={{fontSize:10,color:C.muted,fontWeight:'800',width:88,textAlign:'right'}}>BUDGET</Text><Text style={{fontSize:10,color:C.muted,fontWeight:'800',width:88,textAlign:'right'}}>PAID</Text></View>
    {cells.map(([label,budget,paid]: any) => <View key={label} style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}><Text style={{fontSize:11,color:C.ink,fontWeight:label === 'TOTAL' ? '900' : '600',flex:1}}>{label}</Text><Text style={{fontSize:11,color:C.ink,fontWeight:'800',width:88,textAlign:'right'}}>{money(budget)}</Text><Text style={{fontSize:11,color:C.green,fontWeight:'800',width:88,textAlign:'right'}}>{money(paid)}</Text></View>)}
    <Text style={{fontSize:10,color:C.muted}}>Daily expense ledger: {money(stats.dailyExpenses)} · Remaining budget: {money(stats.totalRemaining)}</Text>
  </View>;
}

function FloorSummaryBlock({sheets}: any) {
  const values = calculateFloorSummary(sheets);
  return <View style={{marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10, gap: 8}}>{values.map(item => <View key={item.floor} style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}><View style={{flex: 1}}><Text style={{fontSize: 12, color: C.ink, fontWeight: '800'}}>{item.floor}</Text><Text style={{fontSize: 10, color: C.muted, marginTop: 2}}>Materials {money(item.materials)} · Labour {money(item.labour)}</Text></View><Text style={{fontSize: 12, color: C.ink, fontWeight: '900'}}>{money(item.total)}</Text></View>)}</View>;
}

function RowEditor({visible, sheetId, sheet, rowIndex, isNew, onClose, onSave}: any) {
  const headers = headersForSheet(sheetId, sheet || {values: [[]]});
  const [values, setValues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
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
      Alert.alert('Could not save', e?.message || 'Please try again.');
    } finally { setSaving(false); }
  };

  if (!sheet || rowIndex === null) return null;
  const currentFormulaRow = sheet.formulas?.[rowIndex] || [];
  return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
    <View style={{flex: 1, backgroundColor: 'rgba(11,28,24,0.45)', justifyContent: 'flex-end'}}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{backgroundColor: C.paper, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', padding: 18}}>
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12}}>
            <View><Text style={{fontSize: 18, fontWeight: '900', color: C.ink}}>{isNew ? 'New record' : 'Edit record'}</Text><Text style={{fontSize: 11, color: C.muted, marginTop: 3}}>{SHEET_TITLES[sheetId] || sheet.name}</Text></View>
            <TouchableOpacity onPress={onClose} style={{padding: 8}}><Text style={{fontSize: 22, color: C.muted}}>×</Text></TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingBottom: 12}}>
            {headers.map((h: string, i: number) => {
              if (!h) return null;
              const formula = !!currentFormulaRow[i];
              return <View key={`${h}-${i}`} style={{marginBottom: 11}}>
                <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5}}>
                  <Text style={{fontSize: 11, fontWeight: '800', color: C.muted}}>{h.toUpperCase()}</Text>
                  {formula ? <Text style={{fontSize: 10, color: C.gold, fontWeight: '800'}}>FORMULA · LOCKED</Text> : null}
                </View>
                {(() => {
                  const optionsByHeader: Record<string, string[]> = {
                    'Floor / Area': ['Ground Floor', 'First Floor', 'Common/External'],
                    'Work Stage': ['Site Prep', 'Foundation', 'Plinth', 'Structure', 'Brickwork', 'Roof Slab', 'Plastering', 'Plumbing', 'Electrical', 'Flooring', 'Painting', 'Finishing', 'External Works'],
                    'Expense Category': ['Material', 'Engineer/Architect', 'Labour', 'Equipment', 'Transport', 'Other'],
                    'Payment Mode': ['UPI', 'Bank Transfer', 'Cash', 'Cheque'],
                    'Paid By': ['Vengadesh', 'Kanakaraj'],
                    'Bill Received?': ['Yes', 'No']
                  };
                  const options = sheetId === 'daily_expenses' ? optionsByHeader[h] : undefined;

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
                          <Picker.Item label={`Select ${h}`} value="" />
                          {options.map(option => (
                            <Picker.Item key={option} label={option} value={option} />
                          ))}
                        </Picker>
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
                      placeholder={isDateHeader(h) ? 'YYYY-MM-DD' : `Enter ${h.toLowerCase()}`}
                      placeholderTextColor="#9AA8A2"
                      style={{backgroundColor: formula ? '#E8EDE9' : C.white, borderWidth: 1, borderColor: C.line, borderRadius: 11, padding: 12, color: formula ? C.muted : C.ink, minHeight: /notes|scope|specification/i.test(h) ? 68 : 45, textAlignVertical: 'top'}}
                    />
                  );
                })()}
              </View>;
            })}
          </ScrollView>
          <View style={{flexDirection: 'row', gap: 9, paddingTop: 10}}>
            <TouchableOpacity onPress={onClose} style={{...buttonStyle(false, true), flex: 1}}><Text style={{fontWeight: '800', color: C.green}}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity disabled={saving} onPress={save} style={{...buttonStyle(saving), flex: 1}}>{saving ? <ActivityIndicator color="#FFF"/> : <Text style={{fontWeight: '800', color: '#FFF'}}>Save changes</Text>}</TouchableOpacity>
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
    set(15, `=IF(OR(O${excelRow}="",J${excelRow}=""),"",O${excelRow}*J${excelRow})`);
    set(16, `=IF(G${excelRow}="","",G${excelRow}-IF(O${excelRow}="",0,O${excelRow}))`);
  }
  return result;
}

function appendedSheet(sheetId: string, sheet: SheetDocument): {next: SheetDocument; rowIndex: number} {
  const next: SheetDocument = {...sheet, values: sheet.values.map(r => [...r]), formulas: sheet.formulas.map(r => [...r])};
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
  if (sheetId === 'professional_fees' && next.formulas[2]) {
    // Keep the original payment roll-up formula but extend it to include appended payment rows.
    next.formulas[2][9] = `=SUM(H4:H${next.values.length})`;
  }
  return {next, rowIndex: next.values.length - 1};
}

function ActivityScreen({activities}: {activities: ActivityItem[]}) {
  return <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 30}}>
    <View style={cardStyle({marginBottom: 12})}><Text style={{fontSize: 18, fontWeight: '900', color: C.ink}}>Project notifications</Text><Text style={{fontSize: 12, lineHeight: 18, color: C.muted, marginTop: 5}}>Changes made by the owner appear here and can also arrive as Android push notifications when the device is registered.</Text></View>
    {activities.length ? activities.map(a => <View key={a.id} style={cardStyle({marginBottom: 9})}><Pill>{a.sheetName || 'Project update'}</Pill><Text style={{fontSize: 14, fontWeight: '800', color: C.ink, marginTop: 9}}>{a.title || 'KSK House updated'}</Text><Text style={{fontSize: 12, color: C.muted, marginTop: 4}}>{a.body || 'New construction data is available.'}</Text></View>) : <View style={cardStyle()}><Text style={{fontSize: 12, color: C.muted}}>No cloud updates yet.</Text></View>}
  </ScrollView>;
}

function SettingsScreen({role, user, syncCount, cloudReady, initialising, onSeed, onNotifications, onSignOut, onOriginal}: any) {
  return <ScrollView contentContainerStyle={{padding: 16, paddingBottom: 35}}>
    <View style={cardStyle({marginBottom: 12})}>
      <Text style={{fontSize: 18, fontWeight: '900', color: C.ink}}>Account & access</Text>
      <Text style={{fontSize: 12, color: C.muted, marginTop: 9}}>{user?.email || 'Local workbook preview'}</Text>
      <View style={{flexDirection: 'row', gap: 8, marginTop: 12}}><Pill color={role === 'owner' ? C.green2 : C.blueBg} textColor={role === 'owner' ? C.green : '#365775'}>{role === 'owner' ? 'OWNER · EDITOR' : role === 'viewer' ? 'FATHER · READ ONLY' : 'PREVIEW'}</Pill><Pill color={C.green2}>{cloudReady ? 'Cloud connected' : 'Cloud not connected'}</Pill></View>
      <Text style={{fontSize: 11, lineHeight: 18, color: C.muted, marginTop: 13}}>The owner account can update every worksheet. A viewer account can read and receive notifications but cannot write to the project. Access is enforced by Firestore security rules, not just by hiding edit buttons.</Text>
    </View>
    <View style={cardStyle({marginBottom: 12})}>
      <Text style={{fontSize: 16, fontWeight: '800', color: C.ink}}>Cloud workbook</Text>
      <Text style={{fontSize: 12, color: C.muted, marginTop: 5}}>{syncCount} workbook sheets currently stored in the cloud.</Text>
      {role === 'owner' && cloudReady && syncCount === 0 ? <TouchableOpacity disabled={initialising} onPress={onSeed} style={{...buttonStyle(initialising), marginTop: 14}}>{initialising ? <ActivityIndicator color="#FFF"/> : <Text style={{color: '#FFF', fontWeight: '800'}}>Import workbook to cloud</Text>}</TouchableOpacity> : null}
      {role === 'viewer' && syncCount === 0 ? <Text style={{fontSize: 12, color: C.gold, marginTop: 12}}>Waiting for the owner to import the workbook into the cloud.</Text> : null}
      <TouchableOpacity onPress={onOriginal} style={{...buttonStyle(false, true), marginTop: 10}}><Text style={{color: C.green, fontWeight: '800'}}>Original Excel workbook included in project</Text></TouchableOpacity>
    </View>
    <View style={cardStyle({marginBottom: 12})}>
      <Text style={{fontSize: 16, fontWeight: '800', color: C.ink}}>Notifications</Text>
      <Text style={{fontSize: 12, color: C.muted, lineHeight: 18, marginTop: 5}}>Register this phone to receive an Android notification when the owner changes a worksheet.</Text>
      <TouchableOpacity onPress={onNotifications} style={{...buttonStyle(false, true), marginTop: 13}}><Text style={{color: C.green, fontWeight: '800'}}>Enable this device</Text></TouchableOpacity>
    </View>
    <TouchableOpacity onPress={onSignOut} style={{...buttonStyle(false, true), marginTop: 3}}><Text style={{color: C.red, fontWeight: '800'}}>Sign out</Text></TouchableOpacity>
  </ScrollView>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [roleChecked, setRoleChecked] = useState(false);
  const [sheets, setSheets] = useState<SheetMap>(LOCAL_WORKBOOK);
  const [cloudCount, setCloudCount] = useState(0);
  const [syncState, setSyncState] = useState('LOCAL PREVIEW');
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [screen, setScreen] = useState<'Dashboard'|'Sheets'|'Expenses'|'Progress'|'Activity'|'Settings'>('Dashboard');
  const [selectedSheet, setSelectedSheet] = useState('');
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editingSheetId, setEditingSheetId] = useState('');
  const [editingIsNew, setEditingIsNew] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [initialising, setInitialising] = useState(false);
  const [demoMode, setDemoMode] = useState(false);

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
    setSyncState('CONNECTING');
    const stopSheets = subscribeSheets((remote, count) => {
      setCloudCount(count);
      setSheets(current => ({...current, ...remote}));
      setSyncState('LIVE SYNC');
    }, () => setSyncState('SYNC ERROR'));
    const stopActivity = subscribeActivities(setActivities, () => {});
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
    await saveSheet(editingSheetId, next, user.uid);
    setSheets(current => ({...current, [editingSheetId]: next}));
    setSyncState('LIVE SYNC');
  };

  const deleteExpense = (rowIndex: number) => {
    if (role !== 'owner' || !user || !db || demoMode) {
      Alert.alert('Cannot delete', 'Only the connected project owner can delete expenses.');
      return;
    }

    Alert.alert(
      'Delete expense?',
      'This expense will be permanently deleted. Dashboard and Floor Summary totals will be updated.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const current = sheets.daily_expenses;
            if (!current || rowIndex <= 0 || rowIndex >= (current.values || []).length) {
              Alert.alert('Delete failed', 'The selected expense could not be found.');
              return;
            }

            const next: SheetDocument = {
              ...current,
              values: [...(current.values || [])],
              formulas: [...(current.formulas || [])]
            };
            next.values.splice(rowIndex, 1);
            next.formulas.splice(rowIndex, 1);

            try {
              setSyncState('SAVING');
              await saveSheet('daily_expenses', next, user.uid);
              setSheets(previous => ({...previous, daily_expenses: next}));
              setSyncState('LIVE SYNC');
              Alert.alert('Deleted', 'The expense has been deleted successfully.');
            } catch (e: any) {
              setSyncState('SYNC ERROR');
              Alert.alert('Delete failed', e?.message || 'Please try again.');
            }
          }
        }
      ]
    );
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
    if (!user || demoMode) {Alert.alert('Sign in required', 'Sign in to register this phone for cloud notifications.'); return;}
    try {const message = await enableNotifications(user.uid); Alert.alert('Notifications', message);}
    catch (e: any) {Alert.alert('Notification setup', e?.message || 'Could not register this device.');}
  };

  if (isFirebaseConfigured && !demoMode && (!user || !roleChecked || !role)) {
    if (!user) return <LoginScreen onLogin={signIn} demo={() => {setDemoMode(true); setSheets(LOCAL_WORKBOOK);}} />;
    if (!roleChecked) return <SafeAreaView style={{flex:1, backgroundColor:C.paper, justifyContent:'center', alignItems:'center'}}><ActivityIndicator color={C.green}/><Text style={{color:C.muted, marginTop:12}}>Checking project access…</Text></SafeAreaView>;
    return <SafeAreaView style={{flex:1, backgroundColor:C.paper, justifyContent:'center', padding:24}}><View style={cardStyle()}><Text style={{fontSize:20, fontWeight:'900', color:C.ink}}>Access not assigned</Text><Text style={{fontSize:13, lineHeight:20, color:C.muted, marginTop:9}}>This Firebase account does not have an owner or viewer role in the KSK project. Ask the project administrator to assign the role in Firestore, then sign in again.</Text><TouchableOpacity onPress={performSignOut} style={{...buttonStyle(), marginTop:16}}><Text style={{color:'#FFF', fontWeight:'800'}}>Sign out</Text></TouchableOpacity></View></SafeAreaView>;
  }

  const syncLabel = demoMode || !user ? 'LOCAL PREVIEW' : syncState;
  const canEdit = role === 'owner' && !demoMode && !!user;
  const selectedData = selectedSheet ? (sheets[selectedSheet] || (selectedSheet === 'quotation_compare' ? undefined : undefined)) : undefined;
  const recordsCount = selectedData ? meaningfulRows(selectedData).length : 0;

  const renderScreen = () => {
    if (screen === 'Dashboard') return <Dashboard sheets={sheets} activities={activities} role={canEdit ? 'owner' : role} syncLabel={syncLabel} onOpen={openSheet} onAddExpense={addExpense} />;
    if (screen === 'Sheets') {
      if (!selectedSheet) return <SheetMenu onOpen={openSheet} />;
      if (selectedSheet === 'quotation_compare' && !sheets.quotation_compare) {
        return <View style={{padding:20}}><Text style={{fontSize:16, fontWeight:'800', color:C.ink}}>Quotation Compare</Text><Text style={{color:C.muted, marginTop:6}}>This extra module will be created when the workbook is imported to Firebase.</Text>{canEdit ? <TouchableOpacity onPress={async()=>{if(user){await ensureQuoteSheet(user.uid); Alert.alert('Ready','Quotation Compare is now available.')}}} style={{...buttonStyle(), marginTop:14}}><Text style={{color:'#FFF',fontWeight:'800'}}>Create comparison sheet</Text></TouchableOpacity> : null}</View>;
      }
      return <SheetView sheetId={selectedSheet} sheet={selectedData} allSheets={sheets} role={canEdit ? 'owner' : role} onBack={() => {setSelectedSheet(''); setScreen('Dashboard');}} onEdit={(index: number) => startEdit(selectedSheet, index)} onAdd={() => startAdd(selectedSheet)} />;
    }
    if (screen === 'Expenses') return <View style={{flex:1}}><SheetView sheetId="daily_expenses" sheet={sheets.daily_expenses} allSheets={sheets} role={canEdit ? 'owner' : role} onBack={() => setScreen('Dashboard')} onEdit={(index: number) => startEdit('daily_expenses', index)} onAdd={() => startAdd('daily_expenses')} onDelete={deleteExpense} /></View>;
    if (screen === 'Progress') return <View style={{flex:1}}><SheetView sheetId="work_schedule" sheet={sheets.work_schedule} allSheets={sheets} role={canEdit ? 'owner' : role} onBack={() => setScreen('Dashboard')} onEdit={(index: number) => startEdit('work_schedule', index)} onAdd={() => startAdd('work_schedule')} /></View>;
    if (screen === 'Activity') return <ActivityScreen activities={activities}/>;
    return <SettingsScreen role={canEdit ? 'owner' : role} user={user} syncCount={cloudCount} cloudReady={!!db && !demoMode} initialising={initialising} onSeed={doSeed} onNotifications={doNotifications} onSignOut={performSignOut} onOriginal={() => Alert.alert('Original workbook', 'KSK_House_Cost.xlsx is included unchanged in the app project at assets/KSK_House_Cost.xlsx.')} />;
  };

  return <SafeAreaView style={{flex: 1, backgroundColor: C.paper}}>
    <StatusBar barStyle="dark-content" backgroundColor={C.paper}/>
    <View style={{height: 58, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.paper}}>
      <View style={{flexDirection:'row', alignItems:'center', gap:10}}>
        <View style={{width:36,height:36,borderRadius:12,backgroundColor:C.dark,alignItems:'center',justifyContent:'center'}}><Text style={{color:'#FFF',fontWeight:'900',fontSize:12}}>KSK</Text></View>
        <View><Text style={{fontSize:15,fontWeight:'900',color:C.ink}}>KSK House</Text><Text style={{fontSize:10,color:C.muted}}>{screen === 'Dashboard' ? 'Project overview' : screen === 'Sheets' ? (selectedSheet ? SHEET_TITLES[selectedSheet] : 'Project worksheets') : screen}</Text></View>
      </View>
      <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
        <View style={{width:7,height:7,borderRadius:6,backgroundColor:syncLabel === 'LIVE SYNC' ? '#2B9A69' : C.gold}}/>
        <Text style={{fontSize:10,fontWeight:'800',color:C.muted}}>{syncLabel === 'LIVE SYNC' ? 'LIVE' : syncLabel === 'SAVING' ? 'SAVING' : 'PREVIEW'}</Text>
      </View>
    </View>
    <View style={{flex:1}}>{renderScreen()}</View>
    <View style={{height:64, backgroundColor:C.white, borderTopColor:C.line, borderTopWidth:1, flexDirection:'row', justifyContent:'space-around', alignItems:'center', paddingBottom: Platform.OS === 'android' ? 3 : 0}}>
      {[
        ['Dashboard','⌂','Dashboard',''],
        ['Sheets','⚙','Project Setup','project_setup'],
        ['Expenses','₹','Daily Expenses','daily_expenses'],
        ['Sheets','▦','Floor Summary','floor_summary']
      ].map(([id,icon,label,sheetId]) => <TouchableOpacity key={label} onPress={() => {setScreen(id as any); setSelectedSheet(sheetId);}} style={{alignItems:'center',justifyContent:'center',width:82,height:52}}>
        <Text style={{fontSize:18,color:(id === 'Dashboard' ? screen === id : selectedSheet === sheetId) ? C.green : '#82918B',fontWeight:'800'}}>{icon}</Text>
        <Text style={{fontSize:10,marginTop:3,color:(id === 'Dashboard' ? screen === id : selectedSheet === sheetId) ? C.green : C.muted,fontWeight:(id === 'Dashboard' ? screen === id : selectedSheet === sheetId) ? '900' : '600'}}>{label}</Text>
      </TouchableOpacity>)}
    </View>
    <RowEditor visible={modalVisible} sheetId={editingSheetId} sheet={sheets[editingSheetId]} rowIndex={editingRow} isNew={editingIsNew} onClose={() => setModalVisible(false)} onSave={saveEditedSheet}/>
  </SafeAreaView>;
}
