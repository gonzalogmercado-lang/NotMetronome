Dominio centralizado: `src/core/types/index.ts` concentra los tipos compartidos (Meter, TickInfo, AccentLevel, etc.) para evitar duplicaciones y desalineaciones.

Importá desde ahí en lugar de declarar tipos ad-hoc en cada módulo.
