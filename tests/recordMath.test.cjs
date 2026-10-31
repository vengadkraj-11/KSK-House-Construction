const test = require('node:test');
const assert = require('node:assert/strict');
const {summarizeContracts, summarizeInventory} = require('../src/services/recordMath.js');

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
