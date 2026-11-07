import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Modal, Text, TouchableOpacity, View} from 'react-native';
import {
  clearViewerRequestHistory, decideViewerAccess, decideViewerRecovery, ensureViewerPhoneIndex, revokeLegacyViewer,
  subscribeLegacyViewers, subscribeViewerRecoveryRequests, subscribeViewerRequests,
  ViewerAccessRequest, ViewerRecoveryRequest, ViewerRequestHistoryItem
} from '../services/viewerAccess';
import {KSK_DESIGN} from '../theme/kskDesignSystem';

const colors = KSK_DESIGN.colors;
const dateLabel = (value: any) => {
  const date = value?.toDate?.();
  return date ? date.toLocaleString() : '—';
};

export default function ViewerAccessManagement({ownerUid, language}: {ownerUid: string; language: 'en' | 'ta'}) {
  const [requests, setRequests] = useState<ViewerAccessRequest[]>([]);
  const [legacyViewers, setLegacyViewers] = useState<ViewerAccessRequest[]>([]);
  const [recoveryRequests, setRecoveryRequests] = useState<ViewerRecoveryRequest[]>([]);
  const [error, setError] = useState('');
  const [historyMessage, setHistoryMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [workingUid, setWorkingUid] = useState('');
  const [selectedHistory, setSelectedHistory] = useState<Set<string>>(new Set());
  const [clearConfirmation, setClearConfirmation] = useState<{scope: 'selected' | 'all'; count: number} | null>(null);
  const [clearingHistory, setClearingHistory] = useState(false);
  const t = (en: string, ta: string) => language === 'ta' ? ta : en;

  useEffect(() => {
    const stopRequests = subscribeViewerRequests(items => {
      setRequests(items);
      setLoading(false);
      void Promise.all(items.map(ensureViewerPhoneIndex)).catch(issue => {
        setError(issue?.message || 'Existing viewer records could not be indexed.');
      });
    }, issue => {
      setError(issue.message);
      setLoading(false);
    });
    const stopLegacy = subscribeLegacyViewers(items => {
      setLegacyViewers(items);
      setLoading(false);
    }, issue => {
      setError(issue.message);
      setLoading(false);
    });
    const stopRecoveries = subscribeViewerRecoveryRequests(items => {
      setRecoveryRequests(items);
      setLoading(false);
    }, issue => {
      setError(issue.message);
      setLoading(false);
    });
    return () => {stopRequests(); stopLegacy(); stopRecoveries();};
  }, []);

  const clearableAccessRequests = requests.filter(item =>
    !item.legacy && (item.status === 'pending' || item.status === 'rejected')
  );
  const clearableRecoveryRequests = recoveryRequests.filter(item =>
    item.status === 'pending' || item.status === 'rejected' || item.status === 'restored'
  );
  const historyItems: {key: string; item: ViewerRequestHistoryItem}[] = [
    ...clearableAccessRequests.map(request => ({
      key: `access:${request.uid}`,
      item: {kind: 'access' as const, request}
    })),
    ...clearableRecoveryRequests.map(request => ({
      key: `recovery:${request.uid}`,
      item: {kind: 'recovery' as const, request}
    }))
  ];
  const selectedHistoryCount = historyItems.filter(item => selectedHistory.has(item.key)).length;

  const toggleHistorySelection = (key: string) => setSelectedHistory(current => {
    const updated = new Set(current);
    if (updated.has(key)) updated.delete(key);
    else updated.add(key);
    return updated;
  });

  const clearHistory = async () => {
    if (!clearConfirmation) return;
    const itemsToClear = historyItems
      .filter(item => clearConfirmation.scope === 'all' || selectedHistory.has(item.key))
      .map(item => item.item);
    setClearingHistory(true);
    setError('');
    setHistoryMessage('');
    try {
      const clearedCount = await clearViewerRequestHistory(itemsToClear);
      setSelectedHistory(new Set());
      setClearConfirmation(null);
      setHistoryMessage(t(
        `Cleared ${clearedCount} request history item${clearedCount === 1 ? '' : 's'}.`,
        `${clearedCount} கோரிக்கை வரலாற்றுப் பதிவுகள் அழிக்கப்பட்டன.`
      ));
    } catch (issue: any) {
      setError(issue?.message || t('Request history could not be cleared.', 'கோரிக்கை வரலாற்றை அழிக்க முடியவில்லை.'));
    } finally {
      setClearingHistory(false);
    }
  };

  const decide = async (item: ViewerAccessRequest, action: 'approved' | 'rejected' | 'revoked') => {
    setWorkingUid(item.uid);
    setError('');
    try {
      if (item.legacy) {
        if (action !== 'revoked') throw new Error('Legacy viewer access can only be revoked here.');
        await revokeLegacyViewer(item, ownerUid);
      } else {
        await decideViewerAccess(item, action, ownerUid);
      }
    } catch (issue: any) {
      setError(issue?.message || t('The access decision could not be saved.', 'அணுகல் முடிவைச் சேமிக்க முடியவில்லை.'));
    } finally {
      setWorkingUid('');
    }
  };
  const decideRecovery = async (item: ViewerRecoveryRequest, action: 'restore' | 'rejected') => {
    setWorkingUid(`recovery:${item.uid}`);
    setError('');
    try {
      await decideViewerRecovery(item, action, ownerUid);
    } catch (issue: any) {
      setError(issue?.message || t('The recovery decision could not be saved.', 'மீட்பு முடிவைச் சேமிக்க முடியவில்லை.'));
    } finally {
      setWorkingUid('');
    }
  };

  return <View style={{backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 16, marginBottom: 12}}>
    <Text style={{fontSize: 17, fontWeight: '900', color: colors.ink}}>{t('Viewer access management', 'பார்வையாளர் அணுகல் நிர்வாகம்')}</Text>
    <Text style={{fontSize: 12, lineHeight: 18, color: colors.inkMuted, marginTop: 6}}>
      {t('Mobile numbers are contact details and are not identity credentials. Verify the registrant independently before approval. Revocation immediately blocks future project reads.', 'மொபைல் எண்கள் தொடர்பு விவரங்கள் மட்டுமே; அடையாளச் சான்றுகள் அல்ல. அனுமதிக்கும் முன் பதிவுசெய்தவரைத் தனியாகச் சரிபார்க்கவும். அணுகலை நீக்கினால் திட்டத் தரவைப் படிப்பது உடனடியாகத் தடுக்கப்படும்.')}
    </Text>
    {loading ? <ActivityIndicator color={colors.primary} style={{margin: 16}}/> : null}
    {error ? <Text accessibilityRole="alert" style={{fontSize: 12, color: colors.danger, marginTop: 10}}>{error}</Text> : null}
    {historyMessage ? <Text style={{fontSize: 12, color: colors.primary, marginTop: 10}}>{historyMessage}</Text> : null}
    {!loading ? <View style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 12}}>
      <Text style={{fontSize: 14, fontWeight: '900', color: colors.ink}}>{t('Clear request history', 'கோரிக்கை வரலாற்றை அழிக்கவும்')}</Text>
      <Text style={{fontSize: 11, lineHeight: 16, color: colors.inkMuted, marginTop: 4}}>
        {t('Select pending or rejected registrations and recovery history. Approved and revoked family member records and access remain unchanged.', 'நிலுவையில் அல்லது நிராகரிக்கப்பட்ட பதிவுகள் மற்றும் மீட்பு வரலாற்றைத் தேர்ந்தெடுக்கவும். அனுமதிக்கப்பட்ட அல்லது நீக்கப்பட்ட குடும்ப உறுப்பினர் பதிவுகளும் அணுகலும் மாற்றப்படாது.')}
      </Text>
      {historyItems.length === 0 ? <Text style={{fontSize: 11, color: colors.inkMuted, marginTop: 8}}>{t('No eligible request history to clear.', 'அழிக்கத் தகுதியான கோரிக்கை வரலாறு இல்லை.')}</Text> : null}
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10}}>
        <TouchableOpacity disabled={selectedHistoryCount === 0 || clearingHistory} onPress={() => setClearConfirmation({scope: 'selected', count: selectedHistoryCount})} style={{backgroundColor: colors.dangerSoft, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12, opacity: selectedHistoryCount === 0 || clearingHistory ? 0.5 : 1}}>
          <Text style={{fontSize: 11, color: colors.danger, fontWeight: '800'}}>{t('Clear selected', 'தேர்ந்தெடுத்தவற்றை அழி')} ({selectedHistoryCount})</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled={historyItems.length === 0 || clearingHistory} onPress={() => setClearConfirmation({scope: 'all', count: historyItems.length})} style={{backgroundColor: colors.dangerSoft, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12, opacity: historyItems.length === 0 || clearingHistory ? 0.5 : 1}}>
          <Text style={{fontSize: 11, color: colors.danger, fontWeight: '800'}}>{t('Clear all eligible', 'தகுதியான அனைத்தையும் அழி')} ({historyItems.length})</Text>
        </TouchableOpacity>
      </View>
    </View> : null}
    {!loading && requests.length === 0 && legacyViewers.length === 0 && recoveryRequests.length === 0 && !error ? <Text style={{fontSize: 12, color: colors.inkMuted, marginTop: 12}}>{t('No viewer access requests yet.', 'பார்வையாளர் அணுகல் கோரிக்கைகள் எதுவும் இல்லை.')}</Text> : null}
    {[...requests, ...legacyViewers.filter(item => !requests.some(request => request.uid === item.uid))].map(item => {
      const busy = workingUid === item.uid;
      const clearable = !item.legacy && (item.status === 'pending' || item.status === 'rejected');
      const historyKey = `access:${item.uid}`;
      const canDecide = item.status === 'pending';
      const canRevoke = item.status === 'approved';
      const status = ({
        pending: t('PENDING', 'நிலுவையில்'),
        approved: t('APPROVED', 'அனுமதிக்கப்பட்டது'),
        rejected: t('REJECTED', 'நிராகரிக்கப்பட்டது'),
        revoked: t('REVOKED', 'நீக்கப்பட்டது')
      } as Record<string, string>)[item.status] || item.status;
      return <View key={item.uid} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 12}}>
        {clearable ? <TouchableOpacity accessibilityRole="button" accessibilityState={{selected: selectedHistory.has(historyKey)}} onPress={() => toggleHistorySelection(historyKey)} style={{alignSelf: 'flex-start', marginBottom: 8}}>
          <Text style={{fontSize: 11, color: colors.primary, fontWeight: '800'}}>{selectedHistory.has(historyKey) ? '✓ ' : '○ '}{t('Select request history', 'கோரிக்கை வரலாற்றைத் தேர்ந்தெடு')}</Text>
        </TouchableOpacity> : null}
        <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center'}}>
          <Text style={{flex: 1, fontSize: 14, fontWeight: '800', color: colors.ink}}>{item.fullName}</Text>
          <Text style={{fontSize: 10, fontWeight: '900', color: item.status === 'approved' ? colors.primary : item.status === 'pending' ? colors.gold : colors.danger}}>{status}</Text>
        </View>
        <Text selectable style={{fontSize: 12, color: colors.ink, marginTop: 5}}>{item.normalizedMobileNumber || t('Existing viewer account (no phone registration on record).', 'ஏற்கனவே உள்ள பார்வையாளர் கணக்கு (தொலைபேசி பதிவு இல்லை).')}</Text>
        <Text selectable style={{fontSize: 10, color: colors.inkMuted, marginTop: 4}}>{t('UID', 'பயனர் UID')}: {item.uid}</Text>
        {item.registeredAt ? <Text style={{fontSize: 10, color: colors.inkMuted, marginTop: 4}}>{t('Registered', 'பதிவு செய்த நாள்')}: {dateLabel(item.registeredAt)}</Text> : null}
        {item.approvalDate ? <Text style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{t('Approved', 'அனுமதிக்கப்பட்ட நாள்')}: {dateLabel(item.approvalDate)} · {item.approverUid}</Text> : null}
        {(canDecide || canRevoke || item.status === 'revoked') ? <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10}}>
          {canDecide ? <>
            <TouchableOpacity disabled={busy} onPress={() => void decide(item, 'approved')} style={{backgroundColor: colors.primary, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 13, opacity: busy ? 0.6 : 1}}>
              <Text style={{fontSize: 11, color: '#FFF', fontWeight: '800'}}>{busy ? t('Saving…', 'சேமிக்கிறது…') : t('Approve', 'அனுமதி')}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={() => void decide(item, 'rejected')} style={{backgroundColor: colors.dangerSoft, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 13, opacity: busy ? 0.6 : 1}}>
              <Text style={{fontSize: 11, color: colors.danger, fontWeight: '800'}}>{t('Reject', 'நிராகரி')}</Text>
            </TouchableOpacity>
          </> : null}
          {canRevoke ? <TouchableOpacity disabled={busy} onPress={() => void decide(item, 'revoked')} style={{backgroundColor: colors.dangerSoft, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 13, opacity: busy ? 0.6 : 1}}>
            <Text style={{fontSize: 11, color: colors.danger, fontWeight: '800'}}>{busy ? t('Saving…', 'சேமிக்கிறது…') : t('Revoke access', 'அணுகலை நீக்கு')}</Text>
          </TouchableOpacity> : null}
          {item.status === 'revoked' && !item.legacy ? <TouchableOpacity disabled={busy} onPress={() => void decide(item, 'approved')} style={{backgroundColor: colors.primarySoft, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 13, opacity: busy ? 0.6 : 1}}>
            <Text style={{fontSize: 11, color: colors.primary, fontWeight: '800'}}>{t('Restore access', 'அணுகலை மீட்டமை')}</Text>
          </TouchableOpacity> : null}
        </View> : null}
      </View>;
    })}
    {recoveryRequests.length ? <View style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14, marginTop: 14}}>
      <Text style={{fontSize: 14, fontWeight: '900', color: colors.ink}}>{t('Secure sign-in recovery', 'பாதுகாப்பான உள்நுழைவு மீட்பு')}</Text>
      <Text style={{fontSize: 11, lineHeight: 16, color: colors.inkMuted, marginTop: 5}}>
        {t('Independently verify the member before restoring. This transfers the existing approval and revokes the previous session; it does not create a new approval.', 'மீட்டமைப்பதற்கு முன் உறுப்பினரின் அடையாளத்தைத் தனியாகச் சரிபார்க்கவும். இது ஏற்கனவே உள்ள அனுமதியை மாற்றி முந்தைய அமர்வை நீக்கும்; புதிய அனுமதி உருவாக்காது.')}
      </Text>
      {recoveryRequests.map(item => {
        const busy = workingUid === `recovery:${item.uid}`;
        const clearable = item.status === 'pending' || item.status === 'rejected' || item.status === 'restored';
        const historyKey = `recovery:${item.uid}`;
        return <View key={`recovery:${item.uid}`} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 10}}>
          {clearable ? <TouchableOpacity accessibilityRole="button" accessibilityState={{selected: selectedHistory.has(historyKey)}} onPress={() => toggleHistorySelection(historyKey)} style={{alignSelf: 'flex-start', marginBottom: 8}}>
            <Text style={{fontSize: 11, color: colors.primary, fontWeight: '800'}}>{selectedHistory.has(historyKey) ? '✓ ' : '○ '}{t('Select recovery history', 'மீட்பு வரலாற்றைத் தேர்ந்தெடு')}</Text>
          </TouchableOpacity> : null}
          <Text style={{fontSize: 12, fontWeight: '800', color: colors.ink}}>{item.normalizedMobileNumber}</Text>
          <Text selectable style={{fontSize: 10, color: colors.inkMuted, marginTop: 3}}>{t('New session UID', 'புதிய அமர்வு UID')}: {item.uid} · {item.status.toUpperCase()}</Text>
          {item.status === 'pending' ? <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
            <TouchableOpacity disabled={busy} onPress={() => void decideRecovery(item, 'restore')} style={{backgroundColor: colors.primary, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12, opacity: busy ? 0.6 : 1}}>
              <Text style={{fontSize: 11, color: '#FFF', fontWeight: '800'}}>{busy ? t('Saving…', 'சேமிக்கிறது…') : t('Restore verified session', 'சரிபார்த்த அமர்வை மீட்டமை')}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={busy} onPress={() => void decideRecovery(item, 'rejected')} style={{backgroundColor: colors.dangerSoft, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12, opacity: busy ? 0.6 : 1}}>
              <Text style={{fontSize: 11, color: colors.danger, fontWeight: '800'}}>{t('Reject', 'நிராகரி')}</Text>
            </TouchableOpacity>
          </View> : null}
        </View>;
      })}
    </View> : null}
    <Modal transparent visible={clearConfirmation !== null} animationType="fade" onRequestClose={() => clearingHistory ? undefined : setClearConfirmation(null)}>
      <View style={{flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.45)'}}>
        <View style={{backgroundColor: colors.surface, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: colors.border}}>
          <Text style={{fontSize: 17, fontWeight: '900', color: colors.ink}}>{t('Confirm clearing request history', 'கோரிக்கை வரலாற்றை அழிப்பதை உறுதிப்படுத்தவும்')}</Text>
          <Text style={{fontSize: 12, lineHeight: 18, color: colors.inkMuted, marginTop: 8}}>
            {clearConfirmation?.scope === 'all'
              ? t(`Permanently clear all ${clearConfirmation.count} eligible history items?`, `தகுதியான ${clearConfirmation.count} வரலாற்றுப் பதிவுகளையும் நிரந்தரமாக அழிக்கவா?`)
              : t(`Permanently clear the ${clearConfirmation?.count ?? 0} selected history items?`, `தேர்ந்தெடுத்த ${clearConfirmation?.count ?? 0} வரலாற்றுப் பதிவுகளை நிரந்தரமாக அழிக்கவா?`)}
          </Text>
          <Text style={{fontSize: 11, lineHeight: 16, color: colors.inkMuted, marginTop: 6}}>
            {t('Approved and revoked member records, active access, authentication accounts, approval status, and project data will not be deleted.', 'அனுமதிக்கப்பட்ட அல்லது நீக்கப்பட்ட உறுப்பினர் பதிவுகள், செயலில் உள்ள அணுகல், அங்கீகாரக் கணக்குகள், அனுமதி நிலை மற்றும் திட்டத் தரவு நீக்கப்படாது.')}
          </Text>
          <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 16}}>
            <TouchableOpacity disabled={clearingHistory} onPress={() => setClearConfirmation(null)} style={{paddingVertical: 10, paddingHorizontal: 13}}>
              <Text style={{fontSize: 12, color: colors.inkMuted, fontWeight: '800'}}>{t('Cancel', 'ரத்துசெய்')}</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={clearingHistory} onPress={() => void clearHistory()} style={{backgroundColor: colors.danger, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 13, opacity: clearingHistory ? 0.6 : 1}}>
              <Text style={{fontSize: 12, color: '#FFF', fontWeight: '800'}}>{clearingHistory ? t('Clearing…', 'அழிக்கிறது…') : t('Clear history', 'வரலாற்றை அழி')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  </View>;
}
