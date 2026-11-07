import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Modal, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {
  addApprovedViewer, deleteViewerAccount, editViewerMember, subscribeLegacyViewers,
  subscribeViewerRequests, ViewerAccessRequest
} from '../services/viewerAccess';
import {KSK_DESIGN} from '../theme/kskDesignSystem';

const colors = KSK_DESIGN.colors;
const fieldStyle = {
  backgroundColor: colors.canvas,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: colors.border,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: colors.ink,
  marginTop: 8
};

export default function FamilyMemberManagement({ownerUid, language}: {ownerUid: string; language: 'en' | 'ta'}) {
  const [members, setMembers] = useState<ViewerAccessRequest[]>([]);
  const [legacyMembers, setLegacyMembers] = useState<ViewerAccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ViewerAccessRequest | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [deleting, setDeleting] = useState<ViewerAccessRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;

  useEffect(() => {
    const stopMembers = subscribeViewerRequests(items => {
      setMembers(items);
      setLoading(false);
    }, issue => {
      setError(issue.message);
      setLoading(false);
    });
    const stopLegacy = subscribeLegacyViewers(items => {
      setLegacyMembers(items);
      setLoading(false);
    }, issue => {
      setError(issue.message);
      setLoading(false);
    });
    return () => {stopMembers(); stopLegacy();};
  }, []);

  const allMembers = useMemo(() => [
    ...members,
    ...legacyMembers.filter(item => !members.some(member => member.uid === item.uid))
  ], [members, legacyMembers]);
  const filteredMembers = allMembers.filter(member => {
    const term = search.trim().toLowerCase();
    return !term || String(member.fullName || '').toLowerCase().includes(term)
      || String(member.normalizedMobileNumber || '').toLowerCase().includes(term);
  });

  const addMember = async () => {
    if (adding || !name.trim() || !phone.trim()) return;
    setAdding(true);
    setError('');
    setMessage('');
    try {
      await addApprovedViewer(name, phone, ownerUid, language);
      setName('');
      setPhone('');
      setMessage(t(
        'Member record added. A phone number does not verify identity; Viewer access still requires the member’s existing authenticated Firebase UID.',
        'உறுப்பினர் பதிவு சேர்க்கப்பட்டது. தொலைபேசி எண் அடையாளத்தை உறுதிப்படுத்தாது; பார்வையாளர் அணுகலுக்கு ஏற்கனவே அங்கீகரிக்கப்பட்ட Firebase UID தேவை.'
      ));
    } catch (issue: any) {
      setError(issue?.message || t('The member could not be added.', 'உறுப்பினரைச் சேர்க்க முடியவில்லை.'));
    } finally {
      setAdding(false);
    }
  };

  const openEdit = (member: ViewerAccessRequest) => {
    setEditing(member);
    setEditName(member.fullName);
    setEditPhone(member.normalizedMobileNumber);
    setError('');
  };

  const saveEdit = async () => {
    if (!editing || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await editViewerMember(editing, editName, editPhone, ownerUid);
      setEditing(null);
      setMessage(t('Member details updated.', 'உறுப்பினர் விவரங்கள் புதுப்பிக்கப்பட்டன.'));
    } catch (issue: any) {
      setError(issue?.message || t('The member details could not be updated.', 'உறுப்பினர் விவரங்களைப் புதுப்பிக்க முடியவில்லை.'));
    } finally {
      setBusy(false);
    }
  };

  const deleteMember = async () => {
    if (!deleting || busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await deleteViewerAccount(deleting, ownerUid);
      setDeleting(null);
      setMessage(t(
        `Viewer access and member records removed. ${result.deviceHistoryCount} device record(s) were deleted; project data and the Firebase Auth identity were not deleted.`,
        `பார்வையாளர் அணுகலும் உறுப்பினர் பதிவுகளும் நீக்கப்பட்டன. ${result.deviceHistoryCount} சாதனப் பதிவுகள் நீக்கப்பட்டன; திட்டத் தரவும் Firebase Auth அடையாளமும் நீக்கப்படவில்லை.`
      ));
    } catch (issue: any) {
      setError(issue?.message || t('The member could not be deleted.', 'உறுப்பினரை நீக்க முடியவில்லை.'));
    } finally {
      setBusy(false);
    }
  };

  const button = (label: string, onPress: () => void, danger = false, disabled = false) => (
    <TouchableOpacity disabled={disabled || busy} onPress={onPress} style={{
      backgroundColor: danger ? colors.dangerSoft : colors.primary,
      borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12,
      opacity: disabled || busy ? 0.5 : 1
    }}>
      <Text style={{fontSize: 11, color: danger ? colors.danger : '#FFF', fontWeight: '800'}}>{label}</Text>
    </TouchableOpacity>
  );

  return <View style={{backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12}}>
    <Text style={{fontSize: 17, fontWeight: '900', color: colors.ink}}>{t('Family Members', 'குடும்ப உறுப்பினர்கள்')}</Text>
    <Text style={{fontSize: 12, lineHeight: 18, color: colors.inkMuted, marginTop: 6}}>
      {t(
        'Mobile numbers are lookup details, not authentication. Existing UID-bound access stays private; a number alone cannot grant access on a new browser.',
        'மொபைல் எண்கள் தேடல் விவரங்கள் மட்டுமே; அங்கீகாரம் அல்ல. ஏற்கனவே உள்ள UID அணுகல் பாதுகாக்கப்படும்; புதிய உலாவியில் எண் மட்டும் அணுகலை வழங்காது.'
      )}
    </Text>

    {loading ? <ActivityIndicator color={colors.primary} style={{margin: 16}}/> : null}
    {error ? <Text accessibilityRole="alert" style={{fontSize: 12, color: colors.danger, marginTop: 10}}>{error}</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={{fontSize: 12, color: colors.primary, marginTop: 10}}>{message}</Text> : null}

    <View style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 14}}>
      <Text style={{fontSize: 14, fontWeight: '900', color: colors.ink}}>{t('Add Member', 'உறுப்பினரைச் சேர்')}</Text>
      <TextInput value={name} onChangeText={setName} placeholder={t('Name', 'பெயர்')} autoComplete="name" style={fieldStyle}/>
      <TextInput value={phone} onChangeText={setPhone} placeholder={t('Mobile Number', 'மொபைல் எண்')} keyboardType="phone-pad" autoComplete="tel" style={fieldStyle}/>
      <View style={{marginTop: 9}}>
        {button(adding ? t('Adding…', 'சேர்க்கிறது…') : t('Add Member', 'உறுப்பினரைச் சேர்'), () => void addMember(), false, adding || !name.trim() || !phone.trim())}
      </View>
    </View>

    <View style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 14}}>
      <Text style={{fontSize: 14, fontWeight: '900', color: colors.ink}}>{t('Member List', 'உறுப்பினர் பட்டியல்')} ({allMembers.length})</Text>
      <TextInput value={search} onChangeText={setSearch} placeholder={t('Search name or mobile number', 'பெயர் அல்லது மொபைல் எண்ணைத் தேடு')} style={fieldStyle}/>
      {filteredMembers.length === 0 ? <Text style={{fontSize: 11, color: colors.inkMuted, marginTop: 9}}>{t('No members found.', 'உறுப்பினர்கள் இல்லை.')}</Text> : null}
      {filteredMembers.map(member => <View key={member.uid} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 10}}>
        <Text style={{fontSize: 13, fontWeight: '800', color: colors.ink}}>{member.fullName}</Text>
        <Text selectable style={{fontSize: 12, color: colors.inkMuted, marginTop: 3}}>{member.normalizedMobileNumber || t('No mobile number', 'மொபைல் எண் இல்லை')}</Text>
        <Text style={{fontSize: 10, color: member.status === 'approved' ? colors.primary : colors.danger, marginTop: 3}}>
          {member.manualInvite
            ? t('Record only · no linked sign-in UID', 'பதிவு மட்டும் · இணைக்கப்பட்ட உள்நுழைவு UID இல்லை')
            : member.status === 'approved'
              ? t('Active membership record', 'செயலில் உள்ள உறுப்பினர் பதிவு')
              : t('Inactive membership record', 'செயலற்ற உறுப்பினர் பதிவு')}
        </Text>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8}}>
          {button(t('Edit', 'திருத்து'), () => openEdit(member))}
          {button(t('Delete', 'நீக்கு'), () => setDeleting(member), true)}
        </View>
      </View>)}
    </View>

    <Modal transparent visible={editing !== null} animationType="fade" onRequestClose={() => busy ? undefined : setEditing(null)}>
      <View style={{flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)'}}>
        <View style={{backgroundColor: colors.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: colors.border}}>
          <Text style={{fontSize: 16, fontWeight: '900', color: colors.ink}}>{t('Edit Member', 'உறுப்பினரைத் திருத்து')}</Text>
          <TextInput value={editName} onChangeText={setEditName} placeholder={t('Name', 'பெயர்')} style={fieldStyle}/>
          <TextInput value={editPhone} onChangeText={setEditPhone} placeholder={t('Mobile Number', 'மொபைல் எண்')} keyboardType="phone-pad" style={fieldStyle}/>
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14}}>
            {button(t('Cancel', 'ரத்து'), () => setEditing(null), false, busy)}
            {button(busy ? t('Saving…', 'சேமிக்கிறது…') : t('Save', 'சேமி'), () => void saveEdit(), false, busy)}
          </View>
        </View>
      </View>
    </Modal>

    <Modal transparent visible={deleting !== null} animationType="fade" onRequestClose={() => busy ? undefined : setDeleting(null)}>
      <View style={{flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)'}}>
        <View style={{backgroundColor: colors.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: colors.border}}>
          <Text style={{fontSize: 16, fontWeight: '900', color: colors.ink}}>{t('Delete Member?', 'உறுப்பினரை நீக்கவா?')}</Text>
          <Text style={{fontSize: 12, lineHeight: 18, color: colors.inkMuted, marginTop: 8}}>
            {t('This removes the membership and eligible device records, but does not delete project data or the Firebase Auth identity.', 'இது உறுப்பினர் மற்றும் தொடர்புடைய சாதனப் பதிவுகளை நீக்கும்; திட்டத் தரவையோ Firebase Auth அடையாளத்தையோ நீக்காது.')}
          </Text>
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14}}>
            {button(t('Cancel', 'ரத்து'), () => setDeleting(null), false, busy)}
            {button(busy ? t('Deleting…', 'நீக்குகிறது…') : t('Delete', 'நீக்கு'), () => void deleteMember(), true, busy)}
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}
