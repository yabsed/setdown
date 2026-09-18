const OUTLINE_KEY = 'setdown:outline-open';

export function restoredOutlineOpen(): boolean {
  try {
    return sessionStorage.getItem(OUTLINE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function rememberOutlineOpen(open: boolean) {
  try {
    sessionStorage.setItem(OUTLINE_KEY, String(open));
  } catch {
    // Session storage can be unavailable in hardened browser environments.
  }
}
