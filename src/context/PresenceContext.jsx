import { createContext, useContext } from 'react';
import { usePresenceDetection } from '../hooks/usePresenceDetection';

export const PresenceContext = createContext({
  presenceState:  'PRESENT',
  trackingEnabled: true,
  toggleTracking: () => {},
  isTimerRunning: true,
  STATES: {
    PRESENT:      'PRESENT',
    GLANCED_AWAY: 'GLANCED_AWAY',
    AWAY:         'AWAY',
    ABSENT:       'ABSENT',
  },
});

export function PresenceProvider({ children }) {
  const value = usePresenceDetection();
  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence() {
  return useContext(PresenceContext);
}
