import React from 'react';
import {
  DEFAULT_UI_STATE,
  ExportCartItem,
  GroupMode,
  ExploreUiState,
  LibraryUiState,
  SearchUiState,
  ReviewUiState,
  UiState,
  cartItemKey,
  loadUiState,
  saveUiState,
} from '../lib/uiState';

type UiStateContextValue = {
  state: UiState;
  setLibrary: (patch: Partial<LibraryUiState>) => void;
  setSearch: (patch: Partial<SearchUiState>) => void;
  setExplore: (patch: Partial<ExploreUiState>) => void;
  setReview: (patch: Partial<ReviewUiState>) => void;
  setExportTagIds: (tagIds: number[]) => void;
  addToCart: (items: ExportCartItem[]) => void;
  removeFromCart: (lightSchemaId: number) => void;
  clearCart: () => void;
  isInCart: (lightSchemaId: number) => boolean;
  toggleCart: (item: ExportCartItem) => void;
  cartCount: number;
};

const UiStateContext = React.createContext<UiStateContextValue | null>(null);

export function UiStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<UiState>(() => loadUiState());

  React.useEffect(() => {
    saveUiState(state);
  }, [state]);

  const setLibrary = React.useCallback((patch: Partial<LibraryUiState>) => {
    setState((prev) => ({ ...prev, library: { ...prev.library, ...patch } }));
  }, []);

  const setSearch = React.useCallback((patch: Partial<SearchUiState>) => {
    setState((prev) => ({ ...prev, search: { ...prev.search, ...patch } }));
  }, []);

  const setExplore = React.useCallback((patch: Partial<ExploreUiState>) => {
    setState((prev) => ({ ...prev, explore: { ...prev.explore, ...patch } }));
  }, []);

  const setReview = React.useCallback((patch: Partial<ReviewUiState>) => {
    setState((prev) => ({ ...prev, review: { ...prev.review, ...patch } }));
  }, []);

  const setExportTagIds = React.useCallback((tagIds: number[]) => {
    setState((prev) => ({ ...prev, exportCart: { ...prev.exportCart, tagIds } }));
  }, []);

  const addToCart = React.useCallback((items: ExportCartItem[]) => {
    setState((prev) => {
      const map = new Map(prev.exportCart.items.map((item) => [cartItemKey(item), item]));
      for (const item of items) map.set(cartItemKey(item), item);
      return { ...prev, exportCart: { ...prev.exportCart, items: [...map.values()] } };
    });
  }, []);

  const removeFromCart = React.useCallback((lightSchemaId: number) => {
    setState((prev) => ({
      ...prev,
      exportCart: {
        ...prev.exportCart,
        items: prev.exportCart.items.filter((item) => item.lightSchemaId !== lightSchemaId),
      },
    }));
  }, []);

  const clearCart = React.useCallback(() => {
    setState((prev) => ({ ...prev, exportCart: { items: [], tagIds: [] } }));
  }, []);

  const isInCart = React.useCallback(
    (lightSchemaId: number) => state.exportCart.items.some((item) => item.lightSchemaId === lightSchemaId),
    [state.exportCart.items],
  );

  const toggleCart = React.useCallback((item: ExportCartItem) => {
    setState((prev) => {
      const exists = prev.exportCart.items.some((row) => row.lightSchemaId === item.lightSchemaId);
      return {
        ...prev,
        exportCart: {
          ...prev.exportCart,
          items: exists
            ? prev.exportCart.items.filter((row) => row.lightSchemaId !== item.lightSchemaId)
            : [...prev.exportCart.items, item],
        },
      };
    });
  }, []);

  const value: UiStateContextValue = {
    state,
    setLibrary,
    setSearch,
    setExplore,
    setReview,
    setExportTagIds,
    addToCart,
    removeFromCart,
    clearCart,
    isInCart,
    toggleCart,
    cartCount: state.exportCart.items.length,
  };

  return <UiStateContext.Provider value={value}>{children}</UiStateContext.Provider>;
}

export function useUiState() {
  const ctx = React.useContext(UiStateContext);
  if (!ctx) throw new Error('useUiState must be used within UiStateProvider');
  return ctx;
}

export type { GroupMode };
