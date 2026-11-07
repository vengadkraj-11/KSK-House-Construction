export type PreferredLanguage = 'en' | 'ta';

export function getPreferredLanguage(
  storage: Pick<Storage, 'getItem'>,
  legacyKey?: string
): PreferredLanguage | null;

export function resolveProjectRole(
  membership: {projectId?: string; role?: string} | null | undefined,
  viewerAccess: {uid?: string; status?: string; approvalDate?: unknown} | null | undefined,
  accessExists: boolean,
  authenticatedUid: string
): 'owner' | 'viewer' | null;

export function savePreferredLanguage(
  storage: Pick<Storage, 'setItem'>,
  language: PreferredLanguage
): void;

export function shouldRenderFamilyViewer(
  pathname: string,
  role: 'owner' | 'viewer' | null,
  authenticated?: boolean
): boolean;
