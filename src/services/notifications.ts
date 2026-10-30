import {Platform} from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import {registerDevice} from './projectSync';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

export async function enableNotifications(uid: string): Promise<string> {
  if (!Device.isDevice) return 'Use a physical Android device to enable push notifications.';
  await Notifications.setNotificationChannelAsync('construction-updates', {
    name: 'Construction updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 150, 250]
  });
  const current = await Notifications.getPermissionsAsync();
  let status = current.status;
  if (status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested.status;
  }
  if (status !== 'granted') return 'Notification permission was not granted on this device.';
  const token = await Notifications.getDevicePushTokenAsync();
  await registerDevice(uid, String(token.data), Platform.OS);
  return 'This device is registered for construction update notifications.';
}
