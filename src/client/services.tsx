import React, { createContext, useContext } from 'react';
import type { DirectoryPickerPort } from './directory-picker.js';

const DirectoryPickerContext = createContext<DirectoryPickerPort | null>(null);

export function DirectoryPickerProvider({ picker, children }: { picker: DirectoryPickerPort | null; children: React.ReactNode }) {
  return <DirectoryPickerContext.Provider value={picker}>{children}</DirectoryPickerContext.Provider>;
}

/** A missing picker is a valid state: the UI keeps manual path entry available. */
export function useDirectoryPicker(): DirectoryPickerPort | null {
  return useContext(DirectoryPickerContext);
}
