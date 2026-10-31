import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator, Alert, Image, Modal,
  Text, TouchableOpacity, View
} from 'react-native';
import {
  addDoc, collection, deleteDoc, doc, onSnapshot,
  serverTimestamp, updateDoc
} from 'firebase/firestore';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import {db} from '../firebase';

const PROJECT_ID = 'ksk';
const MAX_BASE64_LENGTH = 450000;

type BillImage = {
  id: string;
  imageBase64: string;
  fileName?: string;
  createdAt?: any;
};

export default function BillAttachments({
  recordId, canEdit, language, collectionName = 'bills'
}: {
  recordId: string;
  canEdit: boolean;
  language: string;
  collectionName?: 'bills' | 'attachments';
}) {
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<BillImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<BillImage | null>(null);

  const t = (en: string, ta: string) => language === 'ta' ? ta : en;
  const photoMode=collectionName==='attachments';
  const label=photoMode?t('photo','படம்'):t('receipt','ரசீது');
  const title=photoMode?t('Site photos','தளப் புகைப்படங்கள்'):t('Bills / receipts','பில்கள் / ரசீதுகள்');

  // Subscribe only while this expense's receipt window is open.
  useEffect(() => {
    if (!visible || !db || !recordId) return;

    setLoading(true);
    const imagesPath = collection(
      db, 'projects', PROJECT_ID, collectionName, recordId, 'images'
    );

    const stop = onSnapshot(imagesPath, snapshot => {
      const next = snapshot.docs.map(d => ({
        ...d.data(),
        id: d.id
      } as BillImage));

      next.sort((a, b) =>
        (b.createdAt?.toMillis?.() || 0) -
        (a.createdAt?.toMillis?.() || 0)
      );

      setItems(next);
      setLoading(false);
    }, error => {
      setLoading(false);
      Alert.alert(
        t('Bills unavailable', 'ரசீதுகளைக் காண முடியவில்லை'),
        error.message
      );
    });

    return stop;
  }, [visible, recordId, collectionName]);

  const chooseImage = async (camera: boolean, replaceItem?: BillImage) => {
    if (!canEdit || !db) return;

    try {
      let result: ImagePicker.ImagePickerResult;

      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            t('Camera permission', 'கேமரா அனுமதி'),
            t(`Allow camera access to take a ${label}.`, 'புகைப்படம் எடுக்க கேமரா அனுமதி வழங்கவும்.')
          );
          return;
        }

        result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'] as any,
          quality: 1
        });
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            t('Gallery permission', 'கேலரி அனுமதி'),
            t(`Allow photo library access to select a ${label}.`, 'புகைப்படத்தைத் தேர்ந்தெடுக்க அனுமதி வழங்கவும்.')
          );
          return;
        }

        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'] as any,
          quality: 1
        });
      }

      if (result.canceled || !result.assets?.length) return;

      setUploading(true);
      const uri = result.assets[0].uri;
      let base64 = '';

      for (const width of [1280, 1000, 800]) {
        for (const quality of [0.6, 0.45, 0.3]) {
          const compressed = await ImageManipulator.manipulateAsync(
            uri,
            [{resize: {width}}],
            {
              compress: quality,
              format: ImageManipulator.SaveFormat.JPEG,
              base64: true
            }
          );

          base64 = compressed.base64 || '';
          if (base64.length > 0 && base64.length <= MAX_BASE64_LENGTH) break;
        }
        if (base64.length > 0 && base64.length <= MAX_BASE64_LENGTH) break;
      }

      if (!base64 || base64.length > MAX_BASE64_LENGTH) {
        throw new Error(
          t(
            'This photo is too large to store safely. Try a smaller or cropped photo.',
            'இந்தப் புகைப்படம் சேமிக்க மிகவும் பெரியது. சிறிய அல்லது வெட்டப்பட்ட புகைப்படத்தை முயற்சிக்கவும்.'
          )
        );
      }

      const imagesPath = collection(
        db, 'projects', PROJECT_ID, collectionName, recordId, 'images'
      );
      const fileName = `${photoMode?'site-photo':'receipt'}-${Date.now()}.jpg`;

      if (replaceItem) {
        await updateDoc(doc(imagesPath, replaceItem.id), {
          imageBase64: base64,
          fileName,
          mimeType: 'image/jpeg'
        });
        setSelected(null);
        Alert.alert(
          t(photoMode?'Photo updated':'Receipt updated', photoMode?'புகைப்படம் புதுப்பிக்கப்பட்டது':'ரசீது புதுப்பிக்கப்பட்டது'),
          t('The replacement image is available to project members.', 'மாற்றிய படம் திட்ட உறுப்பினர்களுக்குக் கிடைக்கும்.')
        );
      } else {
        await addDoc(imagesPath, {
          recordId,
          imageBase64: base64,
          fileName,
          mimeType: 'image/jpeg',
          createdBy: 'owner',
          createdAt: serverTimestamp()
        });
        Alert.alert(
          t(photoMode?'Photo attached':'Receipt attached', photoMode?'புகைப்படம் இணைக்கப்பட்டது':'ரசீது இணைக்கப்பட்டது'),
          t('The image is now available to project members.', 'இந்தப் படத்தை திட்ட உறுப்பினர்கள் இப்போது பார்க்கலாம்.')
        );
      }
    } catch (error: any) {
      Alert.alert(
        t('Upload failed', 'பதிவேற்றம் தோல்வியடைந்தது'),
        error?.message || t('Please try again.', 'மீண்டும் முயற்சிக்கவும்.')
      );
    } finally {
      setUploading(false);
    }
  };

  const downloadImage = async (item: BillImage) => {
    if (!item.imageBase64 || !FileSystem.cacheDirectory) {
      Alert.alert(
        t('Download unavailable', 'பதிவிறக்கம் கிடைக்கவில்லை'),
        t(`The ${label} could not be prepared for download.`, 'பதிவிறக்கப் படத்தைத் தயாரிக்க முடியவில்லை.')
      );
      return;
    }

    try {
      setDownloadingId(item.id);
      const safeName = (item.fileName || `receipt-${item.id}.jpg`)
        .replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileUri = `${FileSystem.cacheDirectory}${Date.now()}-${safeName}`;

      await FileSystem.writeAsStringAsync(fileUri, item.imageBase64, {
        encoding: FileSystem.EncodingType.Base64
      });

      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(
          t('Sharing unavailable', 'பகிர்வு கிடைக்கவில்லை'),
          t('The receipt was prepared, but sharing is unavailable on this device.', 'ரசீது தயாராக உள்ளது; ஆனால் இந்தச் சாதனத்தில் பகிர்வு வசதி இல்லை.')
        );
        return;
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: 'image/jpeg',
        dialogTitle: photoMode?t('Save or share photo','புகைப்படத்தைச் சேமிக்கவும் அல்லது பகிரவும்'):t('Save or share receipt', 'ரசீதைச் சேமிக்கவும் அல்லது பகிரவும்')
      });
    } catch (error: any) {
      Alert.alert(
        t('Download failed', 'பதிவிறக்கம் தோல்வியடைந்தது'),
        error?.message || t('Please try again.', 'மீண்டும் முயற்சிக்கவும்.')
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const removeImage = (item: BillImage) => {
    if (!canEdit || !db) return;

    Alert.alert(
      photoMode?t('Delete photo?','புகைப்படத்தை நீக்கவா?'):t('Delete receipt?', 'ரசீதை நீக்கவா?'),
      t(`This ${label} image will be permanently deleted.`, 'இந்தப் படம் நிரந்தரமாக நீக்கப்படும்.'),
      [
        {text: t('Cancel', 'ரத்து'), style: 'cancel'},
        {
          text: t('Delete', 'நீக்கு'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteDoc(doc(
                db!, 'projects', PROJECT_ID, collectionName,
                recordId, 'images', item.id
              ));
              if (selected?.id === item.id) setSelected(null);
            } catch (error: any) {
              Alert.alert(
                t('Delete failed', 'நீக்க முடியவில்லை'),
                error?.message || ''
              );
            }
          }
        }
      ]
    );
  };

  return (
    <View style={{marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E2E9E5'}}>
      <TouchableOpacity
        onPress={() => setVisible(true)}
        style={{alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, backgroundColor: '#EAF0F7'}}>
        <Text style={{fontSize: 11, color: '#365775', fontWeight: '800'}}>
          {title}
        </Text>
      </TouchableOpacity>

      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={() => {
          setVisible(false);
          setSelected(null);
        }}>
        <View style={{flex: 1, backgroundColor: '#F7F9F8', padding: 18, paddingTop: 42}}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
            <Text style={{fontSize: 18, color: '#20352F', fontWeight: '800'}}>
              {title}
            </Text>
            <TouchableOpacity onPress={() => setVisible(false)} style={{padding: 9}}>
              <Text style={{fontSize: 13, color: '#365775', fontWeight: '800'}}>
                {t('Close ✕', 'மூடு ✕')}
              </Text>
            </TouchableOpacity>
          </View>

          {canEdit ? (
            <View style={{flexDirection: 'row', gap: 9, marginTop: 16}}>
              <TouchableOpacity
                disabled={uploading}
                onPress={() => chooseImage(false)}
                style={{paddingHorizontal: 13, paddingVertical: 10, borderRadius: 9, backgroundColor: '#E6F1EC'}}>
                <Text style={{fontSize: 12, color: '#1C6255', fontWeight: '800'}}>
                  {t('Gallery +', 'கேலரி +')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={uploading}
                onPress={() => chooseImage(true)}
                style={{paddingHorizontal: 13, paddingVertical: 10, borderRadius: 9, backgroundColor: '#EAF0F7'}}>
                <Text style={{fontSize: 12, color: '#365775', fontWeight: '800'}}>
                  {t('Camera', 'கேமரா')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {uploading ? (
            <View style={{flexDirection: 'row', alignItems: 'center', marginTop: 14}}>
              <ActivityIndicator color="#1C6255"/>
              <Text style={{marginLeft: 9, color: '#6F817C', fontSize: 12}}>
                {t('Compressing and uploading…', 'சுருக்கி பதிவேற்றுகிறது…')}
              </Text>
            </View>
          ) : null}

          {loading ? (
            <ActivityIndicator color="#1C6255" style={{marginTop: 24}}/>
          ) : items.length === 0 ? (
            <Text style={{fontSize: 13, color: '#6F817C', marginTop: 20}}>
              {t('No bill attached yet.', 'இதுவரை ரசீது இணைக்கப்படவில்லை.')}
            </Text>
          ) : (
            <View style={{marginTop: 16, gap: 10}}>
              {items.map(item => (
                <View key={item.id} style={{padding: 12, backgroundColor: '#FFFFFF', borderRadius: 11, borderWidth: 1, borderColor: '#E2E9E5'}}>
                  <Text style={{fontSize: 12, color: '#365775', fontWeight: '700', marginBottom: 9}}>
                    {item.fileName || (photoMode?t('Site photo','தளப் புகைப்படம்'):t('Receipt image', 'ரசீது படம்'))}
                  </Text>

                  <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 7}}>
                    {canEdit ? (
                      <TouchableOpacity
                        onPress={() => setSelected(item)}
                        style={{paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#EAF0F7'}}>
                        <Text style={{fontSize: 11, color: '#365775', fontWeight: '800'}}>
                          {t('View', 'பார்')}
                        </Text>
                      </TouchableOpacity>
                    ) : null}

                    <TouchableOpacity
                      disabled={downloadingId === item.id}
                      onPress={() => downloadImage(item)}
                      style={{paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#E6F1EC'}}>
                      <Text style={{fontSize: 11, color: '#1C6255', fontWeight: '800'}}>
                        {downloadingId === item.id
                          ? t('Preparing…', 'தயாராகிறது…')
                          : t('Download', 'பதிவிறக்கு')}
                      </Text>
                    </TouchableOpacity>

                    {canEdit ? (
                      <>
                        <TouchableOpacity
                          disabled={uploading}
                          onPress={() => chooseImage(false, item)}
                          style={{paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#F1F0FA'}}>
                          <Text style={{fontSize: 11, color: '#554B86', fontWeight: '800'}}>
                            {t('Edit / Replace', 'திருத்து / மாற்று')}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => removeImage(item)}
                          style={{paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, backgroundColor: '#FDECEC'}}>
                          <Text style={{fontSize: 11, color: '#B42318', fontWeight: '800'}}>
                            {t('Delete', 'நீக்கு')}
                          </Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )}

          <Modal
            visible={!!selected && canEdit}
            transparent
            animationType="fade"
            onRequestClose={() => setSelected(null)}>
            <View style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'center', padding: 14}}>
              <TouchableOpacity
                onPress={() => setSelected(null)}
                style={{alignSelf: 'flex-end', padding: 12}}>
                <Text style={{color: '#FFFFFF', fontWeight: '800'}}>
                  {t('Close ✕', 'மூடு ✕')}
                </Text>
              </TouchableOpacity>
              {selected ? (
                <Image
                  source={{uri: `data:image/jpeg;base64,${selected.imageBase64}`}}
                  resizeMode="contain"
                  style={{width: '100%', height: '82%'}}
                />
              ) : null}
            </View>
          </Modal>
        </View>
      </Modal>
    </View>
  );
}
