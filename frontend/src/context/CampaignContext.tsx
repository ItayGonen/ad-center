import { createContext, useContext, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import type { SpaceDetail } from '../services/spaces';

interface CampaignContextValue {
  spaces: SpaceDetail[];
  setSpaces: (spaces: SpaceDetail[]) => void;
  clear: () => void;
}

const CampaignContext = createContext<CampaignContextValue | null>(null);

export function CampaignProvider({ children }: { children: ReactNode }) {
  const [spaces, setSpacesState] = useState<SpaceDetail[]>([]);

  const setSpaces = useCallback((s: SpaceDetail[]) => {
    setSpacesState(s);
  }, []);

  const clear = useCallback(() => {
    setSpacesState([]);
  }, []);

  return (
    <CampaignContext.Provider value={{ spaces, setSpaces, clear }}>
      {children}
    </CampaignContext.Provider>
  );
}

export function useCampaignContext(): CampaignContextValue {
  const ctx = useContext(CampaignContext);
  if (!ctx) throw new Error('useCampaignContext must be used within CampaignProvider');
  return ctx;
}
