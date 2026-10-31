export type BackupDoc = {id:string;data:Record<string,any>};
export type ProjectBackup = {
  format:'ksk-project-backup';
  schemaVersion:1;
  projectId:'ksk';
  createdAt:string;
  sheets:BackupDoc[];
  collections:Record<string,BackupDoc[]>;
  attachments:Record<string,BackupDoc[]>;
};
export const COLLECTIONS:string[];
export const MAX_BACKUP_BYTES:number;
export function utf8ByteLength(value:string):number;
export function validateProjectBackup(value:any): asserts value is ProjectBackup;
