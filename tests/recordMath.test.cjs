const test = require('node:test');
const assert = require('node:assert/strict');
const {summarizeContracts, summarizeInventory} = require('../src/services/recordMath.js');
const {getMaterialOptions} = require('../src/services/materialOptions.js');
const {getDailyExpenseVoucherRows,canCreateVoucherPayment,voucherRemainingAmount,validateAgreementLink} = require('../src/services/projectRecordLinks.js');
const {renderReceiptSection} = require('../src/services/reportReceipts.js');
const {paymentIdForDocument,isDuplicatePaymentRetry,validatePaymentRecord,summarizePaymentRecords,paymentStatementLedger,paymentStatementAgreements} = require('../src/services/paymentMath.js');

test('material dropdown catalogue includes distinct values from all three material sheets',()=>{
  const options=getMaterialOptions({materials_ground:{values:[['Material / Item'],['Cement'],['Steel']]},materials_first:{values:[['Item'],['Steel'],['Blocks']]},materials_boq:{values:[['Description'],['Sand'],['Tiles']]}});
  assert.deepEqual(options,['Cement','Steel','Blocks','Sand','Tiles']);
});

test('voucher lookup maps all Daily Expenses fields and resolves source by stored recordId',()=>{
  const source=getDailyExpenseVoucherRows({recordIds:['header','expense-firestore-id'],values:[['Date','Bill / Voucher No.','Floor / Area','Work Stage','Expense Category','Item / Description','Vendor / Person','Amount Paid (₹)','Payment Mode','Paid By','Received by','Bill Received?','Notes'],['2026-04-05','V-9','Ground Floor','Foundation','Material','Cement','Supplier A','₹1,250','UPI','Owner','Supplier A','Yes','Delivered']]})[0];
  assert.equal(source.rowIndex,1);assert.equal(source.id,'expense-firestore-id');assert.equal(source.voucherNumber,'V-9');
  assert.deepEqual([source.date,source.floor,source.stage,source.category,source.description,source.paymentTo,source.amount,source.method,source.paidBy,source.receivedBy,source.billReceived,source.notes],['2026-04-05','Ground Floor','Foundation','Material','Cement','Supplier A','1250','UPI','Owner','Supplier A','Yes','Delivered']);
});

test('voucher duplicate guard blocks accidental duplicates, permits explicit partials and edits',()=>{
  const payments=[{id:'p1',sourceExpenseId:'source-1'}];
  assert.equal(canCreateVoucherPayment(payments,'source-1'),false);
  assert.equal(canCreateVoucherPayment(payments,'source-1',true),true);
  assert.equal(canCreateVoucherPayment(payments,'source-1',false,'p1'),true);
  assert.equal(canCreateVoucherPayment(payments,''),true);
});

test('partial voucher payments calculate the outstanding amount and exclude the edited payment',()=>{
  const expense={id:'expense-1',voucherNumber:'V-9',amount:'1000'};
  const payments=[{id:'p1',sourceExpenseId:'expense-1',amount:300},{id:'p2',voucherNumber:'V-9',amount:200}];
  assert.equal(voucherRemainingAmount(expense,payments),500);
  assert.equal(voucherRemainingAmount(expense,payments,'p1'),800);
});

test('agreement reference is optional and validates existence and selected person when supplied',()=>{
  const contracts=[{id:'c1',person:'Supplier A'}];
  assert.equal(validateAgreementLink('', '',contracts),true);
  assert.equal(validateAgreementLink('c1','Supplier A',contracts),true);
  assert.equal(validateAgreementLink('missing','Supplier A',contracts),false);
  assert.equal(validateAgreementLink('c1','Other',contracts),false);
});

test('PDF receipts render linked images and gracefully show empty state for missing receipts',()=>{
  const html=renderReceiptSection([{voucher:'V-9',payment:'Supplier A · ₹1,250',filename:'bill.jpg',image:'YWJj'}]);
  assert.match(html,/Voucher V-9/);assert.match(html,/data:image\/jpeg;base64,YWJj/);assert.match(html,/bill.jpg/);
  assert.match(renderReceiptSection([]),/No linked receipt images/);
  assert.match(renderReceiptSection([{image:''}]),/No linked receipt images/);
});

test('legacy agreement-linked payment fields remain included in agreement totals',()=>{
  const [summary]=summarizeContracts([{id:'legacy-contract',person:'Supplier',agreedAmount:500}],[{id:'legacy-payment',contractId:'legacy-contract',paymentKind:'advance',amount:100},{id:'legacy-payment-2',contractId:'legacy-contract',amount:50}]);
  assert.equal(summary.advances,100);assert.equal(summary.paid,50);assert.equal(summary.balance,350);
});

