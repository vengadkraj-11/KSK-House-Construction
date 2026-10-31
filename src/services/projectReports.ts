import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
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
  const date=find(/^date$/i),category=find(/expense category/i),person=find(/vendor \/ person/i),value=find(/amount paid/i),reference=find(/bill \/ voucher/i),description=find(/item \/ description/i);
  const expenses:ProjectRecord[]=values.slice(1).filter((row:any[])=>row&&row.some(cell=>cell!==''&&cell!==null&&cell!==undefined)).map((row:any[],index:number)=>({id:String(index),type:'payments',date:workbookDate(row[date]),category:String(row[category]||''),person:String(row[person]||''),amount:Number(String(row[value]??0).replace(/[₹,\s]/g,''))||0,reference:String(row[reference]||''),description:String(row[description]||'')}));
  return expenses.filter((row:ProjectRecord)=>row.amount!==0||row.date||row.person||row.category);
}
const sumGroups=(rows:ProjectRecord[],key:(row:ProjectRecord)=>string)=>{
  const totals=new Map<string,{entries:number;amount:number}>();
  rows.forEach(row=>{const label=key(row)||'Unspecified';const current=totals.get(label)||{entries:0,amount:0};current.entries++;current.amount+=amount(row);totals.set(label,current);});
  return [...totals.entries()].map(([label,value])=>({Group:label,Entries:value.entries,Amount:value.amount}));
};

