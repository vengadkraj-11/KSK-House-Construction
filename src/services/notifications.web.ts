// Browser builds do not use native local notifications.
// Team website data continues to sync through Firestore listeners.
export async function enableNotifications(_uid: string): Promise<string> {
  return 'Device notifications are available in the Android app.';
}
export async function showActivityNotification(_title: string, _body: string): Promise<void> {
  return;
}
export async function scheduleLocalReminder(_title: string, _body: string, _dueDate: string, _localKey: string, _requestPermission = true): Promise<string> {
  return 'Reminder saved; local notifications are only available in the Android app.';
}
export async function cancelLocalReminder(_localKey: string): Promise<void> {
  return;
}
export async function reconcileLocalReminders(_uid: string, _records: {id:string;title?:string;notes?:string;dueDate?:string;status?:string}[]): Promise<void> {
  return;
}