test('stock counts purchases as ordered and receipts once, then nets returns, use, and wastage', () => {
  const [cement] = summarizeInventory([
    {material:'Cement',unit:'bags',direction:'purchase',quantity:100},
    {material:'Cement',unit:'bags',direction:'received',quantity:80},
    {material:'Cement',unit:'bags',direction:'returned-to-stock',quantity:2},
    {material:'Cement',unit:'bags',direction:'returned-to-supplier',quantity:3},
    {material:'Cement',unit:'bags',direction:'used',quantity:50},
    {material:'Cement',unit:'bags',direction:'wastage',quantity:4},
    {material:'Cement',unit:'bags',direction:'returned',quantity:500},
    {material:'Cement',unit:'bags',direction:'received',quantity:8,lowStockLevel:40}
  ]);
  assert.equal(cement.purchased,100);
  assert.equal(cement.received,88);
  assert.equal(cement.available,33);
  assert.equal(cement.lowStock,true);
});

test('stock metadata comes from the most recent dated movement, not document order', () => {
  const [cement] = summarizeInventory([
    {material:'Cement',unit:'bags',direction:'received',quantity:2,date:'2026-03-01',unitRate:100,supplier:'Old supplier',lowStockLevel:9},
    {material:'Cement',unit:'bags',direction:'received',quantity:3,date:'2026-05-01',unitRate:120,supplier:'Current supplier',lowStockLevel:12}
  ]);
  assert.equal(cement.rate,120);
  assert.equal(cement.supplier,'Current supplier');
  assert.equal(cement.lowStockLevel,12);
});

test('person contracts count each advance and payment exactly once and do not infer legacy balances', () => {
  const ledger=summarizeContracts([
    {id:'contract-a',person:'Alex',agreedAmount:1000},
    {id:'contract-b',person:'Alex',agreedAmount:500}
  ],[
    {id:'a1',contractId:'contract-a',paymentKind:'advance',amount:200},
    {id:'a2',contractId:'contract-a',paymentKind:'payment',amount:300},
    {id:'a3',contractId:'contract-a',paymentKind:'Advance',amount:50},
    {id:'b1',contractId:'contract-b',paymentKind:'advance',amount:100},
    {id:'legacy',person:'Alex',advance:900,amount:40}
  ]);
  assert.equal(ledger[0].advances,250);
  assert.equal(ledger[0].paid,300);
  assert.equal(ledger[0].balance,450);
  assert.equal(ledger[0].history.length,3);
  assert.equal(ledger[1].balance,400);
});

test('contract summaries surface overpayment rather than a negative outstanding balance',()=>{
  const [entry]=summarizeContracts([{id:'c',agreedAmount:100}],[{contractId:'c',paymentKind:'advance',amount:80},{contractId:'c',paymentKind:'payment',amount:40}]);
  assert.equal(entry.balance,0);
  assert.equal(entry.overpaid,20);
});

test('payment IDs are deterministic and payment validation rejects invalid amount or date',()=>{
  assert.equal(paymentIdForDocument('abc123456789'),'KSK-PAY-ABC123456789');
  assert.equal(validatePaymentRecord({amount:25,date:'2026-04-05',paymentTo:'Vendor'}),true);
  assert.throws(()=>validatePaymentRecord({amount:0,date:'2026-04-05',paymentTo:'Vendor'}),/positive/);
  assert.throws(()=>validatePaymentRecord({amount:25,date:'2026-02-30',paymentTo:'Vendor'}),/valid payment date/);
});

test('payment retry for an existing stable document ID is treated as already committed',()=>{
  assert.equal(isDuplicatePaymentRetry(false),false);
  assert.equal(isDuplicatePaymentRetry(true),true);
});

test('payment reconciliation counts payment records once and separates advances',()=>{
  assert.deepEqual(summarizePaymentRecords([{amount:200,paymentKind:'advance',sourceExpenseId:'e1',contractId:'c'},{amount:300,sourceExpenseId:'e1',contractId:'c'},{amount:25}], [{id:'c',agreedAmount:600}]), {paid:525,advances:200,contractValue:600,remaining:100,overpaid:0,count:3});
});

