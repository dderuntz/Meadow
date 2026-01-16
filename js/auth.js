// Simple auth check - redirects to login if not authenticated
// This is client-side only (not secure) - just a deterrent

const AUTH_KEY = 'meadow_auth';

// Use localStorage to persist across sessions (convenient for dev)
if (localStorage.getItem(AUTH_KEY) !== 'true') {
    window.location.href = 'login.html';
}
