import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {addProjectRecord, dateLabel, ProjectRecord, ProjectRecordType, subscribeProjectRecords} from '../services/projectRecords';

type Field = {key: string; label: string; placeholder?: string; numeric?: boolean};
type Module = {type: ProjectRecordType; title: string; fields: Field[]; summary?: (items: ProjectRecord[]) => string};
const modules: Module[] = [
  {type:'payments', title:'Payment ledger', fields:[
    {key:'person',label:'Payee / person name',placeholder:'Engineer, contractor, supplier, labour'},
    {key:'category',label:'Category',placeholder:'Engineer / Contractor / Supplier / Labour'},
    {key:'amount',label:'Amount (₹)',numeric:true}, {key:'date',label:'Payment date',placeholder:'YYYY-MM-DD'},
    {key:'method',label:'Payment method',placeholder:'Cash / UPI / Bank'}, {key:'reference',label:'Transaction / bill reference'},
    {key:'description',label:'Description',placeholder:'What was this payment for?'}
  ], summary: items => `Total recorded payments: ₹${items.reduce((s,x)=>s+(Number(x.amount)||0),0).toLocaleString('en-IN')}`},
  {type:'stock',title:'Material stock',fields:[
    {key:'material',label:'Material',placeholder:'Cement / steel / bricks / sand'}, {key:'unit',label:'Unit',placeholder:'Bags / kg / nos / cft'},
    {key:'direction',label:'Movement',placeholder:'Purchase / Used / Returned / Wastage'}, {key:'quantity',label:'Quantity',numeric:true},
    {key:'date',label:'Date',placeholder:'YYYY-MM-DD'}, {key:'supplier',label:'Supplier / source'}, {key:'notes',label:'Notes'}
  ]},
  {type:'progress',title:'Construction progress',fields:[
    {key:'stage',label:'Work stage',placeholder:'Foundation / RCC / Brickwork / Plaster'}, {key:'floor',label:'Floor / area',placeholder:'Ground / First / External'},
    {key:'percent',label:'Completion (%)',numeric:true}, {key:'plannedDate',label:'Planned date',placeholder:'YYYY-MM-DD'},
    {key:'actualDate',label:'Actual date',placeholder:'YYYY-MM-DD'}, {key:'notes',label:'Site notes'}
  ]},
  {type:'diary',title:'Site photo diary',fields:[
    {key:'title',label:'Entry title'}, {key:'date',label:'Date',placeholder:'YYYY-MM-DD'},
    {key:'floor',label:'Floor / area'}, {key:'stage',label:'Work stage'}, {key:'description',label:'Description / photo reference'}
  ]},
  {type:'approvals',title:'Expense approvals',fields:[
    {key:'expenseRef',label:'Expense / bill reference'}, {key:'payee',label:'Payee'},
    {key:'amount',label:'Amount (₹)',numeric:true}, {key:'status',label:'Decision',placeholder:'Pending / Approved / Rejected'},
    {key:'decisionNote',label:'Decision note'}
  ]},
  {type:'reminders',title:'Payment reminders',fields:[
    {key:'title',label:'Reminder title'}, {key:'person',label:'Payee'}, {key:'amount',label:'Due amount (₹)',numeric:true},
    {key:'dueDate',label:'Due date',placeholder:'YYYY-MM-DD'}, {key:'notes',label:'Notes'}
  ]}
];
const ink='#18352B', muted='#718078', green='#176B4B', line='#E3EAE5', white='#FFFFFF';

