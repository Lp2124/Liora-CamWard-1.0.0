'use client';

const AUTH_COMPLETE_MESSAGE = 'happyseeds:auth-complete';

export function openHappySeedsLogin(onComplete: () => void, next = '/'): Window | null {
  const width = 500;
  const height = 650;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  const popup = window.open(
    `/api/auth/login?next=${encodeURIComponent(next)}`,
    `happyseeds_auth_${crypto.randomUUID()}`,
    `popup=yes,width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
  );
  if (!popup) return null;

  let completed = false;

  function finish(): void {
    if (completed) return;
    completed = true;
    window.clearInterval(closedCheck);
    window.removeEventListener('message', receiveCompletion);
    onComplete();
  }

  function receiveCompletion(event: MessageEvent): void {
    if (event.origin !== window.location.origin || event.source !== popup) return;
    if (event.data?.type !== AUTH_COMPLETE_MESSAGE) return;
    finish();
  }

  window.addEventListener('message', receiveCompletion);

  // Poll for popup close — when closed call onComplete so the UI refreshes
  // even if the postMessage was blocked (e.g. popup blocker partial open,
  // or the user closed the window manually after completing sign-in).
  const closedCheck = window.setInterval(() => {
    if (!popup.closed) return;
    window.clearInterval(closedCheck);
    window.removeEventListener('message', receiveCompletion);
    // Always refresh auth state when popup closes, message or not.
    onComplete();
  }, 400);

  return popup;
}
