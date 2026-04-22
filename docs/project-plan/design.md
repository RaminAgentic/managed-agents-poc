# Design System & Style Guide

> **IMPORTANT:** Do not use arbitrary hex colors. Use ONLY the tokens defined below.
> All text/background pairs must meet WCAG AA contrast (4.5:1 body, 3:1 large text).

## Design System
**Style:** Modern — Contemporary, sleek, professional
**Reference:** Inspired by shadcn/ui, Vercel, Stripe

### Layout & Spacing Tokens
```css
:root {
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
}
```

### Shadow Tokens
```css
:root {
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1);
}
```

### Typography Scale
Format: size/line-height weight

| Element | Size | Line Height | Weight |
|---------|------|-------------|--------|
| H1 | 2.25rem | 1.2 | 700 |
| H2 | 1.75rem | 1.3 | 600 |
| H3 | 1.375rem | 1.35 | 600 |
| H4 | 1.125rem | 1.4 | 600 |
| Body | 0.9375rem | 1.6 | 400 |
| Body Small | 0.8125rem | 1.5 | 400 |
| Caption | 0.75rem | 1.5 | 500 |

### Transition Tokens
```css
:root {
  --transition-fast: 150ms ease-in-out;
  --transition-normal: 200ms ease-in-out;
  --transition-slow: 300ms ease-in-out;
}
```

### Design Guidelines
MODERN DESIGN PRINCIPLES (shadcn/ui / Vercel / Stripe style):
- Card-based layouts with subtle shadows for depth hierarchy
- Rounded corners (8-12px) on cards, inputs, buttons
- Clear visual hierarchy: primary action stands out, secondary recedes
- Buttons: solid fill for primary (primary color bg, white text), outline for secondary
- Hover states: darken bg 10%, add shadow elevation, smooth transitions
- Icons: solid or duo-tone (Lucide React), 20-24px default
- Layout: responsive grid (1-2-3 column), max-width 1200px
- Cards: white bg, subtle shadow, rounded, hover lifts (+shadow)
- Inputs: full border (1px), rounded, focus ring with primary color glow
- Tables: alternating row colors, sticky headers, hover highlight
- Dividers: use spacing OR subtle 1px borders, not both
- Badges/chips: rounded-full, muted bg + colored text
- Loading: skeleton loaders (pulsing gray blocks), NOT spinners

## Color Palette
**Scheme:** Ocean Blue — Professional blues

### Brand Color Scale
Use primary-500 as the default accent. Lighter (300-400) for hover backgrounds, darker (600-700) for active/focus.

```css
:root {
  /* Primary brand scale */
  --color-primary-50: #e3f2fd;
  --color-primary-100: #bbdefb;
  --color-primary-200: #90caf9;
  --color-primary-300: #64b5f6;
  --color-primary-400: #42a5f5;
  --color-primary-500: #2196f3;
  --color-primary-600: #1e88e5;
  --color-primary-700: #1976d2;
  --color-primary-800: #1565c0;
  --color-primary-900: #0d47a1;

  /* Accent scale */
  --color-accent-50: #e1f5fe;
  --color-accent-100: #b3e5fc;
  --color-accent-200: #81d4fa;
  --color-accent-300: #4fc3f7;
  --color-accent-400: #29b6f6;
  --color-accent-500: #03a9f4;
  --color-accent-600: #039be5;
  --color-accent-700: #0288d1;
  --color-accent-800: #0277bd;
  --color-accent-900: #01579b;
}
```

### Neutral Scale
```css
:root {
  --color-neutral-50: #fafbfc;
  --color-neutral-100: #f1f3f5;
  --color-neutral-200: #e4e7eb;
  --color-neutral-300: #cbd2d9;
  --color-neutral-400: #9aa5b1;
  --color-neutral-500: #7b8794;
  --color-neutral-600: #616e7c;
  --color-neutral-700: #52606d;
  --color-neutral-800: #3e4c59;
  --color-neutral-900: #1f2933;
}
```

### Semantic Color Roles
These are the tokens you should use in components — never raw hex values.

