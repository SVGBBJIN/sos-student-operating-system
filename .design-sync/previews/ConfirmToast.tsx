import React from 'react';
import { ConfirmToast } from '@sos/design-system';

export function LmsSubmission() {
  return (
    <ConfirmToast
      eyebrow="Google Classroom detected a submission"
      message={
        <>
          Did you submit <strong>Problem Set 4</strong>?
        </>
      }
      confirmLabel="Yes, mark done"
      rejectLabel="Not yet"
      onConfirm={() => {}}
      onReject={() => {}}
      footnote="Auto-confirming in 4:52"
    />
  );
}
