import { useState } from 'react';

/**
 * useCalendarSize — manages the four CalendarWindow size states.
 *
 * Sizes: 'fullscreen' | 'half-left' | 'half-right' | 'widget'
 */
export function useCalendarSize(defaultSize = 'fullscreen') {
  const [size, setSize] = useState(defaultSize);
  return { size, setSize };
}
