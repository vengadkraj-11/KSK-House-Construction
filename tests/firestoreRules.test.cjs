const test = require('node:test');
const assert = require('node:assert/strict');

const project='demo-ksk';
const root=`http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents`;
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function token(uid,phone,provider,authTime=Math.floor(Date.now()/1000)){
  const now=Math.floor(Date.now()/1000);
  return `${b64({alg:'none',typ:'JWT'})}.${b64({iss:`https://securetoken.google.com/${project}`,aud:project,auth_time:authTime,user_id:uid,sub:uid,iat:now,exp:now+3600,...(phone?{phone_number:phone}:{}),firebase:{sign_in_provider:provider||(phone?'phone':'custom'),identities:{}}})}.`;
}
const stringValue=value=>({stringValue:value});
const numberValue=value=>({integerValue:String(value)});
async function request(path,uid,method='GET',body,phone,provider,authTime){
  const response=await fetch(`${root}/${path}`,{method,headers:{Authorization:`Bearer ${uid==='admin'?'owner':token(uid,phone,provider,authTime)}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return response;
}
async function seed(path,fields){
  const response=await request(path,'admin','PATCH',{fields});
  assert.ok(response.ok,`Admin fixture failed for ${path}: ${response.status} ${await response.text()}`);
}
async function commit(uid,writes,phone,provider,authTime){
  return fetch(`${root}:commit`,{method:'POST',headers:{Authorization:`Bearer ${token(uid,phone,provider,authTime)}`,'Content-Type':'application/json'},body:JSON.stringify({writes})});
}

test('Firestore rules preserve member receipt reads and owner-only writes',async()=>{
  await seed('users/owner',{projectId:stringValue('ksk'),role:stringValue('owner')});
  await seed('users/viewer',{projectId:stringValue('ksk'),role:stringValue('viewer')});
  await seed('users/viewer/devices/device-token',{token:stringValue('test-token'),platform:stringValue('android')});
  await seed('projects/ksk/sheets/sheet1',{name:stringValue('Test')});
  await seed('projects/ksk/sheets/project_dashboard',{name:stringValue('Dashboard')});
  await seed('projects/ksk/sheets/daily_expenses',{name:stringValue('Expenses')});
  await seed('projects/ksk/sheets/quotation_compare',{name:stringValue('Owner-only quotes')});
  await seed('projects/ksk/payments/payment1',{person:stringValue('A'),amount:numberValue(10)});
  await seed('projects/ksk/contracts/contract1',{person:stringValue('A'),agreedAmount:numberValue(50)});
  await seed('projects/ksk/stock/stock1',{material:stringValue('Cement'),quantity:numberValue(1)});
  await seed('projects/ksk/progress/progress1',{stage:stringValue('Foundation'),percent:numberValue(50)});
  await seed('projects/ksk/diary/diary1',{title:stringValue('Site note')});
  await seed('projects/ksk/reminders/reminder1',{title:stringValue('Inspection')});
  await seed('projects/ksk/login_history/owner-session',{userId:stringValue('owner'),role:stringValue('owner'),email:stringValue('owner@example.test'),displayName:stringValue('Owner'),installationId:stringValue('ksk-test-owner'),deviceModel:stringValue('Test device'),deviceManufacturer:stringValue('Test'),deviceName:stringValue('Owner phone'),platform:stringValue('android'),status:stringValue('active'),loginAt:{timestampValue:new Date().toISOString()},lastActiveAt:{timestampValue:new Date().toISOString()}});
  await seed('projects/ksk/login_history/viewer-session',{userId:stringValue('viewer'),role:stringValue('viewer'),email:stringValue('viewer@example.test'),displayName:stringValue('Viewer'),installationId:stringValue('ksk-test-viewer'),deviceModel:stringValue('Test device'),deviceManufacturer:stringValue('Test'),deviceName:stringValue('Viewer phone'),platform:stringValue('android'),status:stringValue('active'),loginAt:{timestampValue:new Date().toISOString()},lastActiveAt:{timestampValue:new Date().toISOString()}});
  await seed('projects/ksk/approvals/approval1',{status:stringValue('pending')});
  await seed('projects/ksk/activity/activity1',{title:stringValue('Owner activity')});
  await seed('projects/ksk/bills/payment1/images/receipt1',{recordId:stringValue('payment1'),imageBase64:stringValue('YWJj'),fileName:stringValue('receipt.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner'),createdAt:{timestampValue:new Date().toISOString()}});
  await seed('projects/ksk/attachments/diary1/images/photo1',{recordId:stringValue('diary1'),imageBase64:stringValue('YWJj'),fileName:stringValue('site.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner'),createdAt:{timestampValue:new Date().toISOString()}});

  assert.equal((await request('projects/ksk/sheets/sheet1','owner')).status,200);
  assert.equal((await request('projects/ksk/sheets/project_dashboard','viewer')).status,200);
  assert.equal((await request('projects/ksk/sheets/sheet1','viewer')).status,403);
  assert.equal((await request('projects/ksk/bills/payment1/images/receipt1','viewer')).status,200);
  assert.equal((await request('projects/ksk/attachments/diary1/images/photo1','viewer')).status,403);
  assert.equal((await request('projects/ksk/payments/payment1','viewer')).status,200);
  assert.equal((await request('projects/ksk/login_history/viewer-session','viewer')).status,200,'A legacy viewer may read only their own session history.');
  assert.equal((await request('projects/ksk/login_history/viewer-session','viewer','DELETE')).status,403,'Viewers cannot clear device history.');
  assert.equal((await request('projects/ksk/login_history/viewer-session','owner','DELETE')).status,200,'The owner can clear a selected device history record.');
  assert.equal((await request('projects/ksk/login_history/viewer-session','owner')).status,404,'Selected device history remains cleared after refresh.');
  assert.equal((await request('projects/ksk/activity/activity1','viewer')).status,403);
  assert.equal((await request('projects/ksk/login_history/owner-session','viewer')).status,403);
  assert.equal((await request('projects/ksk/login_history/owner-session','owner')).status,200);
  assert.equal((await request('users/viewer/devices/device-token','viewer')).status,200,'A legacy viewer may read only their own device registration.');
  assert.equal((await request('users/viewer/devices/device-token','owner')).status,200,'The owner can review device registrations for account cleanup.');
  assert.equal((await request('users/viewer/devices/device-token','different-user')).status,403,'Other viewers cannot read a member device registration.');
  for(const uid of ['owner','viewer']) {
    const listed=await fetch(`${root}/projects/ksk:runQuery`,{method:'POST',headers:{Authorization:`Bearer ${token(uid)}`,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:'payments'}],limit:10}})});
    assert.equal(listed.status,200,await listed.text());
  }
  assert.equal((await request('projects/ksk/contracts/contract1','viewer')).status,200);
  for (const path of ['projects/ksk/stock/stock1','projects/ksk/progress/progress1']) assert.equal((await request(path,'viewer')).status,200);
  assert.equal((await request('projects/ksk/diary/diary1','viewer')).status,403);
  assert.equal((await request('projects/ksk/approvals/approval1','viewer')).status,403);
  assert.equal((await request('projects/ksk/reminders/reminder1','viewer')).status,403);
  for (const path of ['projects/ksk/contracts/contract1','projects/ksk/stock/stock1','projects/ksk/progress/progress1','projects/ksk/diary/diary1','projects/ksk/approvals/approval1','projects/ksk/reminders/reminder1']) {
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

  const createViewer=async(uid,phone,preferredLanguage='en',provider='password')=>{
    const access=`projects/${project}/databases/(default)/documents/viewerAccess/${uid}`;
    const phoneIndex=`projects/${project}/databases/(default)/documents/viewerPhoneIndex/${phone}`;
    const phoneStatus=`projects/${project}/databases/(default)/documents/viewerPhoneStatus/${phone}`;
    const history=`projects/${project}/databases/(default)/documents/viewerAccessHistory/registered-${uid}`;
    return commit(uid,[
      {update:{name:access,fields:{uid:stringValue(uid),fullName:stringValue('Family Viewer'),normalizedMobileNumber:stringValue(phone),status:stringValue('pending'),preferredLanguage:stringValue(preferredLanguage)}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'registeredAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]},
      {update:{name:phoneIndex,fields:{uid:stringValue(uid),status:stringValue('pending')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
      {update:{name:phoneStatus,fields:{status:stringValue('pending')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
      {update:{name:history,fields:{uid:stringValue(uid),fullName:stringValue('Family Viewer'),normalizedMobileNumber:stringValue(phone),action:stringValue('registered'),status:stringValue('pending'),actorUid:stringValue(uid)}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}
    ],undefined,provider);
  };
  const decideViewer=async(uid,phone,status)=>{
    const access=`projects/${project}/databases/(default)/documents/viewerAccess/${uid}`;
    const phoneIndex=`projects/${project}/databases/(default)/documents/viewerPhoneIndex/${phone}`;
    const phoneStatus=`projects/${project}/databases/(default)/documents/viewerPhoneStatus/${phone}`;
    const accessFields={status:stringValue(status),decidedBy:stringValue('owner'),decisionNote:stringValue('Owner decision')};
    const accessTransforms=[{fieldPath:'decisionAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}];
    if(status==='approved'){
      accessFields.approverUid=stringValue('owner');
      accessTransforms.push({fieldPath:'approvalDate',setToServerValue:'REQUEST_TIME'});
    }
    if(status==='revoked'){
      accessFields.revokedBy=stringValue('owner');
      accessTransforms.push({fieldPath:'revokedAt',setToServerValue:'REQUEST_TIME'});
    }
    return commit('owner',[
      {update:{name:access,fields:accessFields},updateMask:{fieldPaths:Object.keys(accessFields)},updateTransforms:accessTransforms},
      {update:{name:phoneIndex,fields:{uid:stringValue(uid),status:stringValue(status)}},updateMask:{fieldPaths:['uid','status']},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
      {update:{name:phoneStatus,fields:{status:stringValue(status)}},updateMask:{fieldPaths:['status']},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}
    ]);
  };
  const phone='+15551234567';
  const pendingRequest=await createViewer('password-viewer',phone,'ta');
  assert.equal(pendingRequest.status,200,await pendingRequest.text());
  const duplicateRequest=await createViewer('duplicate-viewer',phone,'en');
  assert.equal(duplicateRequest.status,403,'A second UID cannot create another request for an already indexed mobile number.');
  assert.equal((await request('viewerAccess/duplicate-viewer','duplicate-viewer','GET',undefined,undefined,'password')).status,404,'The rejected duplicate write creates no registration.');
  const clearPendingPhone='+15550004320';
  assert.equal((await createViewer('clear-pending-viewer',clearPendingPhone)).status,200,'A pending registration can be created for history-clear validation.');
  assert.equal((await request('viewerAccess/clear-pending-viewer','clear-pending-viewer','DELETE',undefined,undefined,'password')).status,403,'A registrant cannot delete their own request history.');
  assert.equal((await request('viewerAccessHistory/registered-clear-pending-viewer','clear-pending-viewer','GET',undefined,undefined,'password')).status,403,'Registrants cannot read or enumerate owner history.');
  assert.equal((await request('viewerAccessHistory/registered-clear-pending-viewer','clear-pending-viewer','DELETE',undefined,undefined,'password')).status,403,'Registrants cannot clear owner history.');
  const clearPending=await commit('owner',[
    {delete:`projects/${project}/databases/(default)/documents/viewerAccess/clear-pending-viewer`},
    {delete:`projects/${project}/databases/(default)/documents/viewerPhoneIndex/${clearPendingPhone}`},
    {delete:`projects/${project}/databases/(default)/documents/viewerPhoneStatus/${clearPendingPhone}`},
    {delete:`projects/${project}/databases/(default)/documents/viewerAccessHistory/registered-clear-pending-viewer`}
  ]);
  assert.equal(clearPending.status,200,await clearPending.text(),'The owner can clear a pending request and its non-approved phone indexes.');
  for(const path of ['viewerAccess/clear-pending-viewer',`viewerPhoneIndex/${clearPendingPhone}`,`viewerPhoneStatus/${clearPendingPhone}`,'viewerAccessHistory/registered-clear-pending-viewer']){
    assert.equal((await request(path,'owner')).status,404,`${path} stays cleared after reloading.`);
  }
  const simultaneousPhone='+15550004321';
  const simultaneousRegistrations=await Promise.all([
    createViewer('simultaneous-rule-a',simultaneousPhone),
    createViewer('simultaneous-rule-b',simultaneousPhone)
  ]);
  assert.equal(simultaneousRegistrations.filter(result=>result.status===200).length,1,'Atomic phone indexes allow only one simultaneous registration.');
  assert.equal((await request('viewerAccess/password-viewer','password-viewer','GET',undefined,undefined,'password')).status,200,'A registrant may see their own pending request.');
  assert.equal((await request('projects/ksk/sheets/sheet1','password-viewer','GET',undefined,undefined,'password')).status,403,'Pending registrants cannot read project records.');
  assert.equal((await request('projects/ksk/bills/payment1/images/receipt1','password-viewer','GET',undefined,undefined,'password')).status,403,'Pending registrants cannot read attachments.');
  const selfApproval=await commit('password-viewer',[{update:{name:`projects/${project}/databases/(default)/documents/viewerAccess/password-viewer`,fields:{status:stringValue('approved')}},updateMask:{fieldPaths:['status']}}],undefined,'password');
  assert.equal(selfApproval.status,403,'Viewers cannot change their own approval status.');
  const typedNumberOnly=await request('projects/ksk/sheets/sheet1','different-user','GET',undefined,phone,'password');
  assert.equal(typedNumberOnly.status,403,'Typing an approved mobile number does not authenticate the approved account.');
  const unsupportedProvider=await commit('custom-viewer',[{update:{name:`projects/${project}/databases/(default)/documents/viewerAccess/custom-viewer`,fields:{uid:stringValue('custom-viewer'),fullName:stringValue('Custom Viewer'),normalizedMobileNumber:stringValue('+15550000000'),status:stringValue('pending'),preferredLanguage:stringValue('en')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'registeredAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(unsupportedProvider.status,403,'Viewer registration rejects unsupported authentication providers.');

  const invitePhone='+15550004322';
  const inviteUid='manual-rule-invite';
  const invitePath=`projects/${project}/databases/(default)/documents/viewerAccess/${inviteUid}`;
  const ownerInvite=await commit('owner',[
    {update:{name:invitePath,fields:{
      uid:stringValue(inviteUid),fullName:stringValue('Manual Invite'),
      normalizedMobileNumber:stringValue(invitePhone),status:stringValue('approved'),
      preferredLanguage:stringValue('en'),manualInvite:{booleanValue:true},
      approverUid:stringValue('owner')
    }},currentDocument:{exists:false},updateTransforms:[
      {fieldPath:'registeredAt',setToServerValue:'REQUEST_TIME'},
      {fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},
      {fieldPath:'approvalDate',setToServerValue:'REQUEST_TIME'}
    ]},
    {update:{name:`projects/${project}/databases/(default)/documents/viewerPhoneIndex/${invitePhone}`,fields:{uid:stringValue(inviteUid),status:stringValue('approved')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:`projects/${project}/databases/(default)/documents/viewerPhoneStatus/${invitePhone}`,fields:{status:stringValue('approved')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:`projects/${project}/databases/(default)/documents/viewerAccessHistory/manual-${inviteUid}`,fields:{
      uid:stringValue(inviteUid),fullName:stringValue('Manual Invite'),
      normalizedMobileNumber:stringValue(invitePhone),action:stringValue('approved'),
      status:stringValue('approved'),actorUid:stringValue('owner')
    }},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}
  ]);
  assert.equal(ownerInvite.status,200,await ownerInvite.text(),'The owner may create an approved invitation and its private phone indexes.');
  assert.equal((await request('projects/ksk/sheets/sheet1','unverified-invite-user','GET',undefined,invitePhone,'password')).status,403,'An approved phone invitation does not grant access to a session that only typed its number.');
  assert.equal((await request(`viewerAccess/${inviteUid}`,'unverified-invite-user')).status,403,'Other users cannot read an approved invitation profile.');
  assert.equal((await request(`viewerPhoneIndex/${invitePhone}`,'unverified-invite-user')).status,403,'Other users cannot read an approved invitation phone index.');
  assert.equal((await request(`viewerPhoneStatus/${invitePhone}`,'unverified-invite-user')).status,403,'Other users cannot read an approved invitation phone status.');
  const viewerInviteAttempt=await commit('unverified-invite-user',[{update:{name:`projects/${project}/databases/(default)/documents/viewerAccess/manual-forged-invite`,fields:{
    uid:stringValue('manual-forged-invite'),fullName:stringValue('Forged Invite'),
    normalizedMobileNumber:stringValue('+15550004323'),status:stringValue('approved'),
    preferredLanguage:stringValue('en'),manualInvite:{booleanValue:true},
    approverUid:stringValue('unverified-invite-user')
  }},currentDocument:{exists:false},updateTransforms:[
    {fieldPath:'registeredAt',setToServerValue:'REQUEST_TIME'},
    {fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},
    {fieldPath:'approvalDate',setToServerValue:'REQUEST_TIME'}
  ]}],undefined,'password');
  assert.equal(viewerInviteAttempt.status,403,'Only the authenticated owner may create approved invitations.');

  const approved=await decideViewer('password-viewer',phone,'approved');
  assert.equal(approved.status,200,await approved.text());
  const approvedRequest=await request('viewerAccess/password-viewer','password-viewer','GET',undefined,undefined,'password');
  const approvalSeconds=Math.floor(Date.parse((await approvedRequest.json()).fields.approvalDate.timestampValue)/1000);
  assert.ok(approvalSeconds>0,'Owner approval is recorded against the authenticated viewer UID.');
  const viewerSessionPath=`projects/${project}/databases/(default)/documents/projects/ksk/login_history/password-viewer-session`;
  const createViewerSession=await commit('password-viewer',[{update:{name:viewerSessionPath,fields:{
    userId:stringValue('password-viewer'),email:stringValue(''),displayName:stringValue('Family Viewer'),
    role:stringValue('viewer'),installationId:stringValue('installation-one'),
    deviceModel:stringValue('Unknown model'),deviceManufacturer:stringValue('Unknown manufacturer'),
    deviceName:stringValue('Unnamed device'),platform:stringValue('web'),status:stringValue('active')
  }},currentDocument:{exists:false},updateTransforms:[{fieldPath:'loginAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'lastActiveAt',setToServerValue:'REQUEST_TIME'}]}],undefined,'password');
  assert.equal(createViewerSession.status,200,await createViewerSession.text(),'Approved viewers can create their own session record.');
  assert.equal((await request('projects/ksk/login_history/password-viewer-session','password-viewer','GET',undefined,undefined,'password')).status,200,'Viewers can read only their own session records.');
  assert.equal((await request('projects/ksk/login_history/password-viewer-session','different-user','GET',undefined,undefined,'password')).status,403,'Other viewers cannot read a member session.');
  const viewerSessionTouch=await commit('password-viewer',[{update:{name:viewerSessionPath,fields:{}},updateMask:{fieldPaths:['lastActiveAt']},updateTransforms:[{fieldPath:'lastActiveAt',setToServerValue:'REQUEST_TIME'}]}],undefined,'password');
  assert.equal(viewerSessionTouch.status,200,await viewerSessionTouch.text(),'A viewer can update only their own last-active timestamp.');
  const viewerSessionRevoke=await commit('password-viewer',[{update:{name:viewerSessionPath,fields:{status:stringValue('revoked'),revokedBy:stringValue('password-viewer')}},updateMask:{fieldPaths:['status','revokedBy']},updateTransforms:[{fieldPath:'revokedAt',setToServerValue:'REQUEST_TIME'}]}],undefined,'password');
  assert.equal(viewerSessionRevoke.status,403,'Viewers cannot revoke session records.');
  assert.equal((await request('projects/ksk/login_history/password-viewer-session','password-viewer','DELETE',undefined,undefined,'password')).status,403,'Viewers cannot delete session records.');
  const ownerSessionRevoke=await commit('owner',[{update:{name:viewerSessionPath,fields:{status:stringValue('revoked'),revokedBy:stringValue('owner')}},updateMask:{fieldPaths:['status','revokedBy']},updateTransforms:[{fieldPath:'revokedAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(ownerSessionRevoke.status,200,await ownerSessionRevoke.text(),'The owner can revoke a member session.');
  assert.equal((await request('projects/ksk/login_history/password-viewer-session','password-viewer','GET',undefined,undefined,'password')).status,200,'A revoked session remains available to its authenticated owner for history.');
  assert.equal((await request('viewerAccessHistory/registered-password-viewer','password-viewer','GET',undefined,undefined,'password')).status,403,'Viewers cannot read registration or approval history.');
  assert.equal((await request('viewerAccessHistory/registered-password-viewer','owner')).status,200,'The owner can read access history.');
  assert.equal((await request(`viewerPhoneStatus/${phone}`,'password-viewer','GET',undefined,undefined,'password')).status,200,'A member can read only their own indexed phone status.');
  const approvedHistoryDelete=await commit('owner',[
    {delete:`projects/${project}/databases/(default)/documents/viewerAccess/password-viewer`},
    {delete:`projects/${project}/databases/(default)/documents/viewerPhoneIndex/${phone}`},
    {delete:`projects/${project}/databases/(default)/documents/viewerPhoneStatus/${phone}`}
  ]);
  assert.equal(approvedHistoryDelete.status,403,'The owner cannot clear an approved member record or its approval indexes.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','password-viewer','GET',undefined,undefined,'password')).status,200,'A rejected history deletion leaves approved member access active.');
  const persistentAuthTime=0;
  await seed('projects/ksk/contracts/contract1',{person:stringValue('Approved viewer test'),agreedAmount:numberValue(100)});
  await seed('projects/ksk/stock/stock1',{material:stringValue('Approved viewer test'),quantity:numberValue(1)});
  await seed('projects/ksk/progress/progress1',{stage:stringValue('Approved viewer test'),percent:numberValue(25)});
  await seed('projects/ksk/diary/diary1',{title:stringValue('Approved viewer test')});
  await seed('projects/ksk/reminders/reminder1',{title:stringValue('Owner only')});
  await seed('projects/ksk/payments/phone-viewer-target',{person:stringValue('Protected')});
  assert.equal((await request('projects/ksk/sheets/daily_expenses','password-viewer','GET',undefined,undefined,'password',persistentAuthTime)).status,200,'Owner approval activates the existing authenticated persistent session.');
  assert.equal((await request('projects/ksk/sheets/project_dashboard','password-viewer','GET',undefined,undefined,'password',persistentAuthTime)).status,200,'Approved viewers can read the dashboard workbook data.');
  assert.equal((await request('projects/ksk/sheets/quotation_compare','password-viewer','GET',undefined,undefined,'password',persistentAuthTime)).status,403,'Family viewers cannot read owner-only quotation data.');
  assert.equal((await request('projects/ksk/bills/payment1/images/receipt1','password-viewer','GET',undefined,undefined,'password')).status,200,'Approved viewers can read authorized receipts.');
  for(const path of ['projects/ksk/payments/phone-viewer-target','projects/ksk/contracts/contract1','projects/ksk/stock/stock1','projects/ksk/progress/progress1']){
    assert.equal((await request(path,'password-viewer','GET',undefined,undefined,'password')).status,200,`Approved viewers can read ${path}.`);
  }
  assert.equal((await request('projects/ksk/diary/diary1','password-viewer','GET',undefined,undefined,'password')).status,403,'Family viewers cannot read site diary records.');
  assert.equal((await request('projects/ksk/attachments/diary1/images/photo1','password-viewer','GET',undefined,undefined,'password')).status,403,'Family viewers cannot read diary photos.');
  assert.equal((await request('projects/ksk/login_history/viewer-session','password-viewer','GET',undefined,undefined,'password')).status,403,'Viewers cannot read another UID login history.');
  assert.equal((await request('projects/ksk/activity/activity1','password-viewer','GET',undefined,undefined,'password')).status,403,'Family viewers cannot read owner activity.');
  const permittedSheetIds=['project_dashboard','project_setup','materials_ground','materials_first','materials_boq','labour_work','professional_fees','misc_equipment','daily_expenses','work_schedule','floor_summary'];
  const permittedSheetQuery=await fetch(`${root}/projects/ksk:runQuery`,{
    method:'POST',
    headers:{Authorization:`Bearer ${token('password-viewer',undefined,'password',persistentAuthTime)}`,'Content-Type':'application/json'},
    body:JSON.stringify({structuredQuery:{
      from:[{collectionId:'sheets'}],
      where:{fieldFilter:{field:{fieldPath:'__name__'},op:'IN',value:{arrayValue:{values:permittedSheetIds.map(id=>({referenceValue:`projects/${project}/databases/(default)/documents/projects/ksk/sheets/${id}`}))}}}}
    }})
  });
  assert.equal(permittedSheetQuery.status,200,await permittedSheetQuery.text(),'The restricted family sheet subscription can read its explicit allowlist.');
  const forbiddenSheetQuery=await fetch(`${root}/projects/ksk:runQuery`,{
    method:'POST',
    headers:{Authorization:`Bearer ${token('password-viewer',undefined,'password',persistentAuthTime)}`,'Content-Type':'application/json'},
    body:JSON.stringify({structuredQuery:{
      from:[{collectionId:'sheets'}],
      where:{fieldFilter:{field:{fieldPath:'__name__'},op:'IN',value:{arrayValue:{values:[{referenceValue:`projects/${project}/databases/(default)/documents/projects/ksk/sheets/quotation_compare`}]}}}}
    }})
  });
  assert.equal(forbiddenSheetQuery.status,403,'The family viewer cannot query owner-only workbook sheets.');
  const savedLanguage=await request('viewerAccess/password-viewer','password-viewer','GET',undefined,undefined,'password');
  assert.equal((await savedLanguage.json()).fields.preferredLanguage.stringValue,'ta','The selected language persists on the access request.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','password-viewer','GET',undefined,phone,'password',persistentAuthTime)).status,200,'A returning password login for the same UID does not require approval again.');
  assert.equal((await request('viewerAccess/password-viewer','password-viewer','PATCH',{fields:{preferredLanguage:stringValue('en'),updatedAt:{timestampValue:new Date().toISOString()}}},undefined,'password')).status,403,'Client profile edits cannot forge a server timestamp.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','password-viewer','PATCH',{fields:{updatedBy:stringValue('password-viewer')}},undefined,'password')).status,403,'Approved viewers cannot update project sheets.');
  assert.equal((await request('projects/ksk/bills/payment1/images/receipt1','password-viewer','DELETE',undefined,undefined,'password')).status,403,'Approved viewers cannot delete bill attachments.');
  for(const path of ['projects/ksk/payments/phone-viewer-target','projects/ksk/contracts/contract1','projects/ksk/stock/stock1','projects/ksk/progress/progress1','projects/ksk/diary/diary1','projects/ksk/sheets/daily_expenses']){
    assert.equal((await request(path,'password-viewer','PATCH',{fields:{unauthorized:stringValue('change')}},undefined,'password')).status,403,`Approved viewers cannot update ${path}.`);
    assert.equal((await request(path,'password-viewer','DELETE',undefined,undefined,'password')).status,403,`Approved viewers cannot delete ${path}.`);
  }
  assert.equal((await request('projects/other/payments/payment1','password-viewer','GET',undefined,undefined,'password')).status,403,'Family viewers cannot read another project.');
  assert.equal((await request('projects/ksk/approvals/approval1','password-viewer','GET',undefined,undefined,'password')).status,403,'Family viewers cannot read owner approval records.');
  assert.equal((await request('projects/ksk/reminders/reminder1','password-viewer','GET',undefined,undefined,'password')).status,403,'Family viewers cannot read owner-only reminders.');
  assert.equal((await request('users/password-viewer','password-viewer','PATCH',{fields:{role:stringValue('owner'),projectId:stringValue('ksk')}},undefined,'password')).status,403,'Family viewers cannot create or change role documents.');
  assert.equal((await request(`viewerPhoneIndex/+15550000000`,'different-user','GET',undefined,undefined,'password')).status,403,'Viewers cannot read another member private phone index.');
  const phoneStatusLookup=await request(`viewerPhoneStatus/${phone}`,'different-user','GET',undefined,undefined,'password');
  assert.equal(phoneStatusLookup.status,403,'Phone status is private; unauthenticated phone-number enumeration is denied.');
  const viewerUpload=await request('projects/ksk/bills/payment1/images?documentId=viewer-upload','password-viewer','POST',{fields:{recordId:stringValue('payment1'),imageBase64:stringValue('YWJj'),fileName:stringValue('receipt.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner'),createdAt:{timestampValue:new Date().toISOString()}}},undefined,'password');
  assert.equal(viewerUpload.status,403,'Approved viewers cannot upload attachments.');
  const viewerRequestList=await fetch(`${root}:runQuery`,{method:'POST',headers:{Authorization:`Bearer ${token('password-viewer',undefined,'password')}`,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:'viewerAccess'}]}})});
  assert.equal(viewerRequestList.status,403,'Viewers cannot list the owner access-management records.');
  const languageUpdate=await commit('password-viewer',[{update:{name:`projects/${project}/databases/(default)/documents/viewerAccess/password-viewer`,fields:{preferredLanguage:stringValue('en')}},updateMask:{fieldPaths:['preferredLanguage']},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}],undefined,'password');
  assert.equal(languageUpdate.status,200,await languageUpdate.text(),'A viewer may change only their language preference.');
  const changedLanguage=await request('viewerAccess/password-viewer','password-viewer','GET',undefined,undefined,'password');
  assert.equal((await changedLanguage.json()).fields.preferredLanguage.stringValue,'en','A changed language preference remains saved.');
  assert.equal((await fetch(`${root}:runQuery`,{method:'POST',headers:{Authorization:`Bearer ${token('password-viewer',undefined,'password')}`,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:'users'}],where:{fieldFilter:{field:{fieldPath:'projectId'},op:'EQUAL',value:stringValue('ksk')}}}})})).status,403,'Viewers cannot list membership or owner information.');

  const recoveryPhone='+15550004567';
  assert.equal((await createViewer('recovery-old',recoveryPhone,'ta','anonymous')).status,200,'A new family member can create one pending registration.');
  assert.equal((await decideViewer('recovery-old',recoveryPhone,'approved')).status,200,'Owner approval updates both private identity and status indexes.');
  const recoveryCreate=await commit('recovery-new',[{update:{name:`projects/${project}/databases/(default)/documents/viewerRecoveryRequests/recovery-new`,fields:{uid:stringValue('recovery-new'),normalizedMobileNumber:stringValue(recoveryPhone),status:stringValue('pending')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}],undefined,'password');
  assert.equal(recoveryCreate.status,200,await recoveryCreate.text(),'A new session can request recovery but receives no project access.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','recovery-new','GET',undefined,undefined,'password')).status,403);
  const oldRecoveryAccess=await (await request('viewerAccess/recovery-old','owner')).json();
  const recoveryPath=`projects/${project}/databases/(default)/documents/viewerRecoveryRequests/recovery-new`;
  const recoveryIndexPath=`projects/${project}/databases/(default)/documents/viewerPhoneIndex/${recoveryPhone}`;
  const recoveryStatusPath=`projects/${project}/databases/(default)/documents/viewerPhoneStatus/${recoveryPhone}`;
  const oldAccessPath=`projects/${project}/databases/(default)/documents/viewerAccess/recovery-old`;
  const newAccessPath=`projects/${project}/databases/(default)/documents/viewerAccess/recovery-new`;
  const transfer=await commit('owner',[
    {update:{name:oldAccessPath,fields:{status:stringValue('revoked'),decidedBy:stringValue('owner'),decisionNote:stringValue('Owner verified session recovery.'),revokedBy:stringValue('owner')}},updateMask:{fieldPaths:['status','decidedBy','decisionNote','revokedBy','decisionAt','revokedAt','updatedAt']},updateTransforms:[{fieldPath:'decisionAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'revokedAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:newAccessPath,fields:{uid:stringValue('recovery-new'),fullName:oldRecoveryAccess.fields.fullName,normalizedMobileNumber:stringValue(recoveryPhone),status:stringValue('approved'),preferredLanguage:oldRecoveryAccess.fields.preferredLanguage,approvalDate:oldRecoveryAccess.fields.approvalDate,approverUid:oldRecoveryAccess.fields.approverUid}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'registeredAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:recoveryIndexPath,fields:{uid:stringValue('recovery-new'),status:stringValue('approved')}},updateMask:{fieldPaths:['uid','status']},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:recoveryStatusPath,fields:{status:stringValue('approved')}},updateMask:{fieldPaths:['status']},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:recoveryPath,fields:{status:stringValue('restored'),decidedBy:stringValue('owner')}},updateMask:{fieldPaths:['status','decidedBy','decisionAt','updatedAt']},updateTransforms:[{fieldPath:'decisionAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}
  ]);
  assert.equal(transfer.status,200,await transfer.text(),'Only the owner can atomically transfer the existing approval.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','recovery-new','GET',undefined,undefined,'password')).status,200,'The verified replacement session receives the existing approved access.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','recovery-old','GET',undefined,undefined,'anonymous')).status,403,'The previous session loses access in the same transfer.');
  assert.equal((await request('viewerRecoveryRequests/recovery-new','recovery-new','DELETE',undefined,undefined,'password')).status,403,'A family member cannot delete recovery history.');
  assert.equal((await request('viewerRecoveryRequests/recovery-new','owner','DELETE')).status,200,'The owner can clear processed recovery history.');
  assert.equal((await request('viewerRecoveryRequests/recovery-new','owner')).status,404,'Processed recovery history stays cleared after reload.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','recovery-new','GET',undefined,undefined,'password')).status,200,'Clearing recovery history does not remove the replacement member access.');

  const revoked=await decideViewer('password-viewer',phone,'revoked');
  assert.equal(revoked.status,200,await revoked.text());
  assert.equal((await request('projects/ksk/sheets/daily_expenses','password-viewer','GET',undefined,undefined,'password')).status,403,'Revocation immediately blocks future project reads.');
  assert.equal((await request('projects/ksk/bills/payment1/images/receipt1','password-viewer','GET',undefined,undefined,'password')).status,403,'Revocation immediately blocks future attachment reads.');
  const accountDeletionEvent=`projects/${project}/databases/(default)/documents/viewerAccessHistory/account-deleted-password-viewer`;
  const deleteApprovedAccount=await commit('owner',[
    {update:{name:`projects/${project}/databases/(default)/documents/viewerAccountDeletions/password-viewer`,fields:{uid:stringValue('password-viewer'),actorUid:stringValue('owner')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]},
    {delete:`projects/${project}/databases/(default)/documents/viewerAccess/password-viewer`},
    {delete:`projects/${project}/databases/(default)/documents/viewerPhoneIndex/${phone}`},
    {delete:`projects/${project}/databases/(default)/documents/viewerPhoneStatus/${phone}`},
    {delete:viewerSessionPath},
    {update:{name:accountDeletionEvent,fields:{uid:stringValue('password-viewer'),fullName:stringValue('Family Viewer'),normalizedMobileNumber:stringValue(phone),action:stringValue('account_deleted'),status:stringValue('deleted'),previousStatus:stringValue('revoked'),actorUid:stringValue('owner')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}
  ]);
  assert.equal(deleteApprovedAccount.status,200,await deleteApprovedAccount.text(),'The owner can delete a viewer profile and access records without deleting the Auth identity.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','password-viewer','GET',undefined,undefined,'password')).status,403,'The still-authenticated deleted UID cannot read project data.');
  assert.equal((await request('viewerAccountDeletions/password-viewer','password-viewer','GET',undefined,undefined,'password')).status,403,'The account deletion tombstone remains private to the owner.');

  const rejectedPhone='+15551234568';
  const rejectedRequest=await createViewer('rejected-viewer',rejectedPhone);
  assert.equal(rejectedRequest.status,200,await rejectedRequest.text());
  const rejected=await decideViewer('rejected-viewer',rejectedPhone,'rejected');
  assert.equal(rejected.status,200,await rejected.text());
  assert.equal((await request('projects/ksk/sheets/sheet1','rejected-viewer')).status,403,'Rejected registrations cannot read project data.');
  assert.equal((await request('viewerAccess/rejected-viewer','rejected-viewer','DELETE',undefined,undefined,'password')).status,403,'Rejected registrants cannot delete their history.');
  const clearRejected=await commit('owner',[
    {delete:`projects/${project}/databases/(default)/documents/viewerAccess/rejected-viewer`},
    {delete:`projects/${project}/databases/(default)/documents/viewerPhoneIndex/${rejectedPhone}`},
    {delete:`projects/${project}/databases/(default)/documents/viewerPhoneStatus/${rejectedPhone}`}
  ]);
  assert.equal(clearRejected.status,200,await clearRejected.text(),'The owner can clear rejected request history.');
  assert.equal((await request('viewerAccess/rejected-viewer','owner')).status,404,'Rejected request history does not reappear after reload.');

  const anonymousPhone='+15550001234';
  const anonymousRequest=await createViewer('anonymous-viewer',anonymousPhone,'ta','anonymous');
  assert.equal(anonymousRequest.status,200,await anonymousRequest.text(),'A Firebase anonymous session can submit a UID-bound request.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','anonymous-viewer','GET',undefined,undefined,'anonymous')).status,403,'An anonymous pending request has no project access.');
  const anonymousApproval=await decideViewer('anonymous-viewer',anonymousPhone,'approved');
  assert.equal(anonymousApproval.status,200,await anonymousApproval.text());
  assert.equal((await request('projects/ksk/sheets/daily_expenses','anonymous-viewer','GET',undefined,undefined,'anonymous',0)).status,200,'Approval activates the same persistent anonymous UID without SMS or a second registration.');
  assert.equal((await request('projects/ksk/bills/payment1/images/receipt1','anonymous-viewer','GET',undefined,undefined,'anonymous',0)).status,200,'Approved anonymous sessions can read authorized receipts.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','anonymous-viewer','PATCH',{fields:{updatedBy:stringValue('anonymous-viewer')}},undefined,'anonymous',0)).status,403,'Approved anonymous family sessions remain read-only.');
  const anonymousRevocation=await decideViewer('anonymous-viewer',anonymousPhone,'revoked');
  assert.equal(anonymousRevocation.status,200,await anonymousRevocation.text());
  assert.equal((await request('projects/ksk/sheets/daily_expenses','anonymous-viewer','GET',undefined,undefined,'anonymous',0)).status,403,'Revocation blocks the previously authenticated persistent session immediately.');

  const ownerViewerList=await fetch(`${root}:runQuery`,{
    method:'POST',
    headers:{Authorization:`Bearer ${token('owner')}`,'Content-Type':'application/json'},
    body:JSON.stringify({structuredQuery:{
      from:[{collectionId:'users'}],
      where:{compositeFilter:{op:'AND',filters:[
        {fieldFilter:{field:{fieldPath:'projectId'},op:'EQUAL',value:stringValue('ksk')}},
        {fieldFilter:{field:{fieldPath:'role'},op:'EQUAL',value:stringValue('viewer')}}
      ]}}
    }})
  });
  assert.equal(ownerViewerList.status,200,'Only the owner can list KSK viewer memberships for legacy access management.');
  const legacyLanguage=await commit('viewer',[{update:{name:`projects/${project}/databases/(default)/documents/users/viewer`,fields:{preferredLanguage:stringValue('ta')}},updateMask:{fieldPaths:['preferredLanguage']},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(legacyLanguage.status,200,await legacyLanguage.text(),'Legacy viewers can persist language without changing their role.');
  const legacyRoleChange=await commit('viewer',[{update:{name:`projects/${project}/databases/(default)/documents/users/viewer`,fields:{role:stringValue('owner')}},updateMask:{fieldPaths:['role']}}]);
  assert.equal(legacyRoleChange.status,403,'Viewer profile updates cannot modify role or project membership.');
  const ownerRevokesLegacy=await commit('owner',[{update:{name:`projects/${project}/databases/(default)/documents/viewerAccess/viewer`,fields:{uid:stringValue('viewer'),fullName:stringValue('Existing viewer'),normalizedMobileNumber:stringValue(''),status:stringValue('revoked'),preferredLanguage:stringValue('en'),legacy:{booleanValue:true},revokedBy:stringValue('owner'),decidedBy:stringValue('owner'),decisionNote:stringValue('Legacy viewer access revoked by owner.')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'revokedAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'decisionAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(ownerRevokesLegacy.status,200,await ownerRevokesLegacy.text());
  assert.equal((await request('projects/ksk/sheets/sheet1','viewer')).status,403,'The owner can revoke a pre-existing viewer account without changing owner-managed role records.');
  const ownerCannotDeleteOwner=await commit('owner',[{update:{name:`projects/${project}/databases/(default)/documents/viewerAccountDeletions/owner`,fields:{uid:stringValue('owner'),actorUid:stringValue('owner')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(ownerCannotDeleteOwner.status,403,'An owner cannot create an account-deletion marker for themselves.');
  assert.equal((await request('users/owner','owner','DELETE')).status,403,'The owner membership profile cannot be deleted.');
  const legacyDeletionHistory=`projects/${project}/databases/(default)/documents/viewerAccessHistory/account-deleted-viewer`;
  const deleteLegacyAccount=await commit('owner',[
    {update:{name:`projects/${project}/databases/(default)/documents/viewerAccountDeletions/viewer`,fields:{uid:stringValue('viewer'),actorUid:stringValue('owner')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]},
    {delete:`projects/${project}/databases/(default)/documents/viewerAccess/viewer`},
    {delete:`projects/${project}/databases/(default)/documents/users/viewer`},
    {delete:`projects/${project}/databases/(default)/documents/users/viewer/devices/device-token`},
    {update:{name:legacyDeletionHistory,fields:{uid:stringValue('viewer'),fullName:stringValue('Existing viewer'),normalizedMobileNumber:stringValue(''),action:stringValue('account_deleted'),status:stringValue('deleted'),previousStatus:stringValue('revoked'),actorUid:stringValue('owner')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}
  ]);
  assert.equal(deleteLegacyAccount.status,200,await deleteLegacyAccount.text(),'The owner can atomically remove a viewer profile while retaining a deletion audit.');
  assert.equal((await request('users/viewer','owner')).status,404,'The eligible viewer profile is removed.');
  assert.equal((await request('users/viewer/devices/device-token','owner')).status,404,'The eligible viewer device registration is removed.');
  assert.equal((await request('viewerAccountDeletions/viewer','owner')).status,200,'The owner-only tombstone prevents the same Auth UID from registering again.');
  assert.equal((await request('projects/ksk/sheets/daily_expenses','viewer')).status,403,'The still-authenticated deleted UID has no project access.');
});
