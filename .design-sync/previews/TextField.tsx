import React from 'react';
import { TextField } from '@sos/design-system';

export function Basic() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: 260 }}>
      <TextField label="Assignment title" placeholder="e.g. Problem Set 4" />
      <TextField label="Due date" type="date" />
      <TextField label="Grade" hint="Must be 0–100" error placeholder="105" />
    </div>
  );
}