export async function exportProjectReports(records:Records,sheets:any={}):Promise<void>{
  const workbook=XLSX.utils.book_new();
  const append=(name:string,rows:any[])=>XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(rows.length?rows:[{Message:'No records'}]),name);
  const payments=records.payments||[];
  append('Payments',payments.map(row=>({Date:row.date||'',Person:row.person||'',Category:row.category||'',ContractId:row.contractId||'',Type:row.paymentKind||'payment',Amount:amount(row),Reference:row.reference||''})));
  append('By date',sumGroups(payments,row=>String(row.date||'')));
  append('By category',sumGroups(payments,row=>String(row.category||'')));
  append('By person',sumGroups(payments,row=>String(row.person||'')));
  const workbookRows=workbookExpenses(sheets);
  const workbookTotal=workbookRows.reduce((sum,row)=>sum+amount(row),0);
  const structuredTotal=payments.reduce((sum,row)=>sum+amount(row),0);
  append('Workbook expenses',workbookRows.map(row=>({Date:row.date,Person:row.person,Category:row.category,Amount:amount(row),Reference:row.reference,Description:row.description})));
  append('Workbook by date',sumGroups(workbookRows,row=>String(row.date||'Unspecified')));
  append('Workbook by category',sumGroups(workbookRows,row=>String(row.category||'Unspecified')));
  append('Workbook by person',sumGroups(workbookRows,row=>String(row.person||'Unspecified')));
  append('Summary',[
    {Source:'Structured payment records',Entries:payments.length,Total:structuredTotal},
    {Source:'Historic workbook Daily Expenses',Entries:workbookRows.length,Total:workbookTotal},
    {Source:'Sources are separate; do not add both if structured records duplicate workbook history',Entries:'',Total:''}
  ]);
  const movements=records.stock||[];
  append('Stock', summarizeInventory(movements).map(row=>({Material:row.material,Unit:row.unit,Purchased:row.purchased,Received:row.received,ReturnedToStock:row.returnedToStock,ReturnedToSupplier:row.returnedToSupplier,Used:row.used,Wastage:row.wastage,Available:row.available,LowStockLevel:row.lowStockLevel,LowStock:row.lowStock,Supplier:row.supplier,LatestRate:row.rate})));
  append('Work progress',(records.progress||[]).map(row=>({Activity:row.stage||'',Floor:row.floor||'',Percent:Number(row.percent)||0,PlannedFinish:row.plannedDate||'',ActualFinish:row.actualDate||'',Responsible:row.responsiblePerson||'',Delayed:!!(row.plannedDate&&!row.actualDate&&Number(row.percent)<100&&row.plannedDate<new Date().toISOString().slice(0,10))})));
  append('Agreements',summarizeContracts(records.contracts||[],payments).map(row=>({Person:row.contract.person||'',Category:row.contract.category||'',AgreedAmount:row.agreed,Advances:row.advances,Payments:row.paid,Outstanding:row.balance,Overpaid:row.overpaid,ContractId:row.contract.id,StartDate:row.contract.startDate||''})));
  const base64=XLSX.write(workbook,{bookType:'xlsx',type:'base64'});
  if(!FileSystem.cacheDirectory)throw new Error('Local cache is unavailable.');
  const uri=`${FileSystem.cacheDirectory}KSK_Project_Reports_${new Date().toISOString().slice(0,10)}.xlsx`;
  await FileSystem.writeAsStringAsync(uri,base64,{encoding:FileSystem.EncodingType.Base64});
  if(!(await Sharing.isAvailableAsync()))throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(uri,{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',dialogTitle:'Export KSK project reports'});
}

export async function exportProjectReportPdf(records:Records,sheets:any={}):Promise<void>{
  const payments=records.payments||[];
  const dateRows=sumGroups(payments,row=>String(row.date||'Unspecified'));
  const categoryRows=sumGroups(payments,row=>String(row.category||'Unspecified'));
  const personRows=sumGroups(payments,row=>String(row.person||'Unspecified'));
  const workbookRows=workbookExpenses(sheets);
  const workbookTotal=workbookRows.reduce((sum,row)=>sum+amount(row),0);
  const structuredTotal=payments.reduce((sum,row)=>sum+amount(row),0);
  const agreements=summarizeContracts(records.contracts||[],payments).map(row=>({Person:row.contract.person||'',Category:row.contract.category||'',Agreed:row.agreed,Advances:row.advances,Payments:row.paid,Outstanding:row.balance,Overpaid:row.overpaid}));
  const stock=summarizeInventory(records.stock||[]);
  const progress=records.progress||[];
  const esc=(value:any)=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
  const table=(title:string,rows:any[])=>`<h2>${esc(title)}</h2><table><thead><tr>${Object.keys(rows[0]||{Message:'No records'}).map(key=>`<th>${esc(key)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${Object.values(row).map(value=>`<td>${esc(value)}</td>`).join('')}</tr>`).join(''):'<tr><td>No records</td></tr>'}</tbody></table>`;
  const delayed=progress.filter(row=>row.plannedDate&&!row.actualDate&&Number(row.percent)<100&&row.plannedDate<new Date().toISOString().slice(0,10)).length;
  const averageProgress=progress.length?progress.reduce((sum,row)=>sum+Math.max(0,Math.min(100,Number(row.percent)||0)),0)/progress.length:0;
  const financialSummary=[{Source:'Structured payment records',Entries:payments.length,Total:structuredTotal},{Source:'Historic workbook Daily Expenses',Entries:workbookRows.length,Total:workbookTotal},{Source:'Separate sources; totals are not combined',Entries:'',Total:''}];
  const html=`<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>body{font-family:Arial,sans-serif;color:#18352b;padding:24px}h1{font-size:22px}h2{font-size:16px;margin-top:24px}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #cfd8d2;padding:6px;text-align:left}th{background:#e6f1ec}</style></head><body><h1>KSK House Construction · Financial & Site Report</h1><p>Generated ${esc(new Date().toLocaleString())}</p>${table('Financial summary · separate sources',financialSummary)}${table('Structured payment ledger by date',dateRows)}${table('Structured payments by category',categoryRows)}${table('Structured payments by person',personRows)}${table('Workbook expenses by date',sumGroups(workbookRows,row=>String(row.date||'Unspecified')))}${table('Workbook expenses by category',sumGroups(workbookRows,row=>String(row.category||'Unspecified')))}${table('Workbook expenses by person',sumGroups(workbookRows,row=>String(row.person||'Unspecified')))}${table('Agreement balances',agreements)}${table('Stock on hand',stock.map(row=>({Material:row.material,Unit:row.unit,Ordered:row.purchased,Received:row.received,ReturnedToStock:row.returnedToStock,ReturnedToSupplier:row.returnedToSupplier,Used:row.used,Wastage:row.wastage,Available:row.available,LowStockLevel:row.lowStockLevel,LowStock:row.lowStock,Supplier:row.supplier,Rate:row.rate})))}${table(`Work progress · average ${averageProgress.toFixed(1)}% · delayed ${delayed}`,progress.map(row=>({Activity:row.stage,Floor:row.floor,Percent:row.percent,Planned:row.plannedDate,Actual:row.actualDate,Responsible:row.responsiblePerson})))}</body></html>`;
  const result=await Print.printToFileAsync({html});
  if(!(await Sharing.isAvailableAsync()))throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(result.uri,{mimeType:'application/pdf',dialogTitle:'Export KSK project report'});
}