```css
:root {
  /* Backgrounds */
  --color-bg-page: #ffffff;
  --color-bg-surface: #f8fafc;
  --color-bg-elevated: #ffffff;
  --color-bg-subtle: #e3f2fd;

  /* Text */
  --color-text-primary: #1f2933;
  --color-text-secondary: #52606d;
  --color-text-muted: #7b8794;
  --color-text-inverse: #ffffff;
  --color-text-placeholder: #9aa5b1;

  /* On-colors (guaranteed WCAG AA contrast on colored backgrounds) */
  --color-on-primary: #ffffff;    /* text on primary bg */
  --color-on-secondary: #ffffff; /* text on accent bg */
  --color-on-success: #ffffff;
  --color-on-warning: #1f2933;
  --color-on-error: #ffffff;

  /* Borders */
  --color-border-subtle: #e4e7eb;
  --color-border-default: #cbd2d9;
  --color-border-strong: #9aa5b1;
  --color-border-focus: #2196f3;

  /* Status */
  --color-success: #4caf50;
  --color-success-bg: #e8f5e9;
  --color-warning: #ff9800;
  --color-warning-bg: #fff3e0;
  --color-error: #f44336;
  --color-error-bg: #ffebee;
  --color-info: #2196f3;
  --color-info-bg: #e3f2fd;

  /* Utility */
  --overlay-scrim: rgba(15,23,42,0.5);
  --focus-ring: 0 0 0 3px rgba(33,150,243,0.25);
}
```

### Component State Tokens
Pre-defined hover, pressed, and disabled states for common components.

```css
:root {
  /* Primary button */
  --btn-primary-bg: #2196f3;
  --btn-primary-hover: #1e88e5;
  --btn-primary-pressed: #1976d2;
  --btn-primary-text: #ffffff;

  /* Secondary/outline button */
  --btn-secondary-bg: transparent;
  --btn-secondary-hover: #e3f2fd;
  --btn-secondary-pressed: #bbdefb;
  --btn-secondary-text: #1976d2;

  /* Disabled (all components) */
  --disabled-bg: #e4e7eb;
  --disabled-text: #9aa5b1;

  /* Input fields */
  --input-bg: #ffffff;
  --input-border: #cbd2d9;
  --input-focus-border: #2196f3;
  --input-focus-ring: 0 0 0 3px rgba(33,150,243,0.15);

  /* Cards */
  --card-bg: #ffffff;
  --card-hover-bg: #f8fafc;
  --card-border: #e4e7eb;

  /* List rows / table rows */
  --row-hover: #f1f5f9;
  --row-selected: #e3f2fd;
}
```

### Quick Reference
| Component | Background | Text | Border | Hover |
|-----------|-----------|------|--------|-------|
| Page | bg-page | text-primary | — | — |
| Card | card-bg | text-primary | card-border | card-hover-bg |
| Primary Button | btn-primary-bg | btn-primary-text | — | btn-primary-hover |
| Secondary Button | btn-secondary-bg | btn-secondary-text | border-default | btn-secondary-hover |
| Input | input-bg | text-primary | input-border | — (focus: input-focus-border) |
| Success Alert | success-bg | success | border-subtle | — |
| Error Alert | error-bg | error | border-subtle | — |
| Disabled | disabled-bg | disabled-text | — | — |

## Typography
### Font Imports
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500;600;700&display=swap');
```

### Font Stacks
```css
:root {
  --font-heading: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace;
}
```

| Role | Font | Weights |
|------|------|---------|
| Headings | Inter | 300, 400, 500, 600, 700 |
| Body | Inter | 300, 400, 500, 600, 700 |
| Monospace | Fira Code | 300, 400, 500, 600, 700 |

## Component Library
**Library:** Material UI

### Installation
```bash
npm install @mui/material @emotion/react @emotion/styled @mui/icons-material
```

### Usage & Token Mapping
- Import from '@mui/material' (Button, TextField, Card, etc.)
- Use MUI's sx prop or styled() for custom styling
- Theme via createTheme() + ThemeProvider — map design tokens to MUI theme:
  - palette.primary.main = primary-500
  - palette.background.default = bg-page
  - palette.background.paper = bg-surface
  - typography.fontFamily = heading/body font-family
- Icons from '@mui/icons-material'
- Apply border-radius via theme.shape.borderRadius

## Accessibility Rules
- All text MUST use color pairs from the token system that meet WCAG AA contrast
- Body text on backgrounds: minimum 4.5:1 contrast ratio
- Large text (18px+ bold, 24px+ normal) on backgrounds: minimum 3:1
- Use `on-primary`, `on-secondary`, `on-success`, `on-warning`, `on-error` tokens for text on colored backgrounds
- Never use arbitrary hex colors — always reference a token
- Focus states must be visible: use `focus-ring` token
- Disabled states: use `disabled-bg` + `disabled-text` (reduced contrast is intentional)
