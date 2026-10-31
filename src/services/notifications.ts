import {AppState, Platform} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';

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

/** Schedule on this device only; no project-wide or cloud notification is sent. */
export async function scheduleLocalReminder(title: string, body: string, dueDate: string): Promise<string> {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate);
  if (!match) return 'Reminder saved, but its date is invalid for a local notification.';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 9, 0, 0);
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) {
    return 'Reminder saved, but its date is invalid for a local notification.';
  }
  if (date.getTime() <= Date.now()) return 'Reminder saved. Past dates are not scheduled on this device.';
  if (!Device.isDevice) return 'Reminder saved. A physical device is required for local notifications.';
  try {
    const current = await Notifications.getPermissionsAsync();
    const permission = current.status === 'granted' ? current : await Notifications.requestPermissionsAsync();
    if (permission.status !== 'granted') return 'Reminder saved, but notification permission is off on this device.';
    await Notifications.scheduleNotificationAsync({
      content: {title, body, sound: 'default'},
      trigger: {type: Notifications.SchedulableTriggerInputTypes.DATE, date}
    });
    return 'Reminder saved and scheduled on this device only.';
  } catch (error) {
    console.warn('Could not schedule local reminder:', error);
    return 'Reminder saved, but could not be scheduled on this device.';
  }
}
