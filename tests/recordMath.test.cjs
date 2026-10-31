const test = require('node:test');
const assert = require('node:assert/strict');
const {summarizeContracts, summarizeInventory} = require('../src/services/recordMath.js');
const {getMaterialOptions} = require('../src/services/materialOptions.js');
const {getDailyExpenseVoucherRows,canCreateVoucherPayment,validateAgreementLink} = require('../src/services/projectRecordLinks.js');
const {renderReceiptSection} = require('../src/services/reportReceipts.js');

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
