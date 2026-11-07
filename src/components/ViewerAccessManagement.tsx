import React, {useEffect, useState} from 'react';
import {ActivityIndicator, Text, TouchableOpacity, View} from 'react-native';
import {
  decideViewerAccess, decideViewerRecovery, ensureViewerPhoneIndex, revokeLegacyViewer,
  subscribeLegacyViewers, subscribeViewerRecoveryRequests, subscribeViewerRequests,
  ViewerAccessRequest, ViewerRecoveryRequest
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
  const [loading, setLoading] = useState(true);
  const [workingUid, setWorkingUid] = useState('');
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
    {!loading && requests.length === 0 && legacyViewers.length === 0 && recoveryRequests.length === 0 && !error ? <Text style={{fontSize: 12, color: colors.inkMuted, marginTop: 12}}>{t('No viewer access requests yet.', 'பார்வையாளர் அணுகல் கோரிக்கைகள் எதுவும் இல்லை.')}</Text> : null}
    {[...requests, ...legacyViewers.filter(item => !requests.some(request => request.uid === item.uid))].map(item => {
      const busy = workingUid === item.uid;
      const canDecide = item.status === 'pending';
      const canRevoke = item.status === 'approved';
      const status = ({
        pending: t('PENDING', 'நிலுவையில்'),
        approved: t('APPROVED', 'அனுமதிக்கப்பட்டது'),
        rejected: t('REJECTED', 'நிராகரிக்கப்பட்டது'),
        revoked: t('REVOKED', 'நீக்கப்பட்டது')
      } as Record<string, string>)[item.status] || item.status;
      return <View key={item.uid} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12, marginTop: 12}}>
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
        return <View key={`recovery:${item.uid}`} style={{borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, marginTop: 10}}>
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
  </View>;
}
