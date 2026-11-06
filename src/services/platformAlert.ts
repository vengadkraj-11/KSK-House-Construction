import { Alert as NativeAlert, Platform } from 'react-native';

type AlertButton = {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[]) {
    if (Platform.OS !== 'web') {
      NativeAlert.alert(title, message, buttons);
      return;
    }

    const list = buttons || [{ text: 'OK' }];

    if (list.length > 1) {
      const accepted = window.confirm(`${title}\n\n${message || ''}`);
      const selected = accepted
        ? list.find(b => b.style !== 'cancel') || list[0]
        : list.find(b => b.style === 'cancel');

      selected?.onPress?.();
      return;
    }

    window.alert(`${title}\n\n${message || ''}`);
    list[0]?.onPress?.();
  }
};
