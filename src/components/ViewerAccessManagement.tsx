import React, {useEffect, useMemo, useState} from 'react';
import {ActivityIndicator, Modal, Text, TextInput, TouchableOpacity, View} from 'react-native';
import {
  addApprovedViewer, clearViewerAccessHistory, clearViewerRequestHistory, decideViewerAccess, decideViewerRecovery,
  deleteViewerAccount, ensureViewerPhoneIndex, revokeLegacyViewer, subscribeLegacyViewers,
  subscribeViewerAccessHistory, subscribeViewerRecoveryRequests, subscribeViewerRequests,
  ViewerAccessHistoryEntry, ViewerAccessRequest, ViewerRecoveryRequest, ViewerRequestHistoryItem
} from '../services/viewerAccess';
import {
  clearLoginHistory, clearLoginHistoryEntries, loginHistoryDate, LoginHistoryEntry,
  revokeLoginHistoryForUser, subscribeLoginHistory
} from '../services/loginHistory';
import {KSK_DESIGN} from '../theme/kskDesignSystem';

const colors = KSK_DESIGN.colors;
const dateLabel = (value: any) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : '—';
};
const statusLabel = (status: string, t: (en: string, ta: string) => string) => ({
  pending: t('PENDING', 'நிலுவையில்'),
  approved: t('APPROVED', 'அனுமதிக்கப்பட்டது'),
  rejected: t('REJECTED', 'நிராகரிக்கப்பட்டது'),
  revoked: t('REVOKED', 'நீக்கப்பட்டது'),
  restored: t('RESTORED', 'மீட்டமைக்கப்பட்டது'),
  deleted: t('ACCOUNT DELETED', 'கணக்கு நீக்கப்பட்டது'),
  cleared: t('CLEARED', 'அழிக்கப்பட்டது')
}[status] || status.toUpperCase());

type ConfirmAction =
  | {kind: 'clear-selected-requests' | 'clear-all-history' | 'clear-selected-events' | 'clear-selected-devices' | 'clear-all-devices'; count: number}
  | {kind: 'reject' | 'revoke' | 'delete-account' | 'revoke-member'; request: ViewerAccessRequest}
  | {kind: 'revoke-session'; entry: LoginHistoryEntry};

