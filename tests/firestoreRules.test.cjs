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
  assert.equal((await request('projects/ksk/contracts/contract1','viewer')).status,200);
  for (const path of ['projects/ksk/stock/stock1','projects/ksk/progress/progress1','projects/ksk/diary/diary1']) assert.equal((await request(path,'viewer')).status,200);
  assert.equal((await request('projects/ksk/approvals/approval1','viewer')).status,403);
  assert.equal((await request('projects/ksk/reminders/reminder1','viewer')).status,403);
  assert.equal((await request('projects/ksk/sheets/sheet1','unknown')).status,403);

  const standalonePaymentPath=`projects/${project}/databases/(default)/documents/projects/ksk/payments/standalone-payment`;
  const standalonePayment=await commit('owner',[{update:{name:standalonePaymentPath,fields:{createdBy:stringValue('owner'),amount:numberValue(25),person:stringValue('A')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(standalonePayment.status,200,await standalonePayment.text());
  const invalidAgreementPath=standalonePaymentPath.replace('standalone-payment','invalid-agreement');
  const invalidAgreement=await commit('owner',[{update:{name:invalidAgreementPath,fields:{createdBy:stringValue('owner'),amount:numberValue(25),person:stringValue('A'),contractId:stringValue('missing-contract')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(invalidAgreement.status,403);

  const deniedPayment=await request('projects/ksk/payments?documentId=viewer-write','viewer','POST',{fields:{createdBy:stringValue('viewer'),amount:numberValue(1)}});
  assert.equal(deniedPayment.status,403);
  const deniedReceipt=await request('projects/ksk/bills/payment1/images?documentId=viewer-photo','viewer','POST',{fields:{recordId:stringValue('payment1'),imageBase64:stringValue('YWJj'),fileName:stringValue('x.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner'),createdAt:{timestampValue:new Date().toISOString()}}});
  assert.equal(deniedReceipt.status,403);
  const deniedDiaryPhoto=await request('projects/ksk/attachments/diary1/images?documentId=viewer-photo','viewer','POST',{fields:{recordId:stringValue('diary1'),imageBase64:stringValue('YWJj'),fileName:stringValue('x.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner'),createdAt:{timestampValue:new Date().toISOString()}}});
  assert.equal(deniedDiaryPhoto.status,403);
  const ownerImagePath=`projects/${project}/databases/(default)/documents/projects/ksk/attachments/diary2/images/site1`;
  const ownerPhoto=await commit('owner',[{update:{name:ownerImagePath,fields:{recordId:stringValue('diary2'),imageBase64:stringValue('YWJj'),fileName:stringValue('site.jpg'),mimeType:stringValue('image/jpeg'),createdBy:stringValue('owner')}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(ownerPhoto.status,200,await ownerPhoto.text());
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
  const deletedApproval=await request('projects/ksk/approvals/approval2','owner','DELETE');
  assert.equal(deletedApproval.status,403);
  await seed('projects/ksk/approvals/approvalLegacy',{status:stringValue('Pending')});
  const legacyPath=`projects/${project}/databases/(default)/documents/projects/ksk/approvals/approvalLegacy`;
  const legacyDecision=await commit('owner',[{update:{name:legacyPath,fields:{status:stringValue('rejected'),decidedBy:stringValue('owner'),decisionNote:stringValue('legacy checked'),history:{arrayValue:{values:[{mapValue:{fields:{status:stringValue('rejected'),note:stringValue('legacy checked'),actorUid:stringValue('owner'),decidedAt:{timestampValue:new Date().toISOString()}}}}]}}}},updateMask:{fieldPaths:['status','decidedBy','decisionNote','history','updatedAt']},updateTransforms:[{fieldPath:'decidedAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]);
  assert.equal(legacyDecision.status,200,await legacyDecision.text());
});
