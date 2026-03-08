# Blueprint: Secure Authentication Flow

## Configuration
- **Provider:** Supabase or Firebase (Default to Supabase).
- **Security:** Use HTTPS only; enforce password strength (8+ chars).

## Integration
- **Frontend:** Place the login modal in `src/components/AuthModal.html`.
- **Logic:** Handle session persistence in `src/lib/auth_service.js`.
- **Redirects:** Unauthenticated users trying to access "Dashboard" must be kicked back to the "Landing Page" hero.