export default function ViewerAccessManagement({ownerUid, language}: {ownerUid: string; language: 'en' | 'ta'}) {
  const [requests, setRequests] = useState<ViewerAccessRequest[]>([]);
  const [legacyViewers, setLegacyViewers] = useState<ViewerAccessRequest[]>([]);
  const [recoveryRequests, setRecoveryRequests] = useState<ViewerRecoveryRequest[]>([]);
  const [historyEvents, setHistoryEvents] = useState<ViewerAccessHistoryEntry[]>([]);
  const [deviceEntries, setDeviceEntries] = useState<LoginHistoryEntry[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState('');
  const [search, setSearch] = useState('');
  const [selectedRequests, setSelectedRequests] = useState<Set<string>>(new Set());
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [selectedDevices, setSelectedDevices] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberPhone, setNewMemberPhone] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;

  useEffect(() => {
    const stopRequests = subscribeViewerRequests(items => {
      setRequests(items);
      setLoading(false);
      void Promise.all(items.map(ensureViewerPhoneIndex)).catch(issue => {
        setError(issue?.message || 'Existing viewer records could not be indexed.');
      });
    }, issue => {setError(issue.message); setLoading(false);});
    const stopLegacy = subscribeLegacyViewers(items => {setLegacyViewers(items); setLoading(false);}, issue => {setError(issue.message); setLoading(false);});
    const stopRecoveries = subscribeViewerRecoveryRequests(items => {setRecoveryRequests(items); setLoading(false);}, issue => {setError(issue.message); setLoading(false);});
    const stopEvents = subscribeViewerAccessHistory(items => {setHistoryEvents(items); setLoading(false);}, issue => {setError(issue.message); setLoading(false);});
    const stopDevices = subscribeLoginHistory(ownerUid, 'owner', items => {setDeviceEntries(items); setLoading(false);}, issue => {setError(issue); setLoading(false);});
    return () => {stopRequests(); stopLegacy(); stopRecoveries(); stopEvents(); stopDevices();};
  }, [ownerUid]);

  const allMembers = useMemo(() => [
    ...requests,
    ...legacyViewers.filter(item => !requests.some(request => request.uid === item.uid))
  ], [requests, legacyViewers]);
  const clearableRequests: ViewerRequestHistoryItem[] = [
    ...requests.filter(item => !item.legacy && ['pending', 'rejected'].includes(item.status))
      .map(request => ({kind: 'access' as const, request})),
    ...recoveryRequests.filter(item => ['pending', 'rejected', 'restored'].includes(item.status))
      .map(request => ({kind: 'recovery' as const, request}))
  ];
  const requestKey = (item: ViewerRequestHistoryItem) => `${item.kind}:${item.request.uid}`;
  const selectedRequestCount = clearableRequests.filter(item => selectedRequests.has(requestKey(item))).length;
  const filteredMembers = allMembers.filter(item => {
    const term = search.trim().toLowerCase();
    return !term || item.fullName.toLowerCase().includes(term) || item.normalizedMobileNumber.toLowerCase().includes(term);
  });
  const eventRows = useMemo(() => {
    const recorded = new Set(historyEvents.map(item => item.uid));
    const fallback = allMembers.filter(item => !recorded.has(item.uid)).map(item => ({
      id: `current-${item.uid}`,
      uid: item.uid,
      fullName: item.fullName,
      normalizedMobileNumber: item.normalizedMobileNumber,
      action: 'registered' as const,
      status: item.status,
      actorUid: item.uid,
      createdAt: item.registeredAt
    }));
    return [...historyEvents, ...fallback].sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  }, [historyEvents, allMembers]);
  const filteredEvents = eventRows.filter(item => {
    const term = search.trim().toLowerCase();
    return !term || item.fullName.toLowerCase().includes(term) || item.normalizedMobileNumber.toLowerCase().includes(term);
  });
  const filteredDevices = deviceEntries.filter(entry => {
    const member = allMembers.find(item => item.uid === entry.userId);
    const term = search.trim().toLowerCase();
    return !term || (member?.fullName || entry.displayName || '').toLowerCase().includes(term)
      || (member?.normalizedMobileNumber || '').toLowerCase().includes(term)
      || entry.installationId.toLowerCase().includes(term);
  });
  const selectableEvents = filteredEvents.filter(item => !item.id.startsWith('current-'));
  const eligibleHistoryCount = clearableRequests.length + historyEvents.length;

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) => setter(current => {
    const updated = new Set(current);
    if (updated.has(key)) updated.delete(key);
    else updated.add(key);
    return updated;
  });

  const decide = async (item: ViewerAccessRequest, action: 'approved' | 'rejected' | 'revoked'): Promise<boolean> => {
    setWorkingId(item.uid);
    setError('');
    try {
      if (item.legacy) {
        if (action !== 'revoked') throw new Error('Legacy viewer access can only be revoked here.');
        await revokeLegacyViewer(item, ownerUid);
      } else {
        await decideViewerAccess(item, action, ownerUid);
      }
      return true;
    } catch (issue: any) {
      setError(issue?.message || t('The access decision could not be saved.', 'அணுகல் முடிவைச் சேமிக்க முடியவில்லை.'));
      return false;
    } finally {
      setWorkingId('');
    }
  };

  const revokeMember = async (member: ViewerAccessRequest) => {
    if (member.status !== 'approved') throw new Error('This member has no active approved access.');
    if (member.legacy) await revokeLegacyViewer(member, ownerUid);
    else await decideViewerAccess(member, 'revoked', ownerUid);
    await revokeLoginHistoryForUser(member.uid, ownerUid);
  };

  const revokeSession = async (entry: LoginHistoryEntry) => {
    const member = allMembers.find(item => item.uid === entry.userId);
    if (!member) throw new Error('This session has no active approved viewer account.');
    await revokeMember(member);
  };

  const addMember = async () => {
    if (addingMember || !newMemberName.trim() || !newMemberPhone.trim()) return;
    setAddingMember(true);
    setError('');
    setMessage('');
    try {
      await addApprovedViewer(newMemberName, newMemberPhone, ownerUid, language);
      setNewMemberName('');
      setNewMemberPhone('');
      setMessage(t(
        'Member added as approved. They must create a secure browser session and the owner must verify recovery before project access is enabled.',
        'உறுப்பினர் அனுமதிக்கப்பட்டார். திட்ட அணுகலுக்கு முன் அவர் பாதுகாப்பான உலாவி அமர்வை உருவாக்கி, உரிமையாளர் மீட்புக் கோரிக்கையைச் சரிபார்க்க வேண்டும்.'
      ));
    } catch (issue: any) {
      setError(issue?.message || t('The member invitation could not be saved.', 'உறுப்பினர் அழைப்பைச் சேமிக்க முடியவில்லை.'));
    } finally {
      setAddingMember(false);
    }
  };

  const confirmAction = async () => {
    if (!confirmation) return;
    const action = confirmation;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (action.kind === 'clear-selected-requests') {
        const items = clearableRequests.filter(item => selectedRequests.has(requestKey(item)));
        const count = await clearViewerRequestHistory(items, ownerUid);
        setSelectedRequests(new Set());
        setMessage(t(`Cleared ${count} selected request history item(s).`, `${count} தேர்ந்தெடுத்த கோரிக்கை வரலாற்றுப் பதிவுகள் அழிக்கப்பட்டன.`));
      } else if (action.kind === 'clear-all-history') {
        const requestCount = await clearViewerRequestHistory(clearableRequests, ownerUid);
        const eventCount = await clearViewerAccessHistory(historyEvents.map(item => item.id));
        setSelectedRequests(new Set());
        setSelectedEvents(new Set());
        setMessage(t(`Cleared ${requestCount} eligible request(s) and ${eventCount} older history event(s). Approved member access was preserved.`, `${requestCount} தகுதியான கோரிக்கைகளும் ${eventCount} பழைய வரலாற்றுப் பதிவுகளும் அழிக்கப்பட்டன. அனுமதிக்கப்பட்ட உறுப்பினர் அணுகல் பாதுகாக்கப்பட்டது.`));
      } else if (action.kind === 'clear-selected-events') {
        const count = await clearViewerAccessHistory([...selectedEvents]);
        setSelectedEvents(new Set());
        setMessage(t(`Cleared ${count} selected history event(s).`, `${count} தேர்ந்தெடுத்த வரலாற்றுப் பதிவுகள் அழிக்கப்பட்டன.`));
      } else if (action.kind === 'clear-selected-devices') {
        const count = await clearLoginHistoryEntries([...selectedDevices]);
        setSelectedDevices(new Set());
        setMessage(t(`Cleared ${count} selected device history record(s).`, `${count} தேர்ந்தெடுத்த சாதன வரலாற்றுப் பதிவுகள் அழிக்கப்பட்டன.`));
      } else if (action.kind === 'clear-all-devices') {
        const count = await clearLoginHistory();
        setMessage(t(`Cleared ${count} device history record(s). The current owner session stays tracked.`, `${count} சாதன வரலாற்றுப் பதிவுகள் அழிக்கப்பட்டன. தற்போதைய உரிமையாளர் அமர்வு தொடர்ந்து கண்காணிக்கப்படும்.`));
      } else if (action.kind === 'reject') {
        await decide(action.request, 'rejected');
      } else if (action.kind === 'revoke') {
        if (await decide(action.request, 'revoked')) {
          await revokeLoginHistoryForUser(action.request.uid, ownerUid);
        }
      } else if (action.kind === 'revoke-session') {
        await revokeSession(action.entry);
      } else if (action.kind === 'revoke-member') {
        await revokeMember(action.request);
      } else if (action.kind === 'delete-account') {
        const result = await deleteViewerAccount(action.request, ownerUid);
        setMessage(t(
          `Project access, eligible profile/device records, and ${result.deviceHistoryCount} device history record(s) were removed. Firebase Authentication identity was not deleted and may still sign in without project access.`,
          `திட்ட அணுகல், தொடர்புடைய சுயவிவரம்/சாதனப் பதிவுகள் மற்றும் ${result.deviceHistoryCount} சாதன வரலாற்றுப் பதிவுகள் நீக்கப்பட்டன. Firebase Authentication அடையாளம் நீக்கப்படவில்லை; திட்ட அணுகல் இன்றி உள்நுழைய முடியும்.`
        ));
      }
      setConfirmation(null);
    } catch (issue: any) {
      setError(issue?.message || t('The requested management action failed.', 'நிர்வாகச் செயல் தோல்வியடைந்தது.'));
    } finally {
      setBusy(false);
    }
  };

  const renderButton = (label: string, onPress: () => void, danger = false, disabled = false) => (
    <TouchableOpacity disabled={disabled || busy} onPress={onPress} style={{
      backgroundColor: danger ? colors.dangerSoft : colors.primary,
      borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12, opacity: disabled || busy ? 0.5 : 1
    }}>
      <Text style={{fontSize: 11, color: danger ? colors.danger : '#FFF', fontWeight: '800'}}>{label}</Text>
    </TouchableOpacity>
  );

  return <View style={{backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12}}>
    <Text style={{fontSize: 17, fontWeight: '900', color: colors.ink}}>{t('Viewer access management', 'பார்வையாளர் அணுகல் நிர்வாகம்')}</Text>
    <Text style={{fontSize: 12, lineHeight: 18, color: colors.inkMuted, marginTop: 6}}>
      {t('Mobile numbers are contact details, not identity credentials. Verify members independently. Revocation blocks project access at the next authorization check.', 'மொபைல் எண்கள் தொடர்பு விவரங்கள் மட்டுமே; அடையாளச் சான்றுகள் அல்ல. உறுப்பினர்களைத் தனியாகச் சரிபார்க்கவும். அடுத்த அணுகல் சரிபார்ப்பில் அனுமதி நீக்கம் திட்ட அணுகலைத் தடுக்கும்.')}
    </Text>
    {loading ? <ActivityIndicator color={colors.primary} style={{margin: 16}}/> : null}
    {error ? <Text accessibilityRole="alert" style={{fontSize: 12, color: colors.danger, marginTop: 10}}>{error}</Text> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={{fontSize: 12, color: colors.primary, marginTop: 10}}>{message}</Text> : null}
    <TextInput value={search} onChangeText={setSearch} placeholder={t('Search name, mobile number or device ID', 'பெயர், மொபைல் எண் அல்லது சாதன அடையாளத்தைத் தேடுக')} style={{
      backgroundColor: colors.canvas, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, marginTop: 12
    }}/>

    <View style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 14}}>
      <Text style={{fontSize: 14, fontWeight: '900', color: colors.ink}}>{t('Add Member', 'உறுப்பினரைச் சேர்')}</Text>
      <Text style={{fontSize: 11, lineHeight: 16, color: colors.inkMuted, marginTop: 4}}>
        {t('This creates an approved invitation, not an authenticated account. A fresh device still requires owner-verified recovery; a typed phone number alone never grants access.', 'இது அனுமதிக்கப்பட்ட அழைப்பை உருவாக்கும்; அங்கீகரிக்கப்பட்ட கணக்கை அல்ல. புதிய சாதனத்திற்கு உரிமையாளர் சரிபார்த்த மீட்பு தேவை; தொலைபேசி எண்ணை மட்டும் உள்ளிடுவது அணுகலை வழங்காது.')}
      </Text>
      <TextInput
        accessibilityLabel={t('Name', 'பெயர்')}
        value={newMemberName}
        onChangeText={setNewMemberName}
        placeholder={t('Name', 'பெயர்')}
        autoComplete="name"
        style={{backgroundColor: colors.canvas, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, marginTop: 9}}
      />
      <TextInput
        accessibilityLabel={t('Mobile number', 'மொபைல் எண்')}
        value={newMemberPhone}
        onChangeText={setNewMemberPhone}
        placeholder={t('Mobile number · include country code', 'மொபைல் எண் · நாட்டுக் குறியீட்டைச் சேர்க்கவும்')}
        keyboardType="phone-pad"
        autoComplete="tel"
        style={{backgroundColor: colors.canvas, borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 10, color: colors.ink, marginTop: 9}}
      />
      <View style={{marginTop: 9}}>
        {renderButton(
          addingMember ? t('Adding…', 'சேர்க்கிறது…') : t('Add approved member', 'அனுமதிக்கப்பட்ட உறுப்பினரைச் சேர்'),
          () => void addMember(),
          false,
          addingMember || !newMemberName.trim() || !newMemberPhone.trim()
        )}
      </View>
    </View>

    <View style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 14}}>
      <Text style={{fontSize: 14, fontWeight: '900', color: colors.ink}}>{t('Approval column · all requests', 'அனுமதி பட்டியல் · அனைத்து கோரிக்கைகள்')}</Text>
      <Text style={{fontSize: 11, color: colors.inkMuted, marginTop: 4}}>{t('Pending, approved, rejected and revoked registrations remain visible here.', 'நிலுவை, அனுமதி, நிராகரிப்பு மற்றும் நீக்கப்பட்ட பதிவுகள் இங்கு காணப்படும்.')}</Text>
      {filteredMembers.length === 0 ? <Text style={{fontSize: 11, color: colors.inkMuted, marginTop: 8}}>{t('No matching viewer records.', 'பொருந்தும் பார்வையாளர் பதிவுகள் இல்லை.')}</Text> : null}
      {filteredMembers.map(item => {
        const canClear = !item.legacy && ['pending', 'rejected'].includes(item.status);
        const key = `access:${item.uid}`;
        const statusColor = item.status === 'approved' ? colors.primary : item.status === 'pending' ? colors.gold : colors.danger;
        return <View key={`member:${item.uid}`} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11, marginTop: 11}}>
          {canClear ? <TouchableOpacity onPress={() => toggle(setSelectedRequests, key)} style={{alignSelf: 'flex-start', marginBottom: 7}}>
            <Text style={{fontSize: 11, color: colors.primary, fontWeight: '800'}}>{selectedRequests.has(key) ? '✓ ' : '○ '}{t('Select request for clearing', 'அழிக்க கோரிக்கையைத் தேர்ந்தெடு')}</Text>
          </TouchableOpacity> : null}
          <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 8}}>
            <Text style={{flex: 1, fontSize: 14, fontWeight: '800', color: colors.ink}}>{item.fullName}</Text>
            <Text style={{fontSize: 10, fontWeight: '900', color: statusColor}}>{statusLabel(item.status, t)}</Text>
          </View>
          <Text selectable style={{fontSize: 12, color: colors.ink, marginTop: 5}}>{item.normalizedMobileNumber || t('Legacy viewer · no phone number on file', 'பழைய பார்வையாளர் · தொலைபேசி எண் இல்லை')}</Text>
          <Text selectable style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{t('UID', 'UID')}: {item.uid}</Text>
          <Text style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{t('Registered', 'பதிவு தேதி')}: {dateLabel(item.registeredAt)}{item.decisionAt ? ` · ${t('Last decision', 'கடைசி முடிவு')}: ${dateLabel(item.decisionAt)}` : ''}</Text>
          {item.approvalDate ? <Text style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{t('Approved', 'அனுமதிக்கப்பட்டது')}: {dateLabel(item.approvalDate)}</Text> : null}
          {item.manualInvite ? <Text style={{fontSize: 10, color: colors.gold, marginTop: 3}}>{t('Secure sign-in setup required', 'பாதுகாப்பான உள்நுழைவு அமைப்பு தேவை')}</Text> : null}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9}}>
            {item.status === 'pending' ? <>
              {renderButton(t('Approve', 'அனுமதி'), () => void decide(item, 'approved'))}
              {renderButton(t('Reject', 'நிராகரி'), () => setConfirmation({kind: 'reject', request: item}), true)}
            </> : null}
            {item.status === 'approved' ? renderButton(t('Revoke access', 'அணுகலை நீக்கு'), () => setConfirmation({kind: 'revoke', request: item}), true) : null}
            {item.status === 'revoked' && !item.legacy ? renderButton(t('Restore access', 'அணுகலை மீட்டமை'), () => void decide(item, 'approved')) : null}
            {renderButton(t('Delete Account', 'கணக்கை நீக்கு'), () => setConfirmation({kind: 'delete-account', request: item}), true)}
          </View>
        </View>;
      })}
      <View style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11, marginTop: 12}}>
        <Text style={{fontSize: 13, fontWeight: '900', color: colors.ink}}>{t('Approved Members', 'அனுமதிக்கப்பட்ட உறுப்பினர்கள்')} ({filteredMembers.filter(item => item.status === 'approved').length})</Text>
        {filteredMembers.filter(item => item.status === 'approved').map(item => <View key={`approved:${item.uid}`} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 8}}>
          <Text style={{fontSize: 12, fontWeight: '800', color: colors.ink}}>{item.fullName} · {item.normalizedMobileNumber || t('Legacy member', 'பழைய உறுப்பினர்')}</Text>
          <Text selectable style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{t('UID', 'UID')}: {item.uid} · {t('Approved', 'அனுமதி')}: {dateLabel(item.approvalDate)}{item.manualInvite ? ` · ${t('Secure sign-in setup required', 'பாதுகாப்பான உள்நுழைவு அமைப்பு தேவை')}` : ''}</Text>
        </View>)}
      </View>
      {recoveryRequests.length ? <View style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 12}}>
        <Text style={{fontSize: 13, fontWeight: '900', color: colors.ink}}>{t('Secure sign-in recovery', 'பாதுகாப்பான உள்நுழைவு மீட்பு')}</Text>
        {recoveryRequests.filter(item => !search.trim() || item.normalizedMobileNumber.toLowerCase().includes(search.trim().toLowerCase())).map(item => {
          const key = `recovery:${item.uid}`;
          const canClear = ['pending', 'rejected', 'restored'].includes(item.status);
          return <View key={key} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 9, marginTop: 9}}>
            {canClear ? <TouchableOpacity onPress={() => toggle(setSelectedRequests, key)} style={{alignSelf: 'flex-start'}}>
              <Text style={{fontSize: 11, color: colors.primary, fontWeight: '800'}}>{selectedRequests.has(key) ? '✓ ' : '○ '}{t('Select recovery history', 'மீட்பு வரலாற்றைத் தேர்ந்தெடு')}</Text>
            </TouchableOpacity> : null}
            <Text style={{fontSize: 12, fontWeight: '800', color: colors.ink, marginTop: 5}}>{item.normalizedMobileNumber} · {statusLabel(item.status, t)}</Text>
            <Text selectable style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{t('New session UID', 'புதிய அமர்வு UID')}: {item.uid}</Text>
            {item.status === 'pending' ? <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8}}>
              {renderButton(t('Restore verified session', 'சரிபார்த்த அமர்வை மீட்டமை'), () => void decideViewerRecovery(item, 'restore', ownerUid).catch(issue => setError(issue?.message || 'Recovery could not be restored.')))}
              {renderButton(t('Reject', 'நிராகரி'), () => void decideViewerRecovery(item, 'rejected', ownerUid).catch(issue => setError(issue?.message || 'Recovery could not be rejected.')), true)}
            </View> : null}
          </View>;
        })}
      </View> : null}
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12}}>
        {renderButton(`${t('Clear selected requests', 'தேர்ந்தெடுத்த கோரிக்கைகளை அழி')} (${selectedRequestCount})`, () => setConfirmation({kind: 'clear-selected-requests', count: selectedRequestCount}), true, selectedRequestCount === 0)}
      </View>
    </View>

    <View style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 14}}>
      <Text style={{fontSize: 14, fontWeight: '900', color: colors.ink}}>{t('All History', 'முழு வரலாறு')}</Text>
      <Text style={{fontSize: 11, lineHeight: 16, color: colors.inkMuted, marginTop: 4}}>
        {t('Registration, approval, rejection, revocation, recovery, account deletion and cleared-request events. Clearing history never removes an approved member or project data.', 'பதிவு, அனுமதி, நிராகரிப்பு, அணுகல் நீக்கம், மீட்பு, கணக்கு நீக்கம் மற்றும் அழிக்கப்பட்ட கோரிக்கை நிகழ்வுகள். வரலாற்றை அழிப்பது அனுமதிக்கப்பட்ட உறுப்பினர் அல்லது திட்டத் தரவை நீக்காது.')}
      </Text>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9}}>
        {renderButton(`${t('Clear selected events', 'தேர்ந்தெடுத்த நிகழ்வுகளை அழி')} (${selectedEvents.size})`, () => setConfirmation({kind: 'clear-selected-events', count: selectedEvents.size}), true, selectedEvents.size === 0)}
        {renderButton(`${t('Clear All History', 'முழு வரலாற்றையும் அழி')} (${eligibleHistoryCount})`, () => setConfirmation({kind: 'clear-all-history', count: eligibleHistoryCount}), true, eligibleHistoryCount === 0)}
      </View>
      {filteredEvents.map(event => {
        const label = event.id.startsWith('current-') ? t('Current member record', 'தற்போதைய உறுப்பினர் பதிவு') : ({
          registered: t('Registration', 'பதிவு'),
          approved: t('Approved', 'அனுமதி'),
          rejected: t('Rejected', 'நிராகரிப்பு'),
          revoked: t('Revoked', 'அணுகல் நீக்கம்'),
          recovery_requested: t('Recovery requested', 'மீட்பு கோரிக்கை'),
          recovery_rejected: t('Recovery rejected', 'மீட்பு நிராகரிப்பு'),
          recovery_restored: t('Recovery restored', 'மீட்பு நிறைவு'),
          history_cleared: t('Request history cleared', 'கோரிக்கை வரலாறு அழிக்கப்பட்டது'),
          account_deleted: t('Account deleted', 'கணக்கு நீக்கப்பட்டது')
        } as Record<string, string>)[event.action] || event.action;
        const canSelect = !event.id.startsWith('current-');
        return <View key={`event:${event.id}`} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 9, marginTop: 9}}>
          {canSelect ? <TouchableOpacity onPress={() => toggle(setSelectedEvents, event.id)} style={{alignSelf: 'flex-start'}}>
            <Text style={{fontSize: 10, color: colors.primary, fontWeight: '800'}}>{selectedEvents.has(event.id) ? '✓ ' : '○ '}{t('Select event', 'நிகழ்வைத் தேர்ந்தெடு')}</Text>
          </TouchableOpacity> : null}
          <Text style={{fontSize: 12, fontWeight: '800', color: colors.ink, marginTop: 4}}>{event.fullName || event.normalizedMobileNumber || t('Unknown member', 'அறியப்படாத உறுப்பினர்')} · {label}</Text>
          <Text style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{event.normalizedMobileNumber || '—'} · {statusLabel(event.status, t)} · {dateLabel(event.createdAt)}</Text>
        </View>;
      })}
      {filteredEvents.length === 0 ? <Text style={{fontSize: 11, color: colors.inkMuted, marginTop: 9}}>{t('No matching history.', 'பொருந்தும் வரலாறு இல்லை.')}</Text> : null}
    </View>

    <View style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 14}}>
      <Text style={{fontSize: 14, fontWeight: '900', color: colors.ink}}>{t('Device History', 'சாதன வரலாறு')}</Text>
      <Text style={{fontSize: 11, lineHeight: 16, color: colors.inkMuted, marginTop: 4}}>
        {t('Installation IDs identify an app/browser installation, not a physical device. A Firebase UID may be shared across installations; revoking one UID blocks all sessions using that UID on their next authorization check.', 'நிறுவல் அடையாளங்கள் செயலி/உலாவி நிறுவலைக் குறிக்கும்; உண்மையான சாதனத்தை உறுதிப்படுத்தாது. Firebase UID பல நிறுவல்களில் பகிரப்படலாம்; ஒரு UID-ஐ நீக்கினால் அடுத்த அணுகல் சரிபார்ப்பில் அதைப் பயன்படுத்தும் அனைத்து அமர்வுகளும் தடுக்கப்படும்.')}
      </Text>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9}}>
        {renderButton(`${t('Clear selected device history', 'தேர்ந்தெடுத்த சாதன வரலாற்றை அழி')} (${selectedDevices.size})`, () => setConfirmation({kind: 'clear-selected-devices', count: selectedDevices.size}), true, selectedDevices.size === 0)}
        {renderButton(t('Clear all device history', 'அனைத்து சாதன வரலாற்றையும் அழி'), () => setConfirmation({kind: 'clear-all-devices', count: deviceEntries.length}), true, deviceEntries.length === 0)}
      </View>
        {allMembers.filter(member => member.status === 'approved' && deviceEntries.some(entry => entry.userId === member.uid)).map(member => <View key={`devices-member:${member.uid}`} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 9, marginTop: 9}}>
          <Text style={{fontSize: 12, fontWeight: '800', color: colors.ink}}>{member.fullName} · {member.normalizedMobileNumber || '—'}</Text>
          <View style={{marginTop: 7}}>{renderButton(t('Revoke all devices for this member', 'இந்த உறுப்பினரின் அனைத்து சாதனங்களையும் நீக்கு'), () => setConfirmation({kind: 'revoke-member', request: member}), true)}</View>
        </View>)}
      {filteredDevices.map(entry => {
        const member = allMembers.find(item => item.uid === entry.userId);
        const canRevoke = member?.status === 'approved';
        return <View key={`device:${entry.id}`} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 9, marginTop: 9}}>
          <TouchableOpacity onPress={() => toggle(setSelectedDevices, entry.id)} style={{alignSelf: 'flex-start'}}>
            <Text style={{fontSize: 10, color: colors.primary, fontWeight: '800'}}>{selectedDevices.has(entry.id) ? '✓ ' : '○ '}{t('Select device record', 'சாதனப் பதிவைத் தேர்ந்தெடு')}</Text>
          </TouchableOpacity>
          <Text style={{fontSize: 12, fontWeight: '800', color: colors.ink, marginTop: 4}}>{member?.fullName || entry.displayName || t('Unknown member', 'அறியப்படாத உறுப்பினர்')} · {member?.normalizedMobileNumber || '—'}</Text>
          <Text style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{entry.deviceName} · {entry.deviceManufacturer} {entry.deviceModel} · {entry.platform}</Text>
          <Text selectable style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{t('Installation ID', 'நிறுவல் அடையாளம்')}: {entry.installationId} · {t('UID', 'UID')}: {entry.userId}</Text>
          <Text style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{t('Last activity', 'கடைசி செயல்பாடு')}: {loginHistoryDate(entry.lastActiveAt)} · {t('Session', 'அமர்வு')}: {entry.status || t('Legacy status untracked', 'பழைய நிலை கண்காணிக்கப்படவில்லை')} · {t('Access', 'அணுகல்')}: {member?.status ? statusLabel(member.status, t) : t('No active member record', 'செயலில் உள்ள உறுப்பினர் பதிவு இல்லை')}</Text>
          {canRevoke ? <View style={{marginTop: 8}}>{renderButton(t('Revoke this session UID access', 'இந்த அமர்வு UID அணுகலை நீக்கு'), () => setConfirmation({kind: 'revoke-session', entry}), true)}</View> : null}
        </View>;
      })}
      {filteredDevices.length === 0 ? <Text style={{fontSize: 11, color: colors.inkMuted, marginTop: 9}}>{t('No matching device history.', 'பொருந்தும் சாதன வரலாறு இல்லை.')}</Text> : null}
    </View>

    <Modal transparent visible={confirmation !== null} animationType="fade" onRequestClose={() => busy ? undefined : setConfirmation(null)}>
      <View style={{flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)'}}>
        <View style={{backgroundColor: colors.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: colors.border}}>
          <Text style={{fontSize: 17, fontWeight: '900', color: colors.ink}}>{t('Confirm owner action', 'உரிமையாளர் செயலை உறுதிப்படுத்தவும்')}</Text>
          <Text style={{fontSize: 12, lineHeight: 18, color: colors.inkMuted, marginTop: 8}}>{confirmationText(confirmation, t)}</Text>
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16}}>
            <TouchableOpacity disabled={busy} onPress={() => setConfirmation(null)} style={{borderRadius: 9, paddingVertical: 10, paddingHorizontal: 13, backgroundColor: colors.canvas}}>
              <Text style={{fontSize: 12, color: colors.ink, fontWeight: '800'}}>{t('Cancel', 'ரத்து')}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={() => void confirmAction()} style={{borderRadius: 9, paddingVertical: 10, paddingHorizontal: 13, backgroundColor: colors.danger, opacity: busy ? 0.6 : 1}}>
              <Text style={{fontSize: 12, color: '#FFF', fontWeight: '800'}}>{busy ? t('Working…', 'செயல்படுகிறது…') : t('Confirm', 'உறுதிப்படுத்து')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}

