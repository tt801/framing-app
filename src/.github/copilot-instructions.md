# AI Agent Instructions for Framing App

## Project Overview
This is a React-based picture framing application that helps users visualize, quote, and manage custom framing orders. The app includes customer management, quotes/invoices, stock tracking, and an interactive visualizer.

## Architecture

### Core Components
- `VisualizerApp.tsx`: Main framing configuration and preview interface
- `App.tsx`: Route management and layout wrapper
- `lib/`: Core business logic and state management
  - `store.ts`: Central catalog management (frames, mats, glazing, etc.)
  - `customers.ts`, `quotes.ts`, `invoices.ts`: CRM functionality
  - `stock.ts`: Inventory tracking
  - `ai/`: Room visualization providers

### State Management Pattern
The app uses React hooks for state management with a consistent pattern:
```typescript
export function useX() {
  const [state, setState] = useState(() => load())
  useEffect(() => { save(state) }, [state])
  // ... operations that modify state
  return { state, operations... }
}
```

### Data Models
Key types are defined in `store.ts`:
- `Frame`: {id, name, pricePerMeter, faceWidthCm, color?}
- `Mat`: {id, name, pricePerSqM, color?}
- `Glazing`: {id, name, pricePerSqM}
- `PrintingMaterial`: {id, name, pricePerSqM}
- `Settings`: Company info, pricing rules, display preferences

## Common Tasks

### Adding New Features
1. For new data types:
   - Add type definitions to `store.ts`
   - Create storage key constant: `const STORAGE_KEY = 'feature_name_v1'`
   - Implement React hook following the state management pattern
2. For new UI components:
   - Place in `components/` if reusable, `pages/` if route-specific
   - Follow existing styling patterns using Tailwind CSS

### Working with Measurements
The app handles both metric and imperial units:
```typescript
const CM_PER_IN = 2.54
const cmToIn = (cm: number) => cm / CM_PER_IN
const inToCm = (inch: number) => inch * CM_PER_IN
```

### Price Calculations
Prices use the settings from the catalog:
- Base labor cost: `settings.labourBase`
- Margin multiplier: `settings.marginMultiplier`
- Material costs are per meter or per square meter

## File Structure Conventions
- `pages/`: Top-level route components
- `components/`: Reusable UI components
- `features/`: Feature-specific code
- `lib/`: Core business logic and utilities
- `assets/`: Static resources

## Development Workflow
1. The app uses Vite for development
2. AI features toggle between mock/real providers based on environment:
```typescript
if (import.meta.env.PROD) {
  setAiProvider(new RemoteProvider())
} else {
  setAiProvider(new LocalMockProvider())
}
```

## Important Notes
- All measurements internally use centimeters
- Prices are stored without currency formatting
- Local storage is used for persistence with version-tagged keys
- Error boundary wraps main content for graceful failure handling