import {collection, doc, documentId, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, startAfter, Timestamp} from 'firebase/firestore';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {db} from '../firebase';
import {COLLECTIONS, MAX_BACKUP_BYTES, ProjectBackup, utf8ByteLength, validateProjectBackup} from './projectBackupValidation';

const PROJECT_ID='ksk';
type BackupDoc={id:string;data:Record<string,any>};
type Backup=ProjectBackup;

async function readCollection(pathParts:string[]):Promise<BackupDoc[]> {
  const ref=collection(db!,pathParts.join('/'));
  const output:BackupDoc[]=[];
  let cursor:any;
  while(true){
    const page=await getDocs(query(ref,...(cursor?[orderBy(documentId()),startAfter(cursor)]:[orderBy(documentId())]),limit(400)));
    output.push(...page.docs.map(item=>({id:item.id,data:item.data()})));
    if(page.size<400)break;
    cursor=page.docs[page.docs.length-1];
  }
  return output;
}

function encode(value:any):any {
  if(value instanceof Timestamp)return {$kskTimestamp:value.toDate().toISOString()};
  if(Array.isArray(value))return value.map(encode);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)]));
  return value;
}
function decode(value:any):any {
  if(Array.isArray(value))return value.map(decode);
  if(value&&typeof value==='object'){
    if(typeof value.$kskTimestamp==='string'&&Object.keys(value).length===1)return Timestamp.fromDate(new Date(value.$kskTimestamp));
    return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,decode(item)]));
  }
  return value;
}

export async function exportProjectBackup():Promise<string>{
  if(!db||!FileSystem.cacheDirectory)throw new Error('Firebase or local file storage is unavailable.');
  const projectRoot=['projects',PROJECT_ID];
  const sheets=await readCollection([...projectRoot,'sheets']);
  const collections:Record<string,BackupDoc[]>={};
  for(const name of COLLECTIONS)collections[name]=await readCollection([...projectRoot,name]);
  const recordIds=new Set<string>();
  sheets.forEach(sheet=>(sheet.data.recordIds||[]).forEach((id:string)=>id&&recordIds.add(id)));
  collections.payments.forEach(record=>recordIds.add(record.id));
  collections.diary.forEach(record=>recordIds.add(record.id));
  const attachments:Record<string,BackupDoc[]>={};
  for(const id of recordIds){
    for(const group of ['bills','attachments']){
      const docs=await readCollection([...projectRoot,group,id,'images']);
      if(docs.length)attachments[`${group}/${id}`]=docs;
    }
  }
  const backup:Backup={format:'ksk-project-backup',schemaVersion:1,projectId:PROJECT_ID,createdAt:new Date().toISOString(),sheets,collections,attachments};
  const json=JSON.stringify(encode(backup));
  if(utf8ByteLength(json)>MAX_BACKUP_BYTES)throw new Error('Backup exceeds the 50 MiB safe export limit. Export in a smaller set after reducing attached photos.');
  const uri=`${FileSystem.cacheDirectory}KSK_Project_Backup_${new Date().toISOString().slice(0,10)}.json`;
  await FileSystem.writeAsStringAsync(uri,json,{encoding:FileSystem.EncodingType.UTF8});
  if(!(await Sharing.isAvailableAsync()))throw new Error('File sharing is unavailable on this device.');
  await Sharing.shareAsync(uri,{mimeType:'application/json',dialogTitle:'Export KSK project backup'});
  return uri;
}

export async function importProjectBackup(json:string,uid:string):Promise<{added:number;skipped:number}>{
  if(!db)throw new Error('Firebase is not configured.');
  if(!uid)throw new Error('Sign in as the project owner to restore a backup.');
  if(utf8ByteLength(json)>MAX_BACKUP_BYTES)throw new Error('Backup exceeds the 50 MiB safe import limit.');
  let backup:any;
  try{backup=JSON.parse(json);}catch{throw new Error('Backup file is not valid JSON.');}
  validateProjectBackup(backup);
  const tasks:{path:string[];id:string;data:Record<string,any>}[]=[];
  backup.sheets.forEach((item:BackupDoc)=>tasks.push({path:['projects',PROJECT_ID,'sheets'],...item}));
  for(const name of COLLECTIONS)backup.collections[name].forEach((item:BackupDoc)=>tasks.push({path:['projects',PROJECT_ID,name],...item}));
  for(const [key,docs] of Object.entries(backup.attachments) as [string,BackupDoc[]][]){const [group,parentId]=key.split('/');docs.forEach(item=>tasks.push({path:['projects',PROJECT_ID,group,parentId,'images'],...item}));}
  let added=0,skipped=0;
  for(let i=0;i<tasks.length;i+=20){
    const chunk=tasks.slice(i,i+20);
    const results=await Promise.all(chunk.map(async task=>runTransaction(db!,async transaction=>{
      const ref=doc(db!,[...task.path,task.id].join('/'));
      const existing=await transaction.get(ref);
      if(existing.exists())return false;
      const imported=decode(task.data);
      const isImage=task.path[task.path.length-1]==='images';
      if(isImage){if(imported.createdAt&&!imported.restoredCreatedAt)imported.restoredCreatedAt=imported.createdAt;imported.createdAt=serverTimestamp();}
      else if(task.path[task.path.length-1]==='sheets'){if(imported.updatedBy&&imported.updatedBy!==uid)imported.restoredUpdatedBy=imported.updatedBy;imported.updatedBy=uid;}
      else {if(imported.createdBy&&imported.createdBy!==uid)imported.restoredCreatedBy=imported.createdBy;if(imported.createdAt&&!imported.restoredCreatedAt)imported.restoredCreatedAt=imported.createdAt;imported.createdBy=uid;imported.createdAt=serverTimestamp();imported.restoredFromBackupAt=new Date().toISOString();imported.backupSchemaVersion=1;}
      transaction.set(ref,imported);
      return true;
    })));
    added+=results.filter(Boolean).length;skipped+=results.length-results.filter(Boolean).length;
  }
  return {added,skipped};
}
