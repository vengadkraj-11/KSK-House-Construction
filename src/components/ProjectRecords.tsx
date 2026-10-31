import React, {useEffect, useMemo, useRef, useState} from 'react';
import {ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {Picker} from '@react-native-picker/picker';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {addProjectRecord, cancelReminderRecord, dateLabel, decideApproval, deletePaymentRecord, newProjectRecordId, ProjectRecord, ProjectRecordType, setReminderDate, subscribeProjectRecords} from '../services/projectRecords';
import BillAttachments from './BillAttachments';
import {cancelLocalReminder, reconcileLocalReminders, scheduleLocalReminder} from '../services/notifications';
import {exportProjectBackup, importProjectBackup} from '../services/projectBackup';
import {exportPaymentReceiptPdf, exportPaymentStatementPdf, exportProjectReportPdf, exportProjectReports} from '../services/projectReports';
import {summarizeContracts, summarizeInventory} from '../services/recordMath';
import {getMaterialOptions} from '../services/materialOptions';
import {paymentIdForDocument, summarizePaymentRecords, validatePaymentRecord} from '../services/paymentMath';
import {canCreateVoucherPayment, getDailyExpenseVoucherRows, validateAgreementLink, voucherRemainingAmount} from '../services/projectRecordLinks';

type Field = {key: string; label: string; placeholder?: string; numeric?: boolean; options?: string[]};
type Module = {type: ProjectRecordType; title: string; fields: Field[]};
const modules: Module[] = [
  {type:'payments', title:'Payments & receipts', fields:[
    {key:'voucherNumber',label:'Voucher / Bill number'}, {key:'paymentReference',label:'Payment reference number'}, {key:'category',label:'Payment category'}, {key:'status',label:'Payment status',options:['paid','pending','partially-paid','cancelled']},
    {key:'paymentTo',label:'Paid to / vendor'}, {key:'person',label:'Person / party'}, {key:'contractId',label:'Agreement',options:[]},
    {key:'paymentKind',label:'Classification',options:['advance','payment']},
    {key:'amount',label:'Actual amount paid (₹)',numeric:true}, {key:'currency',label:'Currency',placeholder:'₹'}, {key:'date',label:'Payment date',placeholder:'YYYY-MM-DD'},
    {key:'description',label:'Description / item'}, {key:'floor',label:'Floor / Area'}, {key:'stage',label:'Work Stage'},
    {key:'paidBy',label:'Paid by'}, {key:'method',label:'Payment mode'}, {key:'receivedBy',label:'Received by'}, {key:'enteredBy',label:'Entered by'}, {key:'reference',label:'Transaction / reference number'},
    {key:'billReceived',label:'Bill received?'}, {key:'receiptType',label:'Receipt type'}, {key:'receiptReference',label:'Receipt reference'}, {key:'notes',label:'Notes'}
  ]},
  {type:'contracts', title:'Agreements', fields:[
    {key:'person',label:'Person / party'}, {key:'category',label:'Contractor / engineer / labour / supplier'},
    {key:'agreedAmount',label:'Agreed amount (₹)',numeric:true}, {key:'startDate',label:'Start date',placeholder:'YYYY-MM-DD'}, {key:'notes',label:'Notes'}
  ]},
  {type:'stock', title:'Inventory movements', fields:[
    {key:'material',label:'Material'}, {key:'category',label:'Category'}, {key:'unit',label:'Unit'},
    {key:'direction',label:'Movement',options:['purchase','received','returned-to-stock','returned-to-supplier','used','wastage']},
    {key:'quantity',label:'Quantity',numeric:true}, {key:'unitRate',label:'Unit rate (₹)',numeric:true},
    {key:'lowStockLevel',label:'Low-stock threshold',numeric:true}, {key:'date',label:'Date',placeholder:'YYYY-MM-DD'}, {key:'supplier',label:'Supplier'}, {key:'notes',label:'Notes'}
  ]},
  {type:'progress', title:'Work progress', fields:[
    {key:'stage',label:'Activity'}, {key:'floor',label:'Floor / area'}, {key:'percent',label:'Completion (%)',numeric:true},
    {key:'plannedDate',label:'Planned finish',placeholder:'YYYY-MM-DD'}, {key:'actualDate',label:'Actual finish',placeholder:'YYYY-MM-DD'}, {key:'responsiblePerson',label:'Responsible person'}, {key:'notes',label:'Notes'}
  ]},
  {type:'diary', title:'Site diary', fields:[
    {key:'title',label:'Entry title'}, {key:'date',label:'Date',placeholder:'YYYY-MM-DD'}, {key:'floor',label:'Floor / area'}, {key:'stage',label:'Work completed'},
    {key:'attendance',label:'Labour attendance'}, {key:'issues',label:'Issues'}, {key:'decisions',label:'Decisions'}, {key:'description',label:'Notes'}
  ]},
  {type:'approvals', title:'Approvals', fields:[
    {key:'expenseRef',label:'Expense / purchase / decision'}, {key:'payee',label:'Person / party'}, {key:'amount',label:'Amount (₹)',numeric:true}, {key:'decisionNote',label:'Request details'}
  ]},
  {type:'reminders', title:'Device reminders', fields:[
    {key:'title',label:'Reminder'}, {key:'person',label:'Person / party'}, {key:'amount',label:'Amount (₹)',numeric:true}, {key:'dueDate',label:'Due date',placeholder:'YYYY-MM-DD'}, {key:'notes',label:'Notes'}
  ]}
];
const ink='#18352B', muted='#718078', green='#176B4B', line='#E3EAE5', white='#FFFFFF';
const money = (amount: number) => `₹${amount.toLocaleString('en-IN', {maximumFractionDigits: 2})}`;

export default function ProjectRecords({uid, owner, sheets, sheetsReady, sheetsLoaded}: {uid: string; owner: boolean; sheets:any; sheetsReady:boolean; sheetsLoaded:boolean}) {
  const [active, setActive] = useState<ProjectRecordType>(owner ? 'payments' : 'payments');
  const visibleModules = owner ? modules : modules.filter(module => ['payments','contracts','stock','progress','diary'].includes(module.type));
  const [records, setRecords] = useState<Record<string,ProjectRecord[]>>({});
  const [loaded, setLoaded] = useState<Record<string,boolean>>({});
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef=useRef(false);
  const deletingPaymentRef=useRef<string|null>(null);
  const [deletingPaymentId,setDeletingPaymentId]=useState<string|null>(null);
  const [values, setValues] = useState<Record<string,string>>({});
  const [editingId, setEditingId] = useState<string | undefined>();
  const [pendingCreateId, setPendingCreateId] = useState<string | undefined>();
  const [pendingActivityId, setPendingActivityId] = useState<string | undefined>();
  const [decisionNotes, setDecisionNotes] = useState<Record<string,string>>({});
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reminderDates, setReminderDates] = useState<Record<string,string>>({});
  const [toolBusy, setToolBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const [historyCounts, setHistoryCounts] = useState<Record<string,number>>({});
  const [paymentSearch, setPaymentSearch] = useState('');
  const [paymentStart, setPaymentStart] = useState('');
  const [paymentEnd, setPaymentEnd] = useState('');
  const [paymentCategory, setPaymentCategory] = useState('');
  const [paymentMode, setPaymentMode] = useState('');
  const [paymentContract, setPaymentContract] = useState('');
  const [paymentSort, setPaymentSort] = useState('newest');
  const [showPaymentDatePicker, setShowPaymentDatePicker] = useState(false);
  const [retrySubscriptions, setRetrySubscriptions] = useState(0);
  const current = visibleModules.find(module => module.type === active) || visibleModules[0];
  const items = records[current.type] || [];
  const contracts = records.contracts || [];
  const requiredReportTypes:ProjectRecordType[]=['payments','contracts','stock','progress','diary'];
  const reportsReady=sheetsReady&&requiredReportTypes.every(type=>loaded[type]&&!errors[type]);
  const reportsLoading=!sheetsLoaded||requiredReportTypes.some(type=>!loaded[type]);
  const reportStatus=visibleModules.map(module=>({name:module.title,state:errors[module.type]?'failed':loaded[module.type]?(records[module.type]?.length?'loaded':'empty'):'loading',error:errors[module.type]||''}));

  useEffect(() => {
    setRecords({}); setLoaded({}); setErrors({}); setActive('payments');
    const stops = visibleModules.map(module => subscribeProjectRecords(module.type, rows => {
      setRecords(old => ({...old, [module.type]: rows}));
      setLoaded(old => ({...old, [module.type]: true}));
      setErrors(old => ({...old, [module.type]: ''}));
    }, message => { setErrors(old => ({...old, [module.type]: message})); setLoaded(old => ({...old, [module.type]: true})); }, uid));
    return () => stops.forEach(stop => stop());
  }, [owner, uid, retrySubscriptions]);

  useEffect(()=>{
    if(owner&&uid&&records.reminders)void reconcileLocalReminders(uid,records.reminders).catch(error=>console.warn('Could not sync local reminders',error));
  },[owner,uid,records.reminders]);

  const contractLedger = useMemo(() => summarizeContracts(contracts,records.payments||[]), [contracts, records.payments]);
  const inventory = useMemo(() => summarizeInventory(records.stock||[]), [records.stock]);
  const expenseRows = useMemo(() => getDailyExpenseVoucherRows(sheets?.daily_expenses),[sheets]);
  const materialOptions=useMemo(()=>[...new Set([...getMaterialOptions(sheets),...(records.stock||[]).map(r=>String(r.material||'').trim()).filter(Boolean)])],[sheets,records.stock]);

  const save = async () => {
    if(savingRef.current)return;
    const required: Record<string,string[]> = {payments:['amount','date'],contracts:['person','agreedAmount'],stock:['material','unit','direction','quantity'],progress:['stage','percent'],diary:['title','date'],approvals:['expenseRef'],reminders:['title','dueDate']};
    const missing = current.fields.find(field => required[current.type]?.includes(field.key) && !String(values[field.key]||'').trim());
    if (missing) { Alert.alert('Required field', `Please enter ${missing.label}.`); return; }
    const invalidNumber=current.fields.find(field=>field.numeric&&String(values[field.key]||'').trim()&&(!Number.isFinite(Number(values[field.key]))||Number(values[field.key])<0));
    if(invalidNumber){Alert.alert('Invalid value',`${invalidNumber.label} must be a valid non-negative number.`);return;}
    if (current.type === 'payments') {
      if(!validateAgreementLink(values.contractId,values.person,contracts)){Alert.alert('Invalid agreement','Choose an existing agreement belonging to the selected person.'); return;}
      if(!canCreateVoucherPayment(records.payments||[],values.sourceExpenseId,values.allowPartial==='true',editingId)){Alert.alert('Voucher already linked','A payment already references this voucher. Select “Allow partial payment” to record a separate transaction.');return;}
      const linkedExpense=expenseRows.find(row=>row.id===values.sourceExpenseId);
      const remaining=values.sourceExpenseId?voucherRemainingAmount(linkedExpense,records.payments||[],editingId):null;
      if(remaining!==null&&Number(values.amount)>remaining){Alert.alert('Payment exceeds voucher balance',`This voucher has ${money(remaining)} remaining.`);return;}
    }
    if(current.type==='contracts'&&editingId&&(records.payments||[]).some(payment=>payment.contractId===editingId&&payment.person!==values.person)){Alert.alert('Agreement person is linked','This agreement has payments. Keep its person unchanged so the existing payment links remain valid.');return;}
    savingRef.current=true;setSaving(true);
    try {
      const clean: Record<string,any> = {};
      current.fields.forEach(field => { const value=(values[field.key]||'').trim(); if(value&&field.key!=='voucherNumber') clean[field.key]=field.numeric?Number(value):value; });
      if(current.type==='payments'){delete clean.allowPartial; if(values.voucherNumber)clean.voucherNumber=values.voucherNumber;if(values.sourceExpenseId)clean.sourceExpenseId=values.sourceExpenseId;if(clean.paymentTo&&!clean.person)clean.person=clean.paymentTo;clean.currency=clean.currency||'₹';clean.status=clean.status||'paid';clean.enteredBy=clean.enteredBy||uid;clean.createdBy=uid;}
      if(current.type==='payments')validatePaymentRecord(clean);
      const createId=editingId?undefined:(pendingCreateId||newProjectRecordId(current.type));
      if(createId&&!pendingCreateId)setPendingCreateId(createId);
      if(current.type==='payments')clean.paymentId=String(values.paymentId||paymentIdForDocument(createId||editingId||'LEGACY'));
      const activityId=pendingActivityId||newProjectRecordId(current.type);
      if(!pendingActivityId)setPendingActivityId(activityId);
      const id = await addProjectRecord(current.type, clean, uid, editingId, createId, activityId);
      let extra = '';
      if (current.type === 'reminders') extra = ` ${await scheduleLocalReminderForRecord(id, uid, clean.title, clean.notes || clean.title, clean.dueDate)}`;
      setModal(false); setValues({}); setEditingId(undefined); setPendingCreateId(undefined); setPendingActivityId(undefined); Alert.alert('Saved',`${current.title} record ${editingId?'updated':'saved'}.${extra}`);
    } catch (error:any) { Alert.alert('Could not save',error?.message||'Check your connection and try again.'); }
    finally { savingRef.current=false;setSaving(false); }
  };

  const decide = async (record: ProjectRecord, status: 'approved'|'rejected') => {
    setDeciding(record.id);
    try { await decideApproval(record.id,status,decisionNotes[record.id]||'',uid); setDecisionNotes(old=>({...old,[record.id]:''})); }
    catch(error:any) { Alert.alert('Decision not saved',error?.message||'Please retry.'); }
    finally { setDeciding(null); }
  };

  const confirmDeletePayment = (payment: ProjectRecord) => {
    if (!owner || deletingPaymentRef.current) return;
    const paymentLabel = payment.paymentId || payment.id;
    const details = [
      `Amount: ${money(Number(payment.amount) || 0)}`,
      `Date: ${payment.date || dateLabel(payment.createdAt)}`,
      `Category: ${payment.category || 'Uncategorized'}`,
      `Paid to: ${payment.paymentTo || payment.person || 'Not provided'}`,
      `Voucher: ${payment.voucherNumber || 'None'}`,
      `Description: ${payment.description || 'None'}`
    ].join('\n');
    Alert.alert('Delete payment permanently?', `${paymentLabel}\n\n${details}\n\nThis removes the payment and its linked activity and receipt attachments. The original expense record and receipt will remain.`, [
      {text:'Cancel', style:'cancel'},
      {text:'Delete', style:'destructive', onPress: async () => {
        if (deletingPaymentRef.current) return;
        deletingPaymentRef.current = payment.id;
        setDeletingPaymentId(payment.id);
        try {
          await deletePaymentRecord(payment, uid);
          setRecords(old=>({...old,payments:(old.payments||[]).filter(item=>item.id!==payment.id)}));
          Alert.alert('Payment deleted', `${paymentLabel} was deleted.`);
        } catch (error: any) {
          Alert.alert('Could not delete payment', error?.message || 'Check your connection and try again.');
        } finally {
          deletingPaymentRef.current = null;
          setDeletingPaymentId(null);
        }
      }}
    ]);
  };

  const backup = async () => {
    setToolBusy(true);
    try { await exportProjectBackup(); Alert.alert('Backup exported','Sheets, structured records and attachments were included. Store this file securely.'); }
    catch(error:any) { Alert.alert('Backup failed',error?.message||'Please retry when online.'); }
    finally { setToolBusy(false); }
  };
  const restore = async () => {
    try {
      const picked=await DocumentPicker.getDocumentAsync({type:'application/json',copyToCacheDirectory:true});
      if(picked.canceled||!picked.assets?.[0])return;
      const info=await FileSystem.getInfoAsync(picked.assets[0].uri);
      if(info.exists&&info.size>50*1024*1024)throw new Error('Backup exceeds the 50 MiB safe import limit.');
      const json=await FileSystem.readAsStringAsync(picked.assets[0].uri);
      Alert.alert('Import backup?', 'The file will be validated, missing documents added, and existing documents skipped. Cloud records are never replaced.', [
        {text:'Cancel',style:'cancel'},
        {text:'Import missing records',onPress:()=>{setToolBusy(true);void importProjectBackup(json,uid).then(result=>Alert.alert('Import complete',`${result.added} documents added; ${result.skipped} existing documents skipped.`)).catch(error=>Alert.alert('Import failed',error?.message||'Please retry.')).finally(()=>setToolBusy(false));}}
      ]);
    } catch(error:any) { Alert.alert('Could not read backup',error?.message||'Choose a valid KSK JSON backup.'); }
  };
  const reports = async () => {
    setToolBusy(true);
    try { await exportProjectReports(records,sheets,reportStatus); }
    catch(error:any) { Alert.alert('Report export failed',error?.message||'Please retry.'); }
    finally { setToolBusy(false); }
  };
  const reportPdf = async () => {
    setToolBusy(true);
    try { await exportProjectReportPdf(records,sheets,reportStatus); }
    catch(error:any) { Alert.alert('PDF export failed',error?.message||'Please retry.'); }
    finally { setToolBusy(false); }
  };
  const filteredPayments=useMemo(()=>{
    const q=paymentSearch.trim().toLocaleLowerCase();
    return (records.payments||[]).filter(payment=>{
      const searchValues=[payment.paymentId,payment.id,payment.voucherNumber,payment.paymentTo,payment.person,payment.description].map(value=>String(value||'').toLocaleLowerCase());
      return (!q||searchValues.some(value=>value.includes(q)))&&(!paymentStart||String(payment.date||'')>=paymentStart)&&(!paymentEnd||String(payment.date||'')<=paymentEnd)&&(!paymentCategory||payment.category===paymentCategory)&&(!paymentMode||payment.method===paymentMode)&&(!paymentContract||payment.contractId===paymentContract);
    }).sort((a,b)=>paymentSort==='oldest'?String(a.date||'').localeCompare(String(b.date||'')):String(b.date||'').localeCompare(String(a.date||'')));
  },[records.payments,paymentSearch,paymentStart,paymentEnd,paymentCategory,paymentMode,paymentContract,paymentSort]);
  const paymentSummary=useMemo(()=>{
    const payments=records.payments||[];const summary=summarizePaymentRecords(payments,contracts);const receipts=payments.filter(p=>p.receiptReference||p.receiptAttached===true||p.hasReceipt).length;
    return {...summary,payments:summary.paid,agreements:summary.contractValue,receipts,without:payments.length-receipts};
  },[records.payments,contracts]);

  return <View style={{flex:1,backgroundColor:'#F5F8F5'}}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{maxHeight:58,backgroundColor:white,borderBottomWidth:1,borderColor:line}} contentContainerStyle={{paddingHorizontal:10,alignItems:'center',gap:7}}>
      {visibleModules.map(module=><TouchableOpacity key={module.type} onPress={()=>{setActive(module.type);setVisibleCount(50);}} style={{paddingHorizontal:13,paddingVertical:9,borderRadius:20,backgroundColor:current.type===module.type?green:'#F0F4F1'}}><Text style={{fontSize:12,fontWeight:'800',color:current.type===module.type?white:ink}}>{module.title}</Text></TouchableOpacity>)}
    </ScrollView>
    <ScrollView contentContainerStyle={{padding:16,paddingBottom:30}}>
      <View style={{backgroundColor:white,borderRadius:16,padding:16,borderWidth:1,borderColor:line,marginBottom:13}}>
        <Text style={{fontSize:18,fontWeight:'900',color:ink}}>{current.title}</Text>
        <Text style={{fontSize:12,color:muted,marginTop:5}}>{current.type==='payments'?'Read-only access to all project payment and receipt entries.':current.type==='stock'?'On hand = received + returned to stock − supplier returns − used − wastage. Purchases are order quantities, not stock.':'Records are read in bounded pages; totals include the full collection.'}</Text>
        {owner?<TouchableOpacity onPress={()=>{setEditingId(undefined);setPendingCreateId(current.type==='payments'?newProjectRecordId('payments'):undefined);setPendingActivityId(undefined);setValues(current.type==='payments'?{paymentKind:'payment',currency:'₹'}:{});setModal(true);}} style={{marginTop:14,backgroundColor:green,padding:12,borderRadius:10,alignItems:'center'}}><Text style={{color:white,fontWeight:'900'}}>+ New Payment</Text></TouchableOpacity>:<Text style={{color:muted,fontSize:12,marginTop:12}}>View-only access</Text>}
        <Text style={{fontSize:11,color:muted,marginTop:8}}>Report sections: {reportStatus.map(section=>`${section.name}: ${section.state}${section.error?` (${section.error})`:''}`).join(' · ')}</Text>
        {reportStatus.some(section=>section.state==='failed')?<TouchableOpacity onPress={()=>setRetrySubscriptions(value=>value+1)} style={{alignSelf:'flex-start',paddingVertical:6}}><Text style={{fontSize:12,color:green,fontWeight:'800'}}>Retry failed record loads</Text></TouchableOpacity>:null}
        {reportsReady&&reportStatus.some(section=>section.state==='failed')?<Text style={{fontSize:11,color:'#9A6713',marginTop:4}}>Exports will be marked partial because an optional section failed to load.</Text>:null}
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10}}><TouchableOpacity disabled={toolBusy||!reportsReady} onPress={()=>void reports()} style={{padding:9,borderRadius:8,backgroundColor:'#EAF0F7'}}><Text style={{color:'#365775',fontWeight:'800'}}>{toolBusy?'Working…':reportsReady?'Export reports (.xlsx)':reportsLoading?'Loading required records…':'Required report data unavailable'}</Text></TouchableOpacity><TouchableOpacity disabled={toolBusy||!reportsReady} onPress={()=>void reportPdf()} style={{padding:9,borderRadius:8,backgroundColor:'#EAF0F7'}}><Text style={{color:'#365775',fontWeight:'800'}}>{reportsReady?'Export report (.pdf)':reportsLoading?'Loading required records…':'Required report data unavailable'}</Text></TouchableOpacity>{owner?<TouchableOpacity disabled={toolBusy} onPress={()=>void backup()} style={{padding:9,borderRadius:8,backgroundColor:'#E6F1EC'}}><Text style={{color:green,fontWeight:'800'}}>Export full backup</Text></TouchableOpacity>:null}{owner?<TouchableOpacity disabled={toolBusy} onPress={()=>void restore()} style={{padding:9,borderRadius:8,backgroundColor:'#FAF1E1'}}><Text style={{color:'#8A5A13',fontWeight:'800'}}>Import missing records</Text></TouchableOpacity>:null}</View>
      </View>

      {current.type==='payments'?<>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:12}}>{[
          ['Contract value',paymentSummary.agreements?money(paymentSummary.agreements):'Not available'],['Advances',money(paymentSummary.advances)],['Total paid',money(paymentSummary.payments)],['Outstanding',paymentSummary.agreements?money(paymentSummary.remaining):'Not available'],['Overpayment',money(paymentSummary.overpaid)],['Payments',String(paymentSummary.count)],['With receipt',String(paymentSummary.receipts)],['No receipt',String(paymentSummary.without)]
        ].map(([label,value])=><View key={label} style={{backgroundColor:white,borderWidth:1,borderColor:line,borderRadius:10,padding:10,minWidth:'45%'}}><Text style={{fontSize:11,color:muted}}>{label==='With receipt'?'Receipt references':label==='No receipt'?'No receipt reference':label}</Text><Text style={{fontSize:14,fontWeight:'900',color:ink,marginTop:3}}>{value}</Text></View>)}</View>
        <TextInput value={paymentSearch} onChangeText={setPaymentSearch} placeholder="Search payment ID, voucher, vendor or description" style={{backgroundColor:white,borderWidth:1,borderColor:line,borderRadius:9,padding:10,marginBottom:8}}/>
        <View style={{flexDirection:'row',gap:7}}><TextInput value={paymentStart} onChangeText={setPaymentStart} placeholder="From YYYY-MM-DD" style={{flex:1,backgroundColor:white,borderWidth:1,borderColor:line,borderRadius:9,padding:9}}/><TextInput value={paymentEnd} onChangeText={setPaymentEnd} placeholder="To YYYY-MM-DD" style={{flex:1,backgroundColor:white,borderWidth:1,borderColor:line,borderRadius:9,padding:9}}/></View>
        <View style={{flexDirection:'row',gap:8,marginVertical:8}}><Picker style={{flex:1,backgroundColor:white}} selectedValue={paymentCategory} onValueChange={setPaymentCategory}><Picker.Item label="All categories" value=""/>{[...new Set((records.payments||[]).map(p=>String(p.category||'')).filter(Boolean))].map(v=><Picker.Item key={v} label={v} value={v}/>)}</Picker><Picker style={{flex:1,backgroundColor:white}} selectedValue={paymentMode} onValueChange={setPaymentMode}><Picker.Item label="All modes" value=""/>{[...new Set((records.payments||[]).map(p=>String(p.method||'')).filter(Boolean))].map(v=><Picker.Item key={v} label={v} value={v}/>)}</Picker></View>
        <Picker selectedValue={paymentContract} onValueChange={setPaymentContract}><Picker.Item label="All agreements" value=""/>{contracts.map(c=><Picker.Item key={c.id} label={c.person||c.id} value={c.id}/>)}</Picker>
        <Picker selectedValue={paymentSort} onValueChange={setPaymentSort}><Picker.Item label="Newest first" value="newest"/><Picker.Item label="Oldest first" value="oldest"/></Picker>
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:10}}><TouchableOpacity disabled={toolBusy} onPress={()=>void exportPaymentStatementPdf(filteredPayments,contracts,sheets,false,records.payments||[])} style={{padding:10,backgroundColor:'#EAF0F7',borderRadius:8}}><Text style={{color:'#365775',fontWeight:'800'}}>Export statement PDF</Text></TouchableOpacity><TouchableOpacity disabled={toolBusy} onPress={()=>void exportPaymentStatementPdf(filteredPayments,contracts,sheets,true,records.payments||[])} style={{padding:10,backgroundColor:'#EAF0F7',borderRadius:8}}><Text style={{color:'#365775',fontWeight:'800'}}>Statement with receipt images</Text></TouchableOpacity><Text style={{alignSelf:'center',fontSize:12,color:muted}}>{filteredPayments.length} payments</Text></View>
      </>:null}
      {current.type==='payments'&&contractLedger.length>0?<View style={{backgroundColor:white,borderWidth:1,borderColor:line,borderRadius:10,padding:12,marginBottom:12}}><Text style={{fontWeight:'900',color:ink}}>Agreement reconciliation</Text>{contractLedger.map(({contract,advances,paid,balance,overpaid})=><Text key={contract.id} style={{fontSize:12,color:muted,marginTop:6}}>{contract.person||'Agreement'} · Agreed {money(advances+paid+balance-overpaid)} · Advances {money(advances)} · Other payments {money(paid)} · Outstanding {money(balance)}{overpaid?` · Overpaid ${money(overpaid)}`:''}</Text>)}</View>:null}

      {current.type==='payments'&&filteredPayments.slice(0,visibleCount).map(payment=><View key={payment.id} style={{backgroundColor:white,borderRadius:12,padding:13,marginBottom:9,borderWidth:1,borderColor:line}}><Text style={{fontWeight:'800',color:ink}}>{payment.paymentId||payment.id} · {payment.paymentTo||payment.person||'Not provided'} · {money(Number(payment.amount)||0)}</Text><Text style={{fontSize:11,color:muted,marginTop:4}}>{payment.date||dateLabel(payment.createdAt)} · {payment.voucherNumber||'No voucher'} · {payment.category||'Uncategorized'} · {payment.method||'Mode not provided'} · {payment.status||'Legacy'}</Text>{payment.description?<Text style={{fontSize:12,color:muted,marginTop:4}}>{payment.description}</Text>:null}<View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:8}}>{owner?<><TouchableOpacity onPress={()=>{setEditingId(payment.id);setValues(Object.fromEntries(modules.find(m=>m.type==='payments')!.fields.map(f=>[f.key,String(payment[f.key]??'')])));setValues(old=>({...old,sourceExpenseId:payment.sourceExpenseId||''}));setModal(true);}} style={{padding:8,backgroundColor:'#E6F1EC',borderRadius:8}}><Text style={{color:green,fontWeight:'800'}}>Edit</Text></TouchableOpacity><TouchableOpacity disabled={!!deletingPaymentId} onPress={()=>confirmDeletePayment(payment)} style={{padding:8,backgroundColor:'#F9E8E6',borderRadius:8,opacity:deletingPaymentId===payment.id?0.55:1}}><Text style={{color:'#B64D43',fontWeight:'800'}}>{deletingPaymentId===payment.id?'◌ Deleting…':'🗑 Delete'}</Text></TouchableOpacity></>:null}<TouchableOpacity disabled={toolBusy} onPress={()=>void exportPaymentReceiptPdf(payment,sheets)} style={{padding:8,backgroundColor:'#EAF0F7',borderRadius:8}}><Text style={{color:'#365775',fontWeight:'800'}}>Open / Share PDF</Text></TouchableOpacity></View><BillAttachments recordId={payment.id} canEdit={owner} language="en"/>{payment.sourceExpenseId?<><Text style={{fontSize:12,color:ink,fontWeight:'800',marginTop:8}}>Original Daily Expenses receipt · {payment.voucherNumber||''}</Text><BillAttachments recordId={payment.sourceExpenseId} canEdit={false} language="en"/></>:null}</View>)}

      {current.type==='stock'&&inventory.slice(0,visibleCount).map(item=><View key={`${item.material}-${item.unit}`} style={{backgroundColor:white,borderRadius:12,padding:13,marginBottom:9,borderWidth:1,borderColor:line}}><Text style={{fontWeight:'900',color:item.lowStock?'#B64D43':ink}}>{item.material} · {item.available} {item.unit}{item.lowStock?' · LOW STOCK':''}</Text><Text style={{fontSize:12,color:muted,marginTop:5}}>Ordered {item.purchased} · Received {item.received} · Returns in {item.returnedToStock} · Supplier returns {item.returnedToSupplier} · Used {item.used} · Wastage {item.wastage}{item.lowStockLevel?` · Alert below ${item.lowStockLevel}`:''}{item.rate?` · Rate ${money(item.rate)}`:''}{item.supplier?` · ${item.supplier}`:''}</Text></View>)}

      {items.slice(0,visibleCount).map(item=><View key={item.id} style={{backgroundColor:white,borderRadius:13,padding:14,marginBottom:10,borderWidth:1,borderColor:line}}>
        <Text style={{fontSize:15,fontWeight:'900',color:ink}}>{item.person||item.material||item.stage||item.title||item.payee||item.expenseRef||'Record'}</Text>
        {current.type==='diary'?<BillAttachments recordId={item.id} collectionName="attachments" canEdit={owner} language="en"/>:null}
        {owner&&['contracts','stock','progress','diary'].includes(current.type)?<TouchableOpacity onPress={()=>{setEditingId(item.id);setValues(Object.fromEntries(current.fields.map(field=>[field.key,String(item[field.key]??'')])));setModal(true);}} style={{alignSelf:'flex-start',marginTop:8,padding:8,backgroundColor:'#E6F1EC',borderRadius:8}}><Text style={{color:green,fontWeight:'800'}}>Edit record</Text></TouchableOpacity>:null}
        {current.fields.filter(field=>!['person','material','stage','title','contractId'].includes(field.key)).map(field=>item[field.key]!==undefined&&item[field.key]!==''?<Text key={field.key} style={{fontSize:12,color:muted,marginTop:5}}>{field.label}: {field.numeric?money(Number(item[field.key])||0):String(item[field.key])}</Text>:null)}
        {current.type==='progress'&&item.plannedDate&&!item.actualDate&&Number(item.percent)<100&&item.plannedDate<new Date().toISOString().slice(0,10)?<Text style={{color:'#B64D43',fontWeight:'800',marginTop:7}}>Delayed · planned {item.plannedDate}</Text>:null}
        {current.type==='approvals'?<><Text style={{fontWeight:'800',color:String(item.status||'pending').toLowerCase()==='pending'?'#A06C13':green,marginTop:6}}>{String(item.status||'pending').toUpperCase()}</Text>{item.requestNote?<Text style={{fontSize:12,color:muted,marginTop:4}}>Request: {item.requestNote}</Text>:null}{item.decidedBy?<Text style={{fontSize:11,color:muted,marginTop:4}}>Decision by {item.decidedBy} · {dateLabel(item.decidedAt)} · {item.decisionNote}</Text>:null}{owner&&String(item.status||'pending').trim().toLowerCase()==='pending'?<><TextInput value={decisionNotes[item.id]||''} onChangeText={text=>setDecisionNotes(old=>({...old,[item.id]:text}))} placeholder="Decision note (optional)" style={{borderWidth:1,borderColor:line,padding:9,borderRadius:8,marginTop:8}}/><View style={{flexDirection:'row',gap:8,marginTop:8}}>{(['approved','rejected'] as const).map(status=><TouchableOpacity disabled={!!deciding} key={status} onPress={()=>void decide(item,status)} style={{backgroundColor:status==='approved'?green:'#B64D43',padding:9,borderRadius:8}}><Text style={{color:white,fontWeight:'800'}}>{deciding===item.id?'Saving…':status==='approved'?'Approve':'Reject'}</Text></TouchableOpacity>)}</View></>:null}{Array.isArray(item.history)?item.history.map((entry:any,index:number)=><Text key={`${item.id}-${index}`} style={{fontSize:11,color:muted,marginTop:5}}>{String(entry.status).toUpperCase()} by {entry.actorUid} · {dateLabel(entry.decidedAt)}{entry.note?` · ${entry.note}`:''}</Text>):null}</>:null}
        {current.type==='reminders'?<><Text style={{fontSize:11,color:item.status==='cancelled'?'#B64D43':muted,marginTop:5}}>{item.status==='cancelled'?'Cancelled':item.dueDate&&item.dueDate<new Date().toISOString().slice(0,10)?'Overdue':'Scheduled'} · Local notification state is stored on this device only.</Text>{owner&&item.status!=='cancelled'?<><TextInput value={reminderDates[item.id]??item.dueDate??''} onChangeText={value=>setReminderDates(old=>({...old,[item.id]:value}))} placeholder="YYYY-MM-DD" style={{borderWidth:1,borderColor:line,padding:8,borderRadius:8,marginTop:8}}/><View style={{flexDirection:'row',gap:8,marginTop:7}}><TouchableOpacity onPress={async()=>{try{const date=reminderDates[item.id]||item.dueDate;await setReminderDate(item.id,date,uid);const message=await scheduleLocalReminder(item.title,item.notes||item.title,date,`reminder:${uid}:${item.id}`);Alert.alert('Reminder updated',message);}catch(error:any){Alert.alert('Could not reschedule',error?.message||'Please retry.');}}} style={{backgroundColor:green,padding:8,borderRadius:8}}><Text style={{color:white,fontWeight:'800'}}>Reschedule</Text></TouchableOpacity><TouchableOpacity onPress={async()=>{try{await cancelReminderRecord(item.id,uid);await cancelLocalReminder(`reminder:${uid}:${item.id}`);}catch(error:any){Alert.alert('Could not cancel',error?.message||'Please retry.');}}} style={{backgroundColor:'#F9E8E6',padding:8,borderRadius:8}}><Text style={{color:'#B64D43',fontWeight:'800'}}>Cancel reminder</Text></TouchableOpacity></View></>:null}</>:null}
        <Text style={{fontSize:10,color:'#9AA69F',marginTop:8}}>Saved {dateLabel(item.createdAt)}</Text>
      </View>)}

      {((current.type==='payments'?contractLedger.length+(records.payments||[]).filter(payment=>!contracts.some(contract=>contract.id===payment.contractId)).length:current.type==='stock'?inventory.length:items.length)>visibleCount)?<TouchableOpacity onPress={()=>setVisibleCount(value=>value+50)} style={{alignSelf:'center',padding:12,backgroundColor:'#E6F1EC',borderRadius:10}}><Text style={{fontWeight:'800',color:green}}>Load 50 more</Text></TouchableOpacity>:null}

      {!loaded[current.type]?<ActivityIndicator color={green} style={{marginTop:25}}/>:errors[current.type]?<Text style={{color:'#B64D43',padding:16}}>{errors[current.type]}</Text>:items.length===0&&!(current.type==='payments'&&contractLedger.length>0)?<View style={{padding:25,alignItems:'center'}}><Text style={{color:muted}}>No records yet.</Text></View>:null}
    </ScrollView>
    {modal?<View style={{position:'absolute',top:0,bottom:0,left:0,right:0,backgroundColor:'#0007',justifyContent:'flex-end'}}><View style={{backgroundColor:white,borderTopLeftRadius:20,borderTopRightRadius:20,padding:18,maxHeight:'88%'}}>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12}}><View><Text style={{fontSize:18,fontWeight:'900',color:ink}}>{editingId?'Edit':'New'} {current.title}</Text>{current.type==='payments'?<Text style={{fontSize:11,color:muted,marginTop:3}}>Payment ID: {values.paymentId||((pendingCreateId||editingId)?paymentIdForDocument(pendingCreateId||editingId!):'assigned on save')}</Text>:null}</View><TouchableOpacity disabled={saving} onPress={()=>{setModal(false);setEditingId(undefined);setPendingCreateId(undefined);setPendingActivityId(undefined);}}><Text style={{fontSize:22,color:muted}}>×</Text></TouchableOpacity></View>
      <ScrollView keyboardShouldPersistTaps="handled">{current.fields.map(field=><View key={field.key} style={{marginBottom:11}}>{current.type==='payments'&&({voucherNumber:'Payment identification',paymentTo:'People',paymentKind:'Financial information',description:'Project and work details',billReceived:'Receipt and supporting documents'} as Record<string,string>)[field.key]?<Text style={{fontSize:14,fontWeight:'900',color:green,marginTop:8,marginBottom:3}}>{({voucherNumber:'Payment identification',paymentTo:'People',paymentKind:'Financial information',description:'Project and work details',billReceived:'Receipt and supporting documents'} as Record<string,string>)[field.key]}</Text>:null}<Text style={{fontSize:12,fontWeight:'800',color:ink,marginBottom:5}}>{field.label}</Text>
        {field.key==='voucherNumber'?<><Picker selectedValue={values.sourceExpenseId||''} onValueChange={value=>{const source=expenseRows.find(entry=>(entry.id||`row:${entry.rowIndex}`)===value);if(!source){setValues(old=>({...old,voucherNumber:'',sourceExpenseId:''}));return;}setValues(old=>({...old,voucherNumber:source.voucherNumber,sourceExpenseId:source.id,allowPartial:'',date:source.date,floor:source.floor,stage:source.stage,category:source.category,description:source.description,paymentTo:source.paymentTo,person:source.paymentTo,amount:source.amount,method:source.method,paidBy:source.paidBy,receivedBy:source.receivedBy,billReceived:source.billReceived,notes:source.notes,reference:old.reference||''}));}}><Picker.Item label="Standalone payment (no voucher)" value=""/>{expenseRows.map((entry:any)=><Picker.Item key={`${entry.id||entry.rowIndex}-${entry.voucherNumber}`} label={`${entry.voucherNumber} · row ${entry.rowIndex+1}`} value={entry.id||`row:${entry.rowIndex}`}/>)}</Picker>{values.sourceExpenseId?<><TouchableOpacity onPress={()=>setValues(old=>({...old,allowPartial:old.allowPartial==='true'?'':'true'}))} style={{padding:8}}><Text style={{color:green,fontSize:12}}>{values.allowPartial==='true'?'✓ ':''}Allow partial payment for this voucher</Text></TouchableOpacity><Text style={{fontSize:12,color:muted}}>Remaining voucher balance: {money(voucherRemainingAmount(expenseRows.find(row=>row.id===values.sourceExpenseId),records.payments||[],editingId)??0)}</Text></>:null}</>
          :field.key==='contractId'?<Picker selectedValue={values.contractId||''} onValueChange={value=>{const contract=contracts.find(row=>row.id===value);setValues(old=>({...old,contractId:String(value),person:contract?.person||old.person||''}));}}><Picker.Item label="No agreement (optional)" value=""/>{contracts.map(contract=><Picker.Item key={contract.id} label={`${contract.person} · ${money(Number(contract.agreedAmount)||0)} · ${contract.id.slice(0,7)}`} value={contract.id}/>)}</Picker>
          :current.type==='stock'&&field.key==='material'?<><Picker selectedValue={values.material&&materialOptions.includes(values.material)?values.material:''} onValueChange={value=>setValues(old=>({...old,material:String(value)}))}><Picker.Item label="Select catalogue material or enter below" value=""/>{materialOptions.map(material=><Picker.Item key={material} label={material} value={material}/>)}</Picker><TextInput value={values.material||''} onChangeText={value=>setValues(old=>({...old,material:value}))} placeholder="Custom material" style={{borderWidth:1,borderColor:line,borderRadius:9,padding:10,color:ink}}/></>
          :field.options?<Picker selectedValue={values[field.key]||field.options[0]} onValueChange={value=>setValues(old=>({...old,[field.key]:String(value)}))}>{field.options.map(option=><Picker.Item key={option} label={option.replaceAll('-',' ')} value={option}/>)}</Picker>
          :field.key==='date'&&current.type==='payments'?<><TouchableOpacity onPress={()=>setShowPaymentDatePicker(true)} style={{borderWidth:1,borderColor:line,borderRadius:9,padding:12}}><Text style={{color:values.date?ink:muted}}>{values.date||'Select payment date'}</Text></TouchableOpacity>{showPaymentDatePicker?<DateTimePicker value={values.date?new Date(`${values.date}T12:00:00`):new Date()} mode="date" onChange={(_,date)=>{setShowPaymentDatePicker(false);if(date)setValues(old=>({...old,date:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}));}}/>:null}</>
          :<TextInput value={values[field.key]||''} onChangeText={value=>setValues(old=>({...old,[field.key]:value}))} placeholder={field.placeholder||field.label} keyboardType={field.numeric?'decimal-pad':'default'} style={{borderWidth:1,borderColor:line,borderRadius:9,paddingHorizontal:12,paddingVertical:10,color:ink,fontSize:14}}/>}</View>)}</ScrollView>
      <TouchableOpacity disabled={saving} onPress={()=>void save()} style={{backgroundColor:green,padding:14,borderRadius:11,alignItems:'center',marginTop:10}}>{saving?<ActivityIndicator color={white}/>:<Text style={{color:white,fontWeight:'900'}}>{editingId?'Update record':'Save record'}</Text>}</TouchableOpacity>
    </View></View>:null}
  </View>;
}

async function scheduleLocalReminderForRecord(id:string,uid:string,title:string,body:string,date:string){
  return scheduleLocalReminder(title,body,date,`reminder:${uid}:${id}`);
}