function timestampMillis(value: any): number {
  if (value?.toMillis) return value.toMillis();
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function confirmationText(action: ConfirmAction | null, t: (en: string, ta: string) => string): string {
  if (!action) return '';
  if (action.kind === 'clear-selected-requests') return t(
    `Permanently remove ${action.count} selected pending/rejected request or recovery records. Approved and revoked member records, approval status, authentication accounts and project data remain unchanged.`,
    `தேர்ந்தெடுத்த ${action.count} நிலுவை/நிராகரிப்பு கோரிக்கை அல்லது மீட்புப் பதிவுகளை நிரந்தரமாக நீக்கவும். அனுமதிக்கப்பட்ட/நீக்கப்பட்ட உறுப்பினர், அனுமதி நிலை, அங்கீகாரக் கணக்குகள் மற்றும் திட்டத் தரவு மாறாது.`
  );
  if (action.kind === 'clear-all-history') return t(
    `Clear ${action.count} eligible request/history records. Approved member profiles and active access will remain in the Approved Members list; project data and authentication accounts are not deleted.`,
    `${action.count} தகுதியான கோரிக்கை/வரலாற்றுப் பதிவுகளை அழிக்கவும். அனுமதிக்கப்பட்ட உறுப்பினர் மற்றும் செயலில் உள்ள அணுகல் பாதுகாக்கப்படும்; திட்டத் தரவும் அங்கீகாரக் கணக்குகளும் நீக்கப்படாது.`
  );
  if (action.kind === 'clear-selected-events') return t(`Permanently delete ${action.count} selected history event(s). This does not change membership or project data.`, `தேர்ந்தெடுத்த ${action.count} வரலாற்று நிகழ்வுகளை நீக்கவும். உறுப்பினர் அல்லது திட்டத் தரவு மாறாது.`);
  if (action.kind === 'clear-selected-devices') return t(`Delete ${action.count} selected device/session history records. This does not revoke member access.`, `தேர்ந்தெடுத்த ${action.count} சாதன/அமர்வு வரலாற்றுப் பதிவுகளை நீக்கவும். உறுப்பினர் அணுகல் நீக்கப்படாது.`);
  if (action.kind === 'clear-all-devices') return t(`Delete all device history records except the current owner's session. This does not revoke member access.`, `தற்போதைய உரிமையாளர் அமர்வைத் தவிர அனைத்து சாதன வரலாற்றுப் பதிவுகளையும் நீக்கவும். உறுப்பினர் அணுகல் நீக்கப்படாது.`);
  if (action.kind === 'reject') return t(`Reject ${action.request.fullName}'s pending registration. Access will remain blocked and the rejection will be retained in history.`, `${action.request.fullName} இன் நிலுவை பதிவை நிராகரிக்கவும். அணுகல் தடுக்கப்பட்டு நிராகரிப்பு வரலாற்றில் வைக்கப்படும்.`);
  if (action.kind === 'revoke') return t(`Revoke ${action.request.fullName}'s approved project access. The member record and revocation history are preserved.`, `${action.request.fullName} இன் திட்ட அணுகலை நீக்கவும். உறுப்பினர் பதிவும் நீக்க வரலாறும் பாதுகாக்கப்படும்.`);
  if (action.kind === 'revoke-session') return t(`Revoke access for Firebase UID ${action.entry.userId}. Because a UID may be shared across browsers, all sessions using this UID will lose project access on their next authorization check.`, `Firebase UID ${action.entry.userId} அணுகலை நீக்கவும். UID பல உலாவிகளில் பகிரப்படலாம்; அடுத்த சரிபார்ப்பில் அந்த UID-ஐப் பயன்படுத்தும் அனைத்து அமர்வுகளும் தடுக்கப்படும்.`);
  if (action.kind === 'revoke-member') return t(`Revoke all project access for ${action.request.fullName}. Every session using this member's Firebase UID will be blocked on its next authorization check.`, `${action.request.fullName} இன் அனைத்து திட்ட அணுகலையும் நீக்கவும். இந்த உறுப்பினரின் Firebase UID அமர்வுகள் அடுத்த சரிபார்ப்பில் தடுக்கப்படும்.`);
  if (action.kind === 'delete-account') return t(
    `Remove ${action.request.fullName}'s project membership/profile and eligible device/access records. The Firebase Authentication identity will remain; it may still sign in but will have no project access. This cannot be undone.`,
    `${action.request.fullName} இன் திட்ட உறுப்பினர்/சுயவிவரம் மற்றும் தொடர்புடைய சாதன/அணுகல் பதிவுகளை நீக்கவும். Firebase Authentication அடையாளம் நீடிக்கும்; திட்ட அணுகல் இன்றி உள்நுழையலாம். இதை மீட்டெடுக்க முடியாது.`
  );
  return '';
}
