const test = require('node:test');
const assert = require('node:assert/strict');

const project='demo-ksk';
const root=`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents`;
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function token(uid){
  const now=Math.floor(Date.now()/1000);
  return `${b64({alg:'none',typ:'JWT'})}.${b64({iss:`https://securetoken.google.com/${project}`,aud:project,auth_time:now,user_id:uid,sub:uid,iat:now,exp:now+3600,firebase:{sign_in_provider:'custom',identities:{}}})}.`;
}
const stringValue=value=>({stringValue:value});
const numberValue=value=>({integerValue:String(value)});
async function request(path,uid,method='GET',body){
  const response=await fetch(`${root}/${path}`,{method,headers:{Authorization:`Bearer ${uid==='admin'?'owner':token(uid)}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return response;
}
async function seed(path,fields){
  const response=await request(path,'admin','PATCH',{fields});
  assert.ok(response.ok,`Admin fixture failed for ${path}: ${response.status} ${await response.text()}`);
}
async function commit(uid,writes){
  return fetch(`${root}:commit`,{method:'POST',headers:{Authorization:`Bearer ${token(uid)}`,'Content-Type':'application/json'},body:JSON.stringify({writes})});
}

test('Firestore rules preserve member receipt reads and owner-only writes',async()=>{
  await seed('users/owner',{projectId:stringValue('ksk'),role:stringValue('owner')});
  await seed('users/viewer',{projectId:stringValue('ksk'),role:stringValue('viewer')});
  await seed('projects/ksk/sheets/sheet1',{name:stringValue('Test')});
  await seed('projects/ksk/payments/payment1',{person:stringValue('A'),amount:numberValue(10)});
  await seed('projects/ksk/contracts/contract1',{person:stringValue('A'),agreedAmount:numberValue(50)});
  await seed('projects/ksk/stock/stock1',{material:stringValue('Cement'),quantity:numberValue(1)});
  await seed('projects/ksk/progress/progress1',{stage:stringValue('Foundation'),percent:numberValue(50)});
  await seed('projects/ksk/diary/diary1',{title:stringValue('Site note')});
  await seed('projects/ksk/reminders/reminder1',{title:stringValue('Inspection')});
  await seed('projects/ksk/approvals/approval1',{status:stringValue('pending')});
  await seed('projects/ksk/bills/payment1/images/receipt1',{recordId:stringValue('payment1'),imageBase64:stringValue('YWJj'),fileName:stringValue('receipt.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner'),createdAt:{timestampValue:new Date().toISOString()}});
  await seed('projects/ksk/attachments/diary1/images/photo1',{recordId:stringValue('diary1'),imageBase64:stringValue('YWJj'),fileName:stringValue('site.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner'),createdAt:{timestampValue:new Date().toISOString()}});

  assert.equal((await request('projects/ksk/sheets/sheet1','owner')).status,200);
  assert.equal((await request('projects/ksk/sheets/sheet1','viewer')).status,200);
  assert.equal((await request('projects/ksk/bills/payment1/images/receipt1','viewer')).status,200);
  assert.equal((await request('projects/ksk/attachments/diary1/images/photo1','viewer')).status,200);
  assert.equal((await request('projects/ksk/payments/payment1','viewer')).status,200);
  for(const uid of ['owner','viewer']) {
    const listed=await fetch(`${root}/projects/ksk:runQuery`,{method:'POST',headers:{Authorization:`Bearer ${token(uid)}`,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:'payments'}],limit:10}})});
    assert.equal(listed.status,200,await listed.text());
  }
  assert.equal((await request('projects/ksk/contracts/contract1','viewer')).status,200);
  for (const path of ['projects/ksk/stock/stock1','projects/ksk/progress/progress1','projects/ksk/diary/diary1']) assert.equal((await request(path,'viewer')).status,200);
  assert.equal((await request('projects/ksk/approvals/approval1','viewer')).status,403);
  assert.equal((await request('projects/ksk/reminders/reminder1','viewer')).status,403);
  for (const path of ['projects/ksk/contracts/contract1','projects/ksk/stock/stock1','projects/ksk/progress/progress1','projects/ksk/diary/diary1','projects/ksk/reminders/reminder1']) {
    assert.equal((await request(path,'viewer','DELETE')).status,403,`Viewers must not delete ${path}.`);
  }
  assert.equal((await request('projects/ksk/sheets/sheet1','unknown')).status,403);

  const standalonePaymentPath=`projects/${project}/databases/(default)/documents/projects/ksk/payments/standalone-payment`;
  const standalonePayment=await commit('owner',[{update:{name:standalonePaymentPath,fields:{createdBy:stringValue('owner'),amount:numberValue(25),person:stringValue('A'),date:stringValue('2026-10-31'),paymentId:stringValue('KSK-PAY-standalone-payment'),updatedAt:{timestampValue:new Date().toISOString()},schemaVersion:numberValue(2)}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(standalonePayment.status,200,await standalonePayment.text());
  const paymentActivityPath=`projects/${project}/databases/(default)/documents/projects/ksk/activity/payment-event`;
  const appShapedPayment=await commit('owner',[
    {update:{name:`projects/${project}/databases/(default)/documents/projects/ksk/payments/app-shaped`,fields:{createdBy:stringValue('owner'),amount:numberValue(25),person:stringValue('A'),paymentTo:stringValue('A'),date:stringValue('2026-10-31'),paymentId:stringValue('KSK-PAY-app-shaped'),paymentKind:stringValue('payment'),currency:stringValue('₹'),status:stringValue('paid'),enteredBy:stringValue('owner'),schemaVersion:numberValue(2)}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:paymentActivityPath,fields:{actorUid:stringValue('owner'),actorName:stringValue('Project owner'),changeType:stringValue('edited'),sheetId:stringValue('module_payments'),sheetName:stringValue('Payments'),title:stringValue('Added Payment record'),body:stringValue('Payment record added in Project Records'),itemName:stringValue('KSK-PAY-app-shaped'),details:stringValue('Payment record created')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}
  ]);
  assert.equal(appShapedPayment.status,200,await appShapedPayment.text());

  const linkedPaymentPath=`projects/${project}/databases/(default)/documents/projects/ksk/payments/contract-linked`;
  const linkedActivityPath=`projects/${project}/databases/(default)/documents/projects/ksk/activity/contract-linked-event`;
  const linkedPayment=await commit('owner',[
    {update:{name:linkedPaymentPath,fields:{createdBy:stringValue('owner'),amount:numberValue(40),person:stringValue('A'),paymentTo:stringValue('A'),contractId:stringValue('contract1'),date:stringValue('2026-10-31'),paymentKind:stringValue('advance'),paymentId:stringValue('KSK-PAY-contract-linked'),schemaVersion:numberValue(2)}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:linkedActivityPath,fields:{actorUid:stringValue('owner'),actorName:stringValue('Project owner'),changeType:stringValue('edited'),sheetId:stringValue('module_payments'),sheetName:stringValue('Payments'),title:stringValue('Added Payment record'),body:stringValue('Payment record added in Project Records'),itemName:stringValue('KSK-PAY-contract-linked'),details:stringValue('Payment record created')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}
  ]);
  assert.equal(linkedPayment.status,200,await linkedPayment.text());
  const mismatchedContract=await commit('owner',[{update:{name:linkedPaymentPath.replace('contract-linked','wrong-person'),fields:{createdBy:stringValue('owner'),amount:numberValue(40),person:stringValue('Different Person'),contractId:stringValue('contract1'),date:stringValue('2026-10-31')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(mismatchedContract.status,403,await mismatchedContract.text());
  const invalidAgreementPath=standalonePaymentPath.replace('standalone-payment','invalid-agreement');
  const invalidAgreement=await commit('owner',[{update:{name:invalidAgreementPath,fields:{createdBy:stringValue('owner'),amount:numberValue(25),person:stringValue('A'),contractId:stringValue('missing-contract'),date:stringValue('2026-10-31')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(invalidAgreement.status,403);

  const rejectedAtomicPath=`projects/${project}/databases/(default)/documents/projects/ksk/payments/rejected-atomic`;
  const invalidAtomicActivity=await commit('owner',[
    {update:{name:rejectedAtomicPath,fields:{createdBy:stringValue('owner'),amount:numberValue(12),person:stringValue('A'),date:stringValue('2026-10-31')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:paymentActivityPath.replace('payment-event','invalid-payment-event'),fields:{actorUid:stringValue('owner'),changeType:stringValue('edited'),sheetId:stringValue('module_payments'),sheetName:stringValue('Payments'),title:stringValue('Payment'),body:stringValue('Payment'),unexpected:stringValue('not allowed')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}
  ]);
  assert.equal(invalidAtomicActivity.status,403,await invalidAtomicActivity.text());
  assert.equal((await request('projects/ksk/payments/rejected-atomic','owner')).status,404,'Rejected activity write must also roll back the payment write.');

  const stockPath=`projects/${project}/databases/(default)/documents/projects/ksk/stock/movement-owner`;
  const stockCreate=await commit('owner',[{update:{name:stockPath,fields:{createdBy:stringValue('owner'),material:stringValue('Cement'),unit:stringValue('bags'),direction:stringValue('received'),quantity:numberValue(12)}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(stockCreate.status,200,await stockCreate.text());
  const stockUpdate=await commit('owner',[{update:{name:stockPath,fields:{quantity:numberValue(14)}},updateMask:{fieldPaths:['quantity']}}]);
  assert.equal(stockUpdate.status,200,await stockUpdate.text());
  const viewerStockWrite=await commit('viewer',[{update:{name:stockPath,fields:{quantity:numberValue(15)}},updateMask:{fieldPaths:['quantity']}}]);
  assert.equal(viewerStockWrite.status,403,await viewerStockWrite.text());
  const paymentUpdate=await commit('owner',[{update:{name:standalonePaymentPath,fields:{amount:numberValue(30)}},updateMask:{fieldPaths:['amount']}}]);
  assert.equal(paymentUpdate.status,200,await paymentUpdate.text());
  assert.equal((await request('projects/ksk/payments/payment1','viewer','DELETE')).status,403,'Viewers must not delete payments directly.');
  assert.equal((await request('projects/ksk/payments/payment1','owner','DELETE')).status,200,'Project owners may delete payments.');
  const wrongProject=await request('projects/other/stock/movement-owner','owner');
  assert.equal(wrongProject.status,403);

  const activityPath=`projects/${project}/databases/(default)/documents/projects/ksk/activity/stock-event`;
  const validActivity=await commit('owner',[{update:{name:activityPath,fields:{actorUid:stringValue('owner'),actorName:stringValue('Project owner'),changeType:stringValue('edited'),sheetId:stringValue('module_stock'),sheetName:stringValue('Stock'),title:stringValue('Added Stock record'),body:stringValue('Stock record added in Project Records'),itemName:stringValue('Stock'),details:stringValue('Stock record created')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(validActivity.status,200,await validActivity.text());
  const invalidActivity=await commit('owner',[{update:{name:activityPath.replace('stock-event','invalid-event'),fields:{actorUid:stringValue('owner'),changeType:stringValue('edited'),sheetId:stringValue('module_stock'),sheetName:stringValue('Stock'),title:stringValue('Bad'),body:stringValue('Bad'),unexpected:stringValue('extra')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(invalidActivity.status,403,await invalidActivity.text());

  const deniedPayment=await request('projects/ksk/payments?documentId=viewer-write','viewer','POST',{fields:{createdBy:stringValue('viewer'),amount:numberValue(1)}});
  assert.equal(deniedPayment.status,403);
  const viewerTransaction=await commit('viewer',[{update:{name:`projects/${project}/databases/(default)/documents/projects/ksk/payments/viewer-payment`,fields:{createdBy:stringValue('viewer'),amount:numberValue(25),person:stringValue('A'),date:stringValue('2026-10-31')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(viewerTransaction.status,403);
  const missingMembership=await request('projects/ksk/payments/payment1','unassigned');
  assert.equal(missingMembership.status,403);
  const wrongProjectPayment=await request('projects/other/payments/payment1','owner');
  assert.equal(wrongProjectPayment.status,403);
  const invalidPayment=await commit('owner',[{update:{name:`projects/${project}/databases/(default)/documents/projects/ksk/payments/invalid-payload`,fields:{createdBy:stringValue('owner'),amount:stringValue('not-a-number'),person:stringValue('A'),date:stringValue('bad-date')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(invalidPayment.status,403);
  const deniedReceipt=await request('projects/ksk/bills/payment1/images?documentId=viewer-photo','viewer','POST',{fields:{recordId:stringValue('payment1'),imageBase64:stringValue('YWJj'),fileName:stringValue('x.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner'),createdAt:{timestampValue:new Date().toISOString()}}});
  assert.equal(deniedReceipt.status,403);
  const deniedDiaryPhoto=await request('projects/ksk/attachments/diary1/images?documentId=viewer-photo','viewer','POST',{fields:{recordId:stringValue('diary1'),imageBase64:stringValue('YWJj'),fileName:stringValue('x.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner'),createdAt:{timestampValue:new Date().toISOString()}}});
  assert.equal(deniedDiaryPhoto.status,403);
  const ownerImagePath=`projects/${project}/databases/(default)/documents/projects/ksk/attachments/diary2/images/site1`;
  const ownerPhoto=await commit('owner',[{update:{name:ownerImagePath,fields:{recordId:stringValue('diary2'),imageBase64:stringValue('YWJj'),fileName:stringValue('site.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(ownerPhoto.status,200,await ownerPhoto.text());
  const ownerReceiptPath=`projects/${project}/databases/(default)/documents/projects/ksk/bills/payment1/images/owner-receipt`;
  const ownerReceipt=await commit('owner',[{update:{name:ownerReceiptPath,fields:{recordId:stringValue('payment1'),imageBase64:stringValue('YWJj'),fileName:stringValue('owner-receipt.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(ownerReceipt.status,200,await ownerReceipt.text());
  const restoredPhoto=await commit('owner',[{update:{name:ownerImagePath.replace('site1','site-restored'),fields:{recordId:stringValue('diary2'),imageBase64:stringValue('YWJj'),fileName:stringValue('restored.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner'),restoredCreatedAt:{timestampValue:new Date().toISOString()}}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(restoredPhoto.status,200,await restoredPhoto.text());
  const oversized=await commit('owner',[{update:{name:`${ownerImagePath.replace('site1','site2')}`,fields:{recordId:stringValue('diary2'),imageBase64:stringValue('A'.repeat(450001)),fileName:stringValue('large.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(oversized.status,403);
  const deniedRole=await request('users/viewer','viewer','PATCH',{fields:{projectId:stringValue('ksk'),role:stringValue('owner')}});
  assert.equal(deniedRole.status,403);

  const approvalPath=`projects/${project}/databases/(default)/documents/projects/ksk/approvals/approval2`;
  const created=await commit('owner',[{update:{name:approvalPath,fields:{createdBy:stringValue('owner'),expenseRef:stringValue('site purchase'),status:stringValue('pending')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(created.status,200,await created.text());
  const decided=await commit('owner',[{update:{name:approvalPath,fields:{status:stringValue('approved'),decidedBy:stringValue('owner'),decisionNote:stringValue('Checked invoice'),history:{arrayValue:{values:[{mapValue:{fields:{status:stringValue('approved'),note:stringValue('Checked invoice'),actorUid:stringValue('owner'),decidedAt:{timestampValue:new Date().toISOString()}}}}]}}}},updateMask:{fieldPaths:['status','decidedBy','decisionNote','history','updatedAt']},updateTransforms:[{fieldPath:'decidedAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(decided.status,200,await decided.text());
  const deniedDecision=await commit('viewer',[{update:{name:approvalPath,fields:{status:stringValue('rejected'),decidedBy:stringValue('viewer'),history:{arrayValue:{values:[{mapValue:{fields:{status:stringValue('rejected'),note:stringValue(''),actorUid:stringValue('viewer'),decidedAt:{timestampValue:new Date().toISOString()}}}}]}}}},updateMask:{fieldPaths:['status','decidedBy','history']},updateTransforms:[{fieldPath:'decidedAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(deniedDecision.status,403,await deniedDecision.text());
  const forgedApprovalPath=`projects/${project}/databases/(default)/documents/projects/ksk/approvals/forged`;
  const forgedApproval=await commit('owner',[{update:{name:forgedApprovalPath,fields:{createdBy:stringValue('owner'),expenseRef:stringValue('bypass'),status:stringValue('approved')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(forgedApproval.status,403,await forgedApproval.text());
  const alteredRequest=await commit('owner',[{update:{name:approvalPath,fields:{expenseRef:stringValue('edited after decision'),status:stringValue('rejected'),decidedBy:stringValue('owner'),decisionNote:stringValue('Changed'),history:{arrayValue:{values:[{mapValue:{fields:{status:stringValue('rejected'),note:stringValue('Changed'),actorUid:stringValue('owner'),decidedAt:{timestampValue:new Date().toISOString()}}}}]}}}},updateMask:{fieldPaths:['expenseRef','status','decidedBy','decisionNote','history']},updateTransforms:[{fieldPath:'decidedAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(alteredRequest.status,403,await alteredRequest.text());
  assert.equal((await request('projects/ksk/approvals/approval2','viewer','DELETE')).status,403,'Viewers must not delete approvals.');
  const deletedApproval=await request('projects/ksk/approvals/approval2','owner','DELETE');
  assert.equal(deletedApproval.status,200,'Project owners may delete approvals.');
  await seed('projects/ksk/approvals/approvalLegacy',{status:stringValue('Pending')});
  const legacyPath=`projects/${project}/databases/(default)/documents/projects/ksk/approvals/approvalLegacy`;
  const legacyDecision=await commit('owner',[{update:{name:legacyPath,fields:{status:stringValue('rejected'),decidedBy:stringValue('owner'),decisionNote:stringValue('legacy checked'),history:{arrayValue:{values:[{mapValue:{fields:{status:stringValue('rejected'),note:stringValue('legacy checked'),actorUid:stringValue('owner'),decidedAt:{timestampValue:new Date().toISOString()}}}}]}}}},updateMask:{fieldPaths:['status','decidedBy','decisionNote','history','updatedAt']},updateTransforms:[{fieldPath:'decidedAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(legacyDecision.status,200,await legacyDecision.text());
  for (const path of ['projects/ksk/contracts/contract1','projects/ksk/stock/stock1','projects/ksk/progress/progress1','projects/ksk/diary/diary1','projects/ksk/reminders/reminder1']) {
    assert.equal((await request(path,'owner','DELETE')).status,200,`Project owners may delete ${path}.`);
  }
});
