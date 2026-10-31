import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {Picker} from '@react-native-picker/picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {addProjectRecord, cancelReminderRecord, dateLabel, decideApproval, ProjectRecord, ProjectRecordType, setReminderDate, subscribeProjectRecords} from '../services/projectRecords';
import BillAttachments from './BillAttachments';
import {cancelLocalReminder, reconcileLocalReminders, scheduleLocalReminder} from '../services/notifications';
import {exportProjectBackup, importProjectBackup} from '../services/projectBackup';
import {exportProjectReportPdf, exportProjectReports} from '../services/projectReports';
import {summarizeContracts, summarizeInventory} from '../services/recordMath';

type Field = {key: string; label: string; placeholder?: string; numeric?: boolean; options?: string[]};
type Module = {type: ProjectRecordType; title: string; fields: Field[]};
const modules: Module[] = [
  {type:'payments', title:'Payments & receipts', fields:[
    {key:'person',label:'Person / party'}, {key:'contractId',label:'Agreement',options:[]},
    {key:'paymentKind',label:'Payment type',options:['advance','payment']},
    {key:'amount',label:'Amount (₹)',numeric:true}, {key:'date',label:'Payment date',placeholder:'YYYY-MM-DD'},
    {key:'category',label:'Category'}, {key:'method',label:'Payment method'}, {key:'reference',label:'Reference'}
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
  const [values, setValues] = useState<Record<string,string>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string,string>>({});
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reminderDates, setReminderDates] = useState<Record<string,string>>({});
  const [toolBusy, setToolBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const [historyCounts, setHistoryCounts] = useState<Record<string,number>>({});
  const current = visibleModules.find(module => module.type === active) || visibleModules[0];
  const items = records[current.type] || [];
  const contracts = records.contracts || [];
  const reportsReady=sheetsReady&&visibleModules.every(module=>loaded[module.type]&&!errors[module.type]);
  const reportsLoading=!sheetsLoaded||visibleModules.some(module=>!loaded[module.type]);

  useEffect(() => {
    setRecords({}); setLoaded({}); setErrors({}); setActive('payments');
    const stops = visibleModules.map(module => subscribeProjectRecords(module.type, rows => {
      setRecords(old => ({...old, [module.type]: rows}));
      setLoaded(old => ({...old, [module.type]: true}));
      setErrors(old => ({...old, [module.type]: ''}));
    }, message => { setErrors(old => ({...old, [module.type]: message})); setLoaded(old => ({...old, [module.type]: true})); }));
    return () => stops.forEach(stop => stop());
  }, [owner, uid]);

  useEffect(()=>{
    if(owner&&uid&&records.reminders)void reconcileLocalReminders(uid,records.reminders).catch(error=>console.warn('Could not sync local reminders',error));
  },[owner,uid,records.reminders]);

  const contractLedger = useMemo(() => summarizeContracts(contracts,records.payments||[]), [contracts, records.payments]);
  const inventory = useMemo(() => summarizeInventory(records.stock||[]), [records.stock]);

  const save = async () => {
    const required: Record<string,string[]> = {payments:['person','contractId','paymentKind','amount','date'],contracts:['person','agreedAmount'],stock:['material','unit','direction','quantity'],progress:['stage','percent'],diary:['title','date'],approvals:['expenseRef'],reminders:['title','dueDate']};
    const missing = current.fields.find(field => required[current.type]?.includes(field.key) && !String(values[field.key]||'').trim());
    if (missing) { Alert.alert('Required field', `Please enter ${missing.label}.`); return; }
    if (current.type === 'payments') {
      const contract = contracts.find(row => row.id === values.contractId);
      if (!contract || contract.person !== values.person) { Alert.alert('Agreement required','Choose a valid agreement belonging to this person.'); return; }
    }
    setSaving(true);
    try {
      const clean: Record<string,any> = {};
      current.fields.forEach(field => { const value=(values[field.key]||'').trim(); if(value) clean[field.key]=field.numeric?Number(value):value; });
      const id = await addProjectRecord(current.type, clean, uid);
      let extra = '';
      if (current.type === 'reminders') extra = ` ${await scheduleLocalReminderForRecord(id, uid, clean.title, clean.notes || clean.title, clean.dueDate)}`;
      setModal(false); setValues({}); Alert.alert('Saved',`${current.title} record saved.${extra}`);
    } catch (error:any) { Alert.alert('Could not save',error?.message||'Check your connection and try again.'); }
    finally { setSaving(false); }
  };

  const decide = async (record: ProjectRecord, status: 'approved'|'rejected') => {
    setDeciding(record.id);
    try { await decideApproval(record.id,status,decisionNotes[record.id]||'',uid); setDecisionNotes(old=>({...old,[record.id]:''})); }
    catch(error:any) { Alert.alert('Decision not saved',error?.message||'Please retry.'); }
    finally { setDeciding(null); }
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
    try { await exportProjectReports(records,sheets); }
    catch(error:any) { Alert.alert('Report export failed',error?.message||'Please retry.'); }
    finally { setToolBusy(false); }
  };
  const reportPdf = async () => {
    setToolBusy(true);
    try { await exportProjectReportPdf(records,sheets); }
    catch(error:any) { Alert.alert('PDF export failed',error?.message||'Please retry.'); }
    finally { setToolBusy(false); }
  };

  return <View style={{flex:1,backgroundColor:'#F5F8F5'}}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{maxHeight:58,backgroundColor:white,borderBottomWidth:1,borderColor:line}} contentContainerStyle={{paddingHorizontal:10,alignItems:'center',gap:7}}>
      {visibleModules.map(module=><TouchableOpacity key={module.type} onPress={()=>{setActive(module.type);setVisibleCount(50);}} style={{paddingHorizontal:13,paddingVertical:9,borderRadius:20,backgroundColor:current.type===module.type?green:'#F0F4F1'}}><Text style={{fontSize:12,fontWeight:'800',color:current.type===module.type?white:ink}}>{module.title}</Text></TouchableOpacity>)}
    </ScrollView>
    <ScrollView contentContainerStyle={{padding:16,paddingBottom:30}}>
      <View style={{backgroundColor:white,borderRadius:16,padding:16,borderWidth:1,borderColor:line,marginBottom:13}}>
        <Text style={{fontSize:18,fontWeight:'900',color:ink}}>{current.title}</Text>
        <Text style={{fontSize:12,color:muted,marginTop:5}}>{current.type==='payments'?'Read-only access to all project payment and receipt entries.':current.type==='stock'?'On hand = received + returned to stock − supplier returns − used − wastage. Purchases are order quantities, not stock.':'Records are read in bounded pages; totals include the full collection.'}</Text>
        {owner?<TouchableOpacity onPress={()=>{setValues(current.type==='payments'?{paymentKind:'payment'}:{});setModal(true);}} style={{marginTop:14,backgroundColor:green,padding:12,borderRadius:10,alignItems:'center'}}><Text style={{color:white,fontWeight:'900'}}>+ Add {current.title.toLowerCase()}</Text></TouchableOpacity>:<Text style={{color:muted,fontSize:12,marginTop:12}}>View-only access</Text>}
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:10}}><TouchableOpacity disabled={toolBusy||!reportsReady} onPress={()=>void reports()} style={{padding:9,borderRadius:8,backgroundColor:'#EAF0F7'}}><Text style={{color:'#365775',fontWeight:'800'}}>{toolBusy?'Working…':reportsReady?'Export reports (.xlsx)':reportsLoading?'Loading all records…':'Report data unavailable'}</Text></TouchableOpacity><TouchableOpacity disabled={toolBusy||!reportsReady} onPress={()=>void reportPdf()} style={{padding:9,borderRadius:8,backgroundColor:'#EAF0F7'}}><Text style={{color:'#365775',fontWeight:'800'}}>{reportsReady?'Export report (.pdf)':reportsLoading?'Loading all records…':'Report data unavailable'}</Text></TouchableOpacity>{owner?<TouchableOpacity disabled={toolBusy} onPress={()=>void backup()} style={{padding:9,borderRadius:8,backgroundColor:'#E6F1EC'}}><Text style={{color:green,fontWeight:'800'}}>Export full backup</Text></TouchableOpacity>:null}{owner?<TouchableOpacity disabled={toolBusy} onPress={()=>void restore()} style={{padding:9,borderRadius:8,backgroundColor:'#FAF1E1'}}><Text style={{color:'#8A5A13',fontWeight:'800'}}>Import missing records</Text></TouchableOpacity>:null}</View>
      </View>

      {current.type==='payments'&&contractLedger.length>0?contractLedger.slice(0,visibleCount).map(({contract,history,advances,paid,balance,overpaid})=><View key={contract.id} style={{backgroundColor:white,borderRadius:15,padding:14,marginBottom:12,borderWidth:1,borderColor:line}}>
        <Text style={{fontSize:15,fontWeight:'900',color:ink}}>{contract.person} · {contract.category||'Agreement'}</Text>
        <Text style={{fontSize:12,color:muted,marginTop:5}}>Agreed {money(Number(contract.agreedAmount)||0)} · Advances {money(advances)} · Payments {money(paid)} · Outstanding {money(balance)}{overpaid?` · Overpaid ${money(overpaid)}`:''}</Text>
        {owner?<TouchableOpacity onPress={()=>{setValues({person:contract.person,contractId:contract.id,paymentKind:'payment'});setModal(true);}} style={{alignSelf:'flex-start',marginTop:8,padding:8,backgroundColor:'#E6F1EC',borderRadius:8}}><Text style={{color:green,fontWeight:'800'}}>＋ Record payment</Text></TouchableOpacity>:null}
        {history.slice(0,historyCounts[contract.id]||20).map(payment=><View key={payment.id} style={{borderTopWidth:1,borderColor:line,paddingTop:8,marginTop:8}}><Text style={{fontSize:12,color:ink}}>{String(payment.paymentKind||'').trim().toLowerCase()==='advance'?'Advance':'Payment'} · {money(Number(payment.amount)||0)} · {payment.date||dateLabel(payment.createdAt)}</Text><BillAttachments recordId={payment.id} canEdit={owner} language="en"/></View>)}{history.length>(historyCounts[contract.id]||20)?<TouchableOpacity onPress={()=>setHistoryCounts(old=>({...old,[contract.id]:(old[contract.id]||20)+20}))} style={{alignSelf:'flex-start',padding:8}}><Text style={{color:green,fontWeight:'800'}}>Load 20 more payments</Text></TouchableOpacity>:null}
      </View>):null}

      {current.type==='payments'?(records.payments||[]).filter(payment=>!contracts.some(contract=>contract.id===payment.contractId)).slice(0,visibleCount).map(payment=><View key={payment.id} style={{backgroundColor:white,borderRadius:12,padding:13,marginBottom:9,borderWidth:1,borderColor:line}}><Text style={{fontWeight:'800',color:ink}}>{payment.person||'Legacy payment'} · {money(Number(payment.amount)||0)} · {payment.date||dateLabel(payment.createdAt)}</Text><Text style={{fontSize:11,color:muted,marginTop:4}}>Legacy/unlinked entry. No contract balance is inferred.</Text><BillAttachments recordId={payment.id} canEdit={owner} language="en"/></View>):null}

      {current.type==='stock'&&inventory.slice(0,visibleCount).map(item=><View key={`${item.material}-${item.unit}`} style={{backgroundColor:white,borderRadius:12,padding:13,marginBottom:9,borderWidth:1,borderColor:line}}><Text style={{fontWeight:'900',color:item.lowStock?'#B64D43':ink}}>{item.material} · {item.available} {item.unit}{item.lowStock?' · LOW STOCK':''}</Text><Text style={{fontSize:12,color:muted,marginTop:5}}>Ordered {item.purchased} · Received {item.received} · Returns in {item.returnedToStock} · Supplier returns {item.returnedToSupplier} · Used {item.used} · Wastage {item.wastage}{item.lowStockLevel?` · Alert below ${item.lowStockLevel}`:''}{item.rate?` · Rate ${money(item.rate)}`:''}{item.supplier?` · ${item.supplier}`:''}</Text></View>)}

      {items.slice(0,visibleCount).map(item=><View key={item.id} style={{backgroundColor:white,borderRadius:13,padding:14,marginBottom:10,borderWidth:1,borderColor:line}}>
        <Text style={{fontSize:15,fontWeight:'900',color:ink}}>{item.person||item.material||item.stage||item.title||item.payee||item.expenseRef||'Record'}</Text>
        {current.type==='diary'?<BillAttachments recordId={item.id} collectionName="attachments" canEdit={owner} language="en"/>:null}
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
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12}}><Text style={{fontSize:18,fontWeight:'900',color:ink}}>New {current.title}</Text><TouchableOpacity onPress={()=>setModal(false)}><Text style={{fontSize:22,color:muted}}>×</Text></TouchableOpacity></View>
      <ScrollView keyboardShouldPersistTaps="handled">{current.fields.map(field=><View key={field.key} style={{marginBottom:11}}><Text style={{fontSize:12,fontWeight:'800',color:ink,marginBottom:5}}>{field.label}</Text>
        {field.key==='contractId'?<Picker selectedValue={values.contractId||''} onValueChange={value=>{const contract=contracts.find(row=>row.id===value);setValues(old=>({...old,contractId:String(value),person:contract?.person||old.person||''}));}}><Picker.Item label="Select an agreement" value=""/>{contracts.map(contract=><Picker.Item key={contract.id} label={`${contract.person} · ${money(Number(contract.agreedAmount)||0)} · ${contract.id.slice(0,7)}`} value={contract.id}/>)}</Picker>
          :field.options?<Picker selectedValue={values[field.key]||field.options[0]} onValueChange={value=>setValues(old=>({...old,[field.key]:String(value)}))}>{field.options.map(option=><Picker.Item key={option} label={option.replaceAll('-',' ')} value={option}/>)}</Picker>
          :<TextInput value={values[field.key]||''} onChangeText={value=>setValues(old=>({...old,[field.key]:value}))} placeholder={field.placeholder||field.label} keyboardType={field.numeric?'decimal-pad':'default'} style={{borderWidth:1,borderColor:line,borderRadius:9,paddingHorizontal:12,paddingVertical:10,color:ink,fontSize:14}}/>}</View>)}</ScrollView>
      <TouchableOpacity disabled={saving} onPress={()=>void save()} style={{backgroundColor:green,padding:14,borderRadius:11,alignItems:'center',marginTop:10}}>{saving?<ActivityIndicator color={white}/>:<Text style={{color:white,fontWeight:'900'}}>Save record</Text>}</TouchableOpacity>
    </View></View>:null}
  </View>;
}

async function scheduleLocalReminderForRecord(id:string,uid:string,title:string,body:string,date:string){
  return scheduleLocalReminder(title,body,date,`reminder:${uid}:${id}`);
}
