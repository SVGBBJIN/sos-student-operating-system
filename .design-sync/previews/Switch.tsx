import React, { useState } from 'react';
import { Switch } from '@sos/design-system';

export function OnOff() {
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
      <Switch checked={a} onChange={() => setA((v) => !v)} label="Auto-approve" />
      <Switch checked={b} onChange={() => setB((v) => !v)} label="Notifications" />
      <Switch checked={false} onChange={() => {}} label="Disabled" disabled />
    </div>
  );
}