test('payment statement includes unique agreement transactions in date order and recalculates paid and balance totals',()=>{
  const payment={id:'p3',contractId:'c1',date:'2026-03-01',description:'Final work',amount:250};
  const rows=[
    {id:'p2',contractId:'c1',date:'2026-02-01',description:'Materials',amount:250},
    {id:'other',contractId:'c2',date:'2026-01-01',description:'Other agreement',amount:900},
    {id:'p1',contractId:'c1',date:'2026-01-01',description:'Advance',amount:500},
    {id:'p2',contractId:'c1',date:'2026-02-01',description:'Duplicate snapshot',amount:250},
    payment
  ];
  const contracts=[{id:'c1',agreedAmount:1000},{id:'c2',agreedAmount:500}];
  const statement=paymentStatementLedger(payment,rows,contracts);
  assert.deepEqual(statement.history.map(row=>row.id),['p1','p2','p3']);
  assert.deepEqual(statement.history.map(row=>row.description),['Advance','Materials','Final work']);
  assert.equal(statement.agreedAmount,1000);
  assert.equal(statement.totalPaid,1000);
  assert.equal(statement.remainingBalance,0);
  const withNewPayment=paymentStatementLedger({...payment,id:'p4',date:'2026-04-01',amount:100},[...rows,{...payment,id:'p4',date:'2026-04-01',amount:100}],contracts);
  assert.equal(withNewPayment.history.length,4);
  assert.equal(withNewPayment.totalPaid,1100);
  assert.equal(withNewPayment.remainingBalance,-100);
});

test('payment statement does not infer agreed amount for a payment without an agreement',()=>{
  const statement=paymentStatementLedger({id:'standalone',amount:75,date:'2026-01-01'},[],[]);
  assert.deepEqual(statement,{history:[{id:'standalone',amount:75,date:'2026-01-01'}],agreedAmount:null,totalPaid:75,remainingBalance:null});
});

test('payment statement uses exact agreement IDs when names match and sums only that agreement',()=>{
  const agreements=[{id:'agreement-a',person:'Same Vendor',agreedAmount:1000},{id:'agreement-b',person:'Same Vendor',agreedAmount:400}];
  const p={id:'p1',contractId:'agreement-a',person:'Same Vendor',amount:100};
  const statement=paymentStatementLedger(p,[p,{id:'p2',contractId:'agreement-a',person:'Same Vendor',amount:50},{id:'p3',contractId:'agreement-b',person:'Same Vendor',amount:200}],agreements);
  assert.equal(statement.agreedAmount,1000);
  assert.equal(statement.totalPaid,150);
  assert.equal(statement.remainingBalance,850);
  assert.throws(()=>paymentStatementLedger({...p,contractId:'missing'},[p],agreements),/could not be found/);
});

test('legacy payments use a normalized payee only when it identifies one agreement',()=>{
  const agreements=[{id:'a',person:'Vendor One',agreedAmount:500},{id:'b',person:'Vendor Two',agreedAmount:200}];
  const p={id:'legacy1',person:'  VENDOR   ONE ',amount:80};
  const statement=paymentStatementLedger(p,[p,{id:'legacy2',paymentTo:'Vendor One',amount:20}],agreements);
  assert.equal(statement.agreedAmount,500);
  assert.equal(statement.totalPaid,100);
  assert.equal(statement.remainingBalance,400);
  const exactLinked=paymentStatementLedger({id:'linked',contractId:'a',person:'Vendor One',amount:10},[{id:'linked',contractId:'a',person:'Vendor One',amount:10},{id:'old',person:'vendor one',amount:30},{id:'other',contractId:'b',person:'Vendor Two',amount:900}],agreements);
  assert.equal(exactLinked.totalPaid,40);
  assert.deepEqual(exactLinked.history.map(row=>row.id),['linked','old']);
  assert.equal(paymentStatementLedger({id:'ambiguous',person:'Same',amount:1},[],[{id:'a',person:'Same',agreedAmount:5},{id:'b',person:'Same',agreedAmount:8}]).agreedAmount,null);
});

test('filtered statement balances use the complete unique payment history per agreement',()=>{
  const agreements=[{id:'a',person:'Same Vendor',agreedAmount:1000},{id:'b',person:'Same Vendor',agreedAmount:500}];
  const all=[{id:'p1',contractId:'a',amount:100},{id:'p2',contractId:'a',amount:200},{id:'p2',contractId:'a',amount:200},{id:'p3',contractId:'b',amount:150}];
  const totals=paymentStatementAgreements([all[0],all[3]],all,agreements);
  assert.deepEqual(totals.map(row=>[row.agreement.id,row.agreedAmount,row.totalPaid,row.remainingBalance]),[['a',1000,300,700],['b',500,150,350]]);
});
