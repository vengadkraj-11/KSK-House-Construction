import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import {Asset} from 'expo-asset';
import {collection, getDocs, limit, query} from 'firebase/firestore';
import {db} from '../firebase';
import {renderReceiptSection} from './reportReceipts';
import {ProjectRecord} from './projectRecords';
import {summarizeContracts, summarizeInventory} from './recordMath';

type Records=Record<string,ProjectRecord[]>;
const amount=(row:ProjectRecord)=>Number(row.amount)||0;
const workbookDate=(value:any)=>typeof value==='number'&&Number.isFinite(value)?new Date((value-25569)*86400000).toISOString().slice(0,10):String(value||'');
function workbookExpenses(sheets:any):ProjectRecord[]{
  const values=sheets?.daily_expenses?.values||[];
  if(values.length<2)return [];
  const headers=(values[0]||[]).map((header:any)=>String(header||'').trim());
  const find=(pattern:RegExp)=>headers.findIndex((header:string)=>pattern.test(header));
  const date=find(/^date$/i),category=find(/expense category/i),person=find(/vendor \/ person/i),value=find(/amount paid/i),reference=find(/bill \/ voucher/i),description=find(/item \/ description/i),floor=find(/floor \/ area/i),stage=find(/work stage/i),mode=find(/payment mode/i),paidBy=find(/paid by/i),received=find(/received by/i),bill=find(/bill received/i),notes=find(/notes/i);
  const expenses:ProjectRecord[]=values.slice(1).filter((row:any[])=>row&&row.some(cell=>cell!==''&&cell!==null&&cell!==undefined)).map((row:any[],index:number)=>({id:sheets.daily_expenses.recordIds?.[index+1]||'',rowIndex:index+1,type:'payments',date:workbookDate(row[date]),category:String(row[category]||''),person:String(row[person]||''),amount:Number(String(row[value]??0).replace(/[₹,\s]/g,''))||0,reference:String(row[reference]||''),voucherNumber:String(row[reference]||''),description:String(row[description]||''),floor:String(row[floor]||''),stage:String(row[stage]||''),method:String(row[mode]||''),paidBy:String(row[paidBy]||''),receivedBy:String(row[received]||''),billReceived:String(row[bill]||''),notes:String(row[notes]||'')}));
  return expenses.filter((row:ProjectRecord)=>row.amount!==0||row.date||row.person||row.category);
}
const sumGroups=(rows:ProjectRecord[],key:(row:ProjectRecord)=>string)=>{
  const totals=new Map<string,{entries:number;amount:number}>();
  rows.forEach(row=>{const label=key(row)||'Unspecified';const current=totals.get(label)||{entries:0,amount:0};current.entries++;current.amount+=amount(row);totals.set(label,current);});
  return [...totals.entries()].map(([label,value])=>({Group:label,Entries:value.entries,Amount:value.amount}));
};

