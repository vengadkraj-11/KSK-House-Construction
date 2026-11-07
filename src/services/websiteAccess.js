const LANGUAGE_KEY = 'ksk_app_language';
const LEGACY_LANGUAGE_KEY = 'ksk_family_language';

function shouldRenderFamilyViewer(pathname, role, authenticated = false) {
  const normalizedPath = String(pathname || '').replace(/\/+$/, '') || '/';
  return (normalizedPath === '/family' && role !== 'owner') ||
    role === 'viewer' ||
    (authenticated && role !== 'owner');
}

function resolveProjectRole(membership, viewerAccess, accessExists = true, authenticatedUid = '') {
  if (membership?.projectId === 'ksk' && membership?.role === 'owner') return 'owner';
  if (viewerAccess?.uid === authenticatedUid &&
      viewerAccess?.status === 'approved' &&
      viewerAccess?.approvalDate &&
      (viewerAccess?.projectId === undefined || viewerAccess.projectId === 'ksk') &&
      (viewerAccess?.role === undefined || viewerAccess.role === 'viewer')) return 'viewer';
  if (!accessExists && membership?.projectId === 'ksk' && membership?.role === 'viewer') return 'viewer';
  return null;
}

function getPreferredLanguage(storage, legacyKey = LEGACY_LANGUAGE_KEY) {
  try {
    const saved = storage.getItem(LANGUAGE_KEY) || storage.getItem(legacyKey);
    return saved === 'en' || saved === 'ta' ? saved : null;
  } catch {
    return null;
  }
}

function savePreferredLanguage(storage, language) {
  if (language !== 'en' && language !== 'ta') {
    throw new Error('Choose English or Tamil.');
  }
  storage.setItem(LANGUAGE_KEY, language);
  storage.setItem(LEGACY_LANGUAGE_KEY, language);
}

module.exports = {
  getPreferredLanguage,
  resolveProjectRole,
  savePreferredLanguage,
  shouldRenderFamilyViewer
};
