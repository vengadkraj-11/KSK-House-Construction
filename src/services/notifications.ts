import {AppState, Platform} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import AsyncStorage from '@react-native-async-storage/async-storage';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

export async function enableNotifications(_uid: string): Promise<string> {
  if (!Device.isDevice) {
    return 'Use a physical Android device to enable local notifications.';
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('construction-updates', {
      name: 'Construction updates',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250]
    });
  }

  const current = await Notifications.getPermissionsAsync();
  let status = current.status;

  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }

  if (status !== 'granted') {
    return 'Notification permission was not granted on this device.';
  }

  return 'Local notifications enabled. Updates can alert you while the app is active.';
}

export async function showActivityNotification(
  title: string,
  body: string
): Promise<void> {
  // This free solution only alerts while the app is in the foreground.
  if (AppState.currentState !== 'active') return;

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default'
      },
      trigger: null
    });
  } catch (error) {
    console.warn('Could not show local activity notification:', error);
  }
}

const reminderWrites=new Map<string,Promise<any>>();
/** Schedule on this device only; no project-wide or cloud notification is sent. */
export function scheduleLocalReminder(title: string, body: string, dueDate: string, localKey: string, requestPermission = true): Promise<string> {
  const previous=reminderWrites.get(localKey)||Promise.resolve('');
  const task=previous.catch(()=> '').then(()=>scheduleLocalReminderNow(title,body,dueDate,localKey,requestPermission));
  reminderWrites.set(localKey,task);
  void task.then(()=>{if(reminderWrites.get(localKey)===task)reminderWrites.delete(localKey);},()=>{if(reminderWrites.get(localKey)===task)reminderWrites.delete(localKey);});
  return task;
}

async function scheduleLocalReminderNow(title: string, body: string, dueDate: string, localKey: string, requestPermission: boolean): Promise<string> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) return 'Reminder saved, but its date is invalid for a local notification.';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0, 0);
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    return 'Reminder saved, but its date is invalid for a local notification.';
  }
  const storageKey = `ksk-local-notification:${localKey}`;
  const saved = await AsyncStorage.getItem(storageKey);
  let oldId = saved || '';
  if(saved){try{const previous=JSON.parse(saved);oldId=previous.id||saved;if(previous.dueDate===dueDate&&previous.title===title&&previous.body===body){const scheduled=await Notifications.getAllScheduledNotificationsAsync();if(scheduled.some(item=>item.identifier===oldId))return 'Reminder is already scheduled on this device.';}}catch{}}
  if (date.getTime() <= Date.now()) {
    await cancelNotificationAndForget(oldId, storageKey);
    return 'Reminder saved. Past dates are overdue and are not scheduled on this device.';
  }
  if (!Device.isDevice) return 'Reminder saved. A physical device is required for local notifications.';
  // A reschedule replaces the old schedule even when the OS permission has
  // since been revoked, so a stale reminder cannot fire on its previous date.
  await cancelNotificationAndForget(oldId, storageKey);
  try {
    const current = await Notifications.getPermissionsAsync();
    const permission = current.status === 'granted' || !requestPermission ? current : await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return 'Reminder saved, but notification permission is off on this device.';
    const identifier = await Notifications.scheduleNotificationAsync({
      content: {title, body, sound: 'default'},
      trigger: {type: Notifications.SchedulableTriggerInputTypes.DATE, date}
    });
    try { await AsyncStorage.setItem(storageKey, JSON.stringify({id:identifier,dueDate,title,body})); }
    catch (error) { await Notifications.cancelScheduledNotificationAsync(identifier).catch(()=>undefined); throw error; }
    return 'Reminder saved and scheduled on this device only.';
  } catch (error) {
    console.warn('Could not schedule local reminder:', error);
    return 'Reminder saved, but could not be scheduled on this device.';
  }
}

export function cancelLocalReminder(localKey: string): Promise<void> {
  const previous=reminderWrites.get(localKey)||Promise.resolve();
  const task=previous.catch(()=>undefined).then(()=>cancelLocalReminderNow(localKey));
  reminderWrites.set(localKey,task);
  void task.then(()=>{if(reminderWrites.get(localKey)===task)reminderWrites.delete(localKey);},()=>{if(reminderWrites.get(localKey)===task)reminderWrites.delete(localKey);});
  return task;
}

async function cancelLocalReminderNow(localKey: string): Promise<void> {
  const storageKey = `ksk-local-notification:${localKey}`;
  const saved = await AsyncStorage.getItem(storageKey);
  let identifier=saved||'';
  if(saved){try{identifier=JSON.parse(saved).id||saved;}catch{}}
  await cancelNotificationAndForget(identifier, storageKey);
}

async function cancelNotificationAndForget(identifier:string, storageKey:string):Promise<void>{
  try { if(identifier) await Notifications.cancelScheduledNotificationAsync(identifier); }
  catch(error) { console.warn('Could not cancel a local reminder notification:',error); }
  finally { await AsyncStorage.removeItem(storageKey); }
}

export async function reconcileLocalReminders(uid:string,records:{id:string;title?:string;notes?:string;dueDate?:string;status?:string}[]):Promise<void>{
  const permission=await Notifications.getPermissionsAsync();
  const knownKeys=new Set<string>();
  for(const record of records){
    const key=`reminder:${uid}:${record.id}`;
    knownKeys.add(`ksk-local-notification:${key}`);
    if(record.status==='cancelled'){await cancelLocalReminder(key);continue;}
    if(permission.status==='granted'&&record.dueDate){
      await scheduleLocalReminder(record.title||'KSK reminder',record.notes||record.title||'Project reminder',record.dueDate,key,false);
    }
  }
  // Clean device schedules for records removed remotely or from an account.
  const keys=(await AsyncStorage.getAllKeys()).filter(key=>key.startsWith(`ksk-local-notification:reminder:${uid}:`));
  for(const storageKey of keys){
    if(knownKeys.has(storageKey))continue;
    const localKey=storageKey.slice('ksk-local-notification:'.length);
    await cancelLocalReminder(localKey);
  }
}