export default function ProjectRecords({uid, owner}: {uid: string; owner: boolean}) {
  const [active, setActive] = useState<ProjectRecordType>(owner ? 'payments' : 'stock');
  const visibleModules = owner
    ? modules
    : modules.filter(module => !['payments', 'approvals', 'reminders'].includes(module.type));
  const [records, setRecords] = useState<Record<string,ProjectRecord[]>>({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState<Record<string,string>>({});
  const current = visibleModules.find(x=>x.type===active) || visibleModules[0];
  const items = records[current.type] || [];

  useEffect(()=>{
    setRecords({});
    setLoading(true);
    setActive(owner ? 'payments' : 'stock');
    setModal(false);
    setValues({});

    const allowedModules = owner
      ? modules
      : modules.filter(module => !['payments', 'approvals', 'reminders'].includes(module.type));

    const stops = allowedModules.map(module=>subscribeProjectRecords(module.type, rows=>{
      setRecords(old=>({...old,[module.type]:rows}));
      setLoading(false);
    }, message=>{
      console.warn(`Could not load ${module.type}:`,message);
      setLoading(false);
    }));

    return ()=>stops.forEach(stop=>stop());
  },[owner,uid]);

  const totalPaid = useMemo(()=> (records.payments||[]).reduce((sum,item)=>sum+(Number(item.amount)||0),0),[records.payments]);
  const save = async()=>{
    const required = current.type==='payments'?['person','amount','date']:current.type==='stock'?['material','quantity','direction']:current.type==='progress'?['stage','percent']:current.type==='diary'?['title','date']:current.type==='approvals'?['expenseRef','amount','status']:['title','dueDate','amount'];
    const missing = current.fields.find(field=>required.includes(field.key) && !String(values[field.key]||'').trim());
    if(missing){Alert.alert('Required field',`Please enter ${missing.label}.`);return;}
    setSaving(true);
    try{
      const clean:Record<string,any>={};
      current.fields.forEach(field=>{
        const value=(values[field.key]||'').trim();
        if(value) clean[field.key]=field.numeric?Number(value):value;
      });
      await addProjectRecord(current.type,clean,uid);
      setModal(false);setValues({});
      Alert.alert('Saved',`${current.title} record saved.`);
    }catch(error:any){Alert.alert('Could not save',error?.message||'Please try again.');}
    finally{setSaving(false);}
  };

  return <View style={{flex:1,backgroundColor:'#F5F8F5'}}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{maxHeight:58,backgroundColor:white,borderBottomWidth:1,borderColor:line}} contentContainerStyle={{paddingHorizontal:10,alignItems:'center',gap:7}}>
      {visibleModules.map(module=><TouchableOpacity key={module.type} onPress={()=>setActive(module.type)} style={{paddingHorizontal:13,paddingVertical:9,borderRadius:20,backgroundColor:current.type===module.type?green:'#F0F4F1'}}><Text style={{fontSize:12,fontWeight:'800',color:current.type===module.type?white:ink}}>{module.title}</Text></TouchableOpacity>)}
    </ScrollView>
    <ScrollView contentContainerStyle={{padding:16,paddingBottom:30}}>
      <View style={{backgroundColor:white,borderRadius:16,padding:16,borderWidth:1,borderColor:line,marginBottom:13}}>
        <Text style={{fontSize:18,fontWeight:'900',color:ink}}>{current.title}</Text>
        <Text style={{fontSize:12,color:muted,marginTop:5}}>{current.type==='payments'?`Recorded total: ₹${totalPaid.toLocaleString('en-IN')}`:'Project records are synced to Firestore.'}</Text>
        {owner?<TouchableOpacity onPress={()=>{setValues({});setModal(true);}} style={{marginTop:14,backgroundColor:green,padding:12,borderRadius:10,alignItems:'center'}}><Text style={{color:white,fontWeight:'900'}}>+ Add {current.title.replace(/s$/,'').toLowerCase()} record</Text></TouchableOpacity>:<Text style={{color:muted,fontSize:12,marginTop:12}}>View-only access</Text>}
      </View>
      {loading&&!records[active]?<ActivityIndicator color={green} style={{marginTop:30}}/>:items.length===0?<View style={{padding:25,alignItems:'center'}}><Text style={{color:muted}}>No records yet.</Text></View>:items.map(item=><View key={item.id} style={{backgroundColor:white,borderRadius:13,padding:14,marginBottom:10,borderWidth:1,borderColor:line}}>
        <Text style={{fontSize:15,fontWeight:'900',color:ink}}>{item.person||item.material||item.stage||item.title||item.payee||item.expenseRef||'Record'}</Text>
        {current.fields.filter(f=>f.key!=='person'&&f.key!=='material'&&f.key!=='stage'&&f.key!=='title').map(field=>item[field.key]!==undefined&&item[field.key]!==''?<Text key={field.key} style={{fontSize:12,color:muted,marginTop:5}}>{field.label}: {field.key==='amount'?`₹${Number(item[field.key]).toLocaleString('en-IN')}`:String(item[field.key])}</Text>:null)}
        <Text style={{fontSize:10,color:'#9AA69F',marginTop:8}}>Saved {dateLabel(item.createdAt)}</Text>
      </View>)}
    </ScrollView>
    <Modal visible={modal} animationType="slide" transparent onRequestClose={()=>setModal(false)}>
      <View style={{flex:1,backgroundColor:'#0007',justifyContent:'flex-end'}}><View style={{backgroundColor:white,borderTopLeftRadius:20,borderTopRightRadius:20,padding:18,maxHeight:'88%'}}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:12}}><Text style={{fontSize:18,fontWeight:'900',color:ink}}>New {current.title} record</Text><TouchableOpacity onPress={()=>setModal(false)}><Text style={{fontSize:22,color:muted}}>×</Text></TouchableOpacity></View>
        <ScrollView keyboardShouldPersistTaps="handled">{current.fields.map(field=><View key={field.key} style={{marginBottom:11}}><Text style={{fontSize:12,fontWeight:'800',color:ink,marginBottom:5}}>{field.label}</Text><TextInput value={values[field.key]||''} onChangeText={value=>setValues(old=>({...old,[field.key]:value}))} placeholder={field.placeholder||field.label} keyboardType={field.numeric?'decimal-pad':'default'} style={{borderWidth:1,borderColor:line,borderRadius:9,paddingHorizontal:12,paddingVertical:10,color:ink,fontSize:14}} /></View>)}</ScrollView>
        <TouchableOpacity disabled={saving} onPress={save} style={{backgroundColor:green,padding:14,borderRadius:11,alignItems:'center',marginTop:10}}>{saving?<ActivityIndicator color={white}/>:<Text style={{color:white,fontWeight:'900'}}>Save record</Text>}</TouchableOpacity>
      </View></View>
    </Modal>
  </View>;
}
