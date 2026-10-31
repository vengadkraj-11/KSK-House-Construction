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
