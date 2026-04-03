import React, { createContext, useContext, useMemo, useState } from 'react';

const EditModeContext = createContext(null);

export function EditModeProvider({ children, initialIsEditMode = false }) {
  const [isEditMode, setIsEditMode] = useState(initialIsEditMode);
  const [selectedEditableId, setSelectedEditableId] = useState(null);

  const value = useMemo(() => ({
    isEditMode,
    setIsEditMode,
    selectedEditableId,
    setSelectedEditableId,
  }), [isEditMode, selectedEditableId]);

  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>;
}

export function useEditModeContext() {
  const context = useContext(EditModeContext);

  if (!context) {
    throw new Error('useEditModeContext must be used inside EditModeProvider');
  }

  return context;
}