export async function exportProjectReports(records:Records,sheets:any={},sectionStatus:any[]=[]):Promise<void>{
  const workbook=XLSX.utils.book_new();
  const append=(name:string,rows:any[],headers:string[]=[])=>{const data=rows.length?rows:headers.length?[Object.fromEntries(headers.map(header=>[header,'']))]:[];const ws=XLSX.utils.json_to_sheet(data);if(!rows.length)ws['!ref']='A1';ws['!cols']=headers.length?headers.map(()=>({wch:20})):Object.keys(rows[0]||{}).map(()=>({wch:20}));XLSX.utils.book_append_sheet(workbook,ws,name);};
  const payments=records.payments||[];
  append('Payments',payments.map(row=>({RecordId:row.id||'',Date:row.date||'',VoucherNumber:row.voucherNumber||'',SourceExpenseId:row.sourceExpenseId||'',PaymentTo:row.paymentTo||row.person||'',Person:row.person||'',Description:row.description||'',Category:row.category||'',Floor:row.floor||'',WorkStage:row.stage||'',PaidBy:row.paidBy||'',PaymentMode:row.method||'',ReceivedBy:row.receivedBy||'',BillReceived:row.billReceived||'',ContractId:row.contractId||'',Type:row.paymentKind||'payment',Amount:amount(row),Reference:row.reference||'',Notes:row.notes||''})),['RecordId','Date','VoucherNumber','SourceExpenseId','PaymentTo','Description','Amount','ContractId']);
  const workbookRows=workbookExpenses(sheets);
  const workbookTotal=workbookRows.reduce((sum,row)=>sum+amount(row),0);
  const structuredTotal=payments.reduce((sum,row)=>sum+amount(row),0);
  append('Daily Expenses',workbookRows.map(row=>({SourceRecordId:row.id||'',Date:row.date,Person:row.person,Category:row.category,Amount:amount(row),VoucherNumber:row.voucherNumber,Description:row.description,Floor:row.floor,WorkStage:row.stage,PaymentMode:row.method,PaidBy:row.paidBy,ReceivedBy:row.receivedBy,BillReceived:row.billReceived,Notes:row.notes})),['SourceRecordId','Date','VoucherNumber','Person','Category','Amount','Description']);
  const agreements=summarizeContracts(records.contracts||[],payments);
  append('Contracts',agreements.map(row=>({RecordId:row.contract.id||'',Person:row.contract.person||'',Category:row.contract.category||'',AgreedAmount:row.agreed,Advances:row.advances,SubsequentPayments:row.paid,TotalPaid:row.advances+row.paid,Outstanding:row.balance,Overpaid:row.overpaid,StartDate:row.contract.startDate||'',Notes:row.contract.notes||''})),['RecordId','Person','Category','AgreedAmount','Advances','SubsequentPayments','TotalPaid','Outstanding','Overpaid','StartDate','Notes']);
  append('Project Summary',[
    {Metric:'Total agreed contract amount',Amount:agreements.reduce((sum,row)=>sum+row.agreed,0)},
    {Metric:'Advances',Amount:agreements.reduce((sum,row)=>sum+row.advances,0)},
    {Metric:'Subsequent payments',Amount:agreements.reduce((sum,row)=>sum+row.paid,0)},
    {Metric:'Total paid against agreements',Amount:agreements.reduce((sum,row)=>sum+row.advances+row.paid,0)},
    {Metric:'Outstanding',Amount:agreements.reduce((sum,row)=>sum+row.balance,0)},
    {Metric:'Overpayment',Amount:agreements.reduce((sum,row)=>sum+row.overpaid,0)},
    {Metric:'Structured payments (separate from workbook history)',Amount:structuredTotal},
    {Metric:'Daily Expenses workbook history (kept separate to avoid double counting)',Amount:workbookTotal},
    {Metric:'Report completeness',Amount:sectionStatus.some(section=>section.state==='failed')?'PARTIAL':'COMPLETE'}
  ],['Metric','Amount']);
  append('Stock Inventory',summarizeInventory(records.stock||[]).map(row=>({Material:row.material,Unit:row.unit,Ordered:row.purchased,Received:row.received,ReturnedToStock:row.returnedToStock,ReturnedToSupplier:row.returnedToSupplier,Used:row.used,Wastage:row.wastage,Available:row.available,LowStockLevel:row.lowStockLevel,LowStock:row.lowStock,Supplier:row.supplier,LatestRate:row.rate})),['Material','Unit','Ordered','Received','ReturnedToStock','ReturnedToSupplier','Used','Wastage','Available','LowStockLevel','LowStock','Supplier','LatestRate']);
  append('Progress', (records.progress||[]).map(row=>({RecordId:row.id||'',Activity:row.stage||'',Floor:row.floor||'',Percent:Number(row.percent)||0,PlannedFinish:row.plannedDate||'',ActualFinish:row.actualDate||'',Responsible:row.responsiblePerson||'',Notes:row.notes||''})),['RecordId','Activity','Floor','Percent','PlannedFinish','ActualFinish','Responsible','Notes']);
  append('Diary & Records',[...(records.diary||[]).map(row=>({RecordId:row.id,Type:'Diary',Date:row.date||'',Title:row.title||'',Floor:row.floor||'',Stage:row.stage||'',Description:row.description||'',Notes:row.notes||''})),...(records.approvals||[]).map(row=>({RecordId:row.id,Type:'Approval',Date:row.createdAt?.toDate?.()?.toISOString?.()||'',Title:row.expenseRef||row.title||'',Floor:'',Stage:row.status||'',Description:row.requestNote||'',Notes:row.decisionNote||''})),...(records.reminders||[]).map(row=>({RecordId:row.id,Type:'Reminder',Date:row.dueDate||'',Title:row.title||'',Floor:'',Stage:row.status||'',Description:'',Notes:row.notes||''}))],['RecordId','Type','Date','Title','Floor','Stage','Description','Notes']);
  append('Report Status',sectionStatus.map(section=>({Section:section.name,Status:section.state,Details:section.error||''})),['Section','Status','Details']);
  /* legacy financial source totals retained as distinct rows */
  append('Source Totals',[
    {Source:'Structured payment records',Entries:payments.length,Total:structuredTotal},
    {Source:'Historic workbook Daily Expenses',Entries:workbookRows.length,Total:workbookTotal},
    {Source:'Sources are separate; do not add both if structured records duplicate workbook history',Entries:'',Total:''}
  ]);
  const base64=XLSX.write(workbook,{bookType:'xlsx',type:'base64'});
  if(!FileSystem.cacheDirectory)throw new Error('Local cache is unavailable.');
  const uri=`${FileSystem.cacheDirectory}KSK_Project_Reports_${new Date().toISOString().slice(0,10)}.xlsx`;
  await FileSystem.writeAsStringAsync(uri,base64,{encoding:FileSystem.EncodingType.Base64});
  if(!(await Sharing.isAvailableAsync()))throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(uri,{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',dialogTitle:'Export KSK project reports'});
}

export async function exportProjectReportPdf(records:Records,sheets:any={},sectionStatus:any[]=[]):Promise<void>{
  const payments=records.payments||[];
  const dateRows=sumGroups(payments,row=>String(row.date||'Unspecified'));
  const categoryRows=sumGroups(payments,row=>String(row.category||'Unspecified'));
  const personRows=sumGroups(payments,row=>String(row.person||'Unspecified'));
  const workbookRows=workbookExpenses(sheets);
  const workbookTotal=workbookRows.reduce((sum,row)=>sum+amount(row),0);
  const structuredTotal=payments.reduce((sum,row)=>sum+amount(row),0);
  const agreements=summarizeContracts(records.contracts||[],payments).map(row=>({Person:row.contract.person||'',Category:row.contract.category||'',Agreed:row.agreed,Advances:row.advances,SubsequentPayments:row.paid,TotalPaid:row.advances+row.paid,Outstanding:row.balance,Overpaid:row.overpaid,StartDate:row.contract.startDate||'',Notes:row.contract.notes||''}));
  const stock=summarizeInventory(records.stock||[]);
  const progress=records.progress||[];
  const esc=(value:any)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
  const currency=(value:any)=>`₹${(Number(value)||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const table=(title:string,rows:any[])=>`<h2>${esc(title)}</h2><table><thead><tr>${Object.keys(rows[0]||{Message:'No records'}).map(key=>`<th>${esc(key)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${Object.values(row).map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join(''):'<tr><td>No records</td></tr>'}</tbody></table>`;
  const delayed=progress.filter(row=>row.plannedDate&&!row.actualDate&&Number(row.percent)<100&&row.plannedDate<new Date().toISOString().slice(0,10)).length;
  const averageProgress=progress.length?progress.reduce((sum,row)=>sum+Math.max(0,Math.min(100,Number(row.percent)||0)),0)/progress.length:0;
  const contractSums=agreements.reduce((sum,row)=>({agreed:sum.agreed+Number(row.Agreed||0),advances:sum.advances+Number(row.Advances||0),paid:sum.paid+Number(row.SubsequentPayments||0),balance:sum.balance+Number(row.Outstanding||0),overpaid:sum.overpaid+Number(row.Overpaid||0)}),{agreed:0,advances:0,paid:0,balance:0,overpaid:0});
  const financialSummary=[{Source:'Agreed contract amount',Entries:'',Total:currency(contractSums.agreed)},{Source:'Advances',Entries:'',Total:currency(contractSums.advances)},{Source:'Subsequent payments',Entries:'',Total:currency(contractSums.paid)},{Source:'Total paid against agreements',Entries:'',Total:currency(contractSums.advances+contractSums.paid)},{Source:'Outstanding',Entries:'',Total:currency(contractSums.balance)},{Source:'Overpayment',Entries:'',Total:currency(contractSums.overpaid)},{Source:'Structured payment records (separate source)',Entries:payments.length,Total:currency(structuredTotal)},{Source:'Daily Expenses workbook history (separate source)',Entries:workbookRows.length,Total:currency(workbookTotal)},{Source:sectionStatus.some(section=>section.state==='failed')?'Report status: PARTIAL':'Report status: COMPLETE',Entries:'',Total:''}];
  const setup=sheets?.project_setup?.values||[];const setupRows=setup.slice(1);const setting=(re:RegExp)=>{const row=setupRows.find((r:any[])=>re.test(String(r?.[0]||'')));return String(row?.[1]||'').trim();};const projectName=setting(/project name|owner/i)||'KSK House Construction';const location=setting(/location|site address/i)||'';
  let logo='';try{const asset=Asset.fromModule(require('../../assets/icon.png'));await asset.downloadAsync();const uri=asset.localUri||asset.uri;if(uri)logo=await FileSystem.readAsStringAsync(uri,{encoding:FileSystem.EncodingType.Base64});}catch{/* Branded text header remains available if asset loading fails. */}
  const attachments:{voucher:string;payment:string;image:string;filename:string}[]=[];const seen=new Set<string>();
  const pdfStatus=[...sectionStatus];
  if(db){for(const payment of payments.slice(0,250)){const workbookMatch=workbookRows.find(row=>row.voucherNumber&&row.voucherNumber===payment.voucherNumber);const ids=[payment.sourceExpenseId,workbookMatch?.id,payment.id].filter(Boolean);for(const id of ids){const group='bills';const key=`${group}/${id}`;if(seen.has(key))continue;seen.add(key);try{const snap=await getDocs(query(collection(db,'projects','ksk',group,id,'images'),limit(5)));for(const imageDoc of snap.docs){const data=imageDoc.data();if(typeof data.imageBase64==='string'&&data.imageBase64)attachments.push({voucher:String(payment.voucherNumber||''),payment:`${payment.paymentTo||payment.person||''} · ${currency(payment.amount)}`,image:data.imageBase64,filename:String(data.fileName||imageDoc.id)});}}catch(error:any){pdfStatus.push({name:'Receipt image reads',state:'failed',error:error?.code==='permission-denied'?'Permission denied':error?.code==='unavailable'?'Network unavailable':String(error?.message||'Image read failed')});}}}}
  const receiptHtml=renderReceiptSection(attachments);
  const paymentRows=payments.map(row=>({Date:row.date||'',Voucher:row.voucherNumber||'',PaymentTo:row.paymentTo||row.person||'',Description:row.description||'',Category:row.category||'',Floor:row.floor||'',WorkStage:row.stage||'',Amount:currency(row.amount),PaidBy:row.paidBy||'',Mode:row.method||'',ReceivedBy:row.receivedBy||'',Reference:row.reference||'',Agreement:row.contractId||'',Notes:row.notes||'',SourceVoucher:row.sourceExpenseId?'Daily Expenses':'Standalone'}));
  const html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>@page{margin:14mm}body{font-family:Arial,sans-serif;color:#18352b;padding:12px}h1{font-size:22px}h2{font-size:15px;margin-top:22px;page-break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:8px;page-break-inside:auto}thead{display:table-header-group}tr{page-break-inside:avoid}th,td{border:1px solid #cfd8d2;padding:4px;text-align:left;overflow-wrap:anywhere;word-break:break-word}th{background:#e6f1ec}header{border-bottom:3px solid #176b4b;padding-bottom:10px;margin-bottom:12px}header img{width:54px;height:54px;object-fit:contain;float:left;margin-right:12px}.receipt{page-break-inside:avoid;border:1px solid #ccd8d0;padding:10px;margin:10px 0}.receipt img{display:block;max-width:90%;max-height:620px;object-fit:contain;margin:8px auto}</style></head><body><header>${logo?`<img src="data:image/png;base64,${logo}"/>`:''}<h1>${esc(projectName)}</h1><b>KSK · Financial & Site Report</b><p>${esc(location)} · Generated ${esc(new Date().toLocaleString())}</p><div style="clear:both"></div></header>${table('Financial summary',financialSummary)}${table('Project Records load status',pdfStatus.map(section=>({Section:section.name,Status:section.state,Details:section.error||''})))}${table('Structured payment ledger',paymentRows)}${table('Daily Expenses · source workbook records',workbookRows.map(row=>({Date:row.date,Voucher:row.voucherNumber,Floor:row.floor,Stage:row.stage,Category:row.category,Description:row.description,Vendor:row.person,Amount:currency(row.amount),Mode:row.method,PaidBy:row.paidBy,ReceivedBy:row.receivedBy,BillReceived:row.billReceived,Notes:row.notes,SourceId:row.id})))}${table('Agreement balances · advances and subsequent payments',agreements)}${table('Stock on hand',stock.map(row=>({Material:row.material,Unit:row.unit,Ordered:row.purchased,Received:row.received,ReturnedToStock:row.returnedToStock,ReturnedToSupplier:row.returnedToSupplier,Used:row.used,Wastage:row.wastage,Available:row.available,LowStockLevel:row.lowStockLevel,LowStock:row.lowStock,Supplier:row.supplier,Rate:row.rate})))}${table(`Work progress · average ${averageProgress.toFixed(1)}% · delayed ${delayed}`,progress.map(row=>({Activity:row.stage,Floor:row.floor,Percent:row.percent,Planned:row.plannedDate,Actual:row.actualDate,Responsible:row.responsiblePerson,Notes:row.notes||''})))}${table('Site diary', (records.diary||[]).map(row=>({Date:row.date||'',Title:row.title||'',Floor:row.floor||'',Work:row.stage||'',Attendance:row.attendance||'',Issues:row.issues||'',Decisions:row.decisions||'',Notes:row.description||'',RecordId:row.id||''})))}${table('Approvals and reminders', [...(records.approvals||[]).map(row=>({Type:'Approval',Title:row.expenseRef||row.title||'',Status:row.status||'',Date:row.createdAt?.toDate?.()?.toISOString?.()||'',Notes:row.requestNote||row.decisionNote||''})),...(records.reminders||[]).map(row=>({Type:'Reminder',Title:row.title||'',Status:row.status||'',Date:row.dueDate||'',Notes:row.notes||''}))])}${receiptHtml}</body></html>`;
  const result=await Print.printToFileAsync({html});
  if(!(await Sharing.isAvailableAsync()))throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(result.uri,{mimeType:'application/pdf',dialogTitle:'Export KSK project report'});
}
