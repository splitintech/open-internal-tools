# @splitin/react-mobile-interactions

Reusable React primitives for mobile swipe gestures, edge-back navigation, overlay back layers, route transitions, and native-feeling motion presets.

V1 is package-only.

## Development

This repository contains source only; build artifacts live in `dist/` after `npm run build` (ignored by git).

```sh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/react-mobile-interactions
npm install
npm run build
npm test
```

## Install

```sh
npm install @splitin/react-mobile-interactions framer-motion
```

Peer dependencies:

- `react`
- `react-dom`
- `framer-motion`

## Swipe Tabs

```tsx
import { useSwipeableTabs } from "@splitin/react-mobile-interactions";

function MobileTabs({ tab, setTab }: { tab: "details" | "activity"; setTab: (tab: "details" | "activity") => void }) {
  const swipe = useSwipeableTabs({
    values: ["details", "activity"],
    activeValue: tab,
    onValueChange: setTab,
  });

  return <section {...swipe.bind}>...</section>;
}
```

Left swipes move forward, right swipes move backward, and interactive controls such as inputs, buttons, media, tablists, maps, iframes, and canvases are ignored by default.

## Overlay Back Layers

```tsx
import {
  MobileBackProvider,
  useMobileBackController,
  useMobileBackLayer,
} from "@splitin/react-mobile-interactions";

function Sheet({ open, close }: { open: boolean; close: () => void }) {
  useMobileBackLayer({
    id: "sheet",
    priority: 20,
    enabled: open,
    onBack: () => {
      close();
      return true;
    },
  });

  return open ? <div role="dialog">...</div> : null;
}

function BackButton() {
  const controller = useMobileBackController();
  return <button onClick={() => controller.triggerBack()}>Back</button>;
}

export function App() {
  return (
    <MobileBackProvider>
      <BackButton />
      <Sheet open close={() => undefined} />
    </MobileBackProvider>
  );
}
```

Layers register by `id`; the highest enabled `priority` wins. If a layer returns `false` from `onBack`, the controller continues to the next enabled layer.

## Edge-Swipe Back

`MobileEdgeBackHandler` is router-agnostic. Wire the back behavior in user-land:

```tsx
import { MobileEdgeBackHandler } from "@splitin/react-mobile-interactions";
import { useNavigate } from "react-router-dom";

function RouterBackGesture() {
  const navigate = useNavigate();

  return (
    <MobileEdgeBackHandler
      onBack={() => navigate(-1)}
      canStart={() => window.history.length > 1}
    />
  );
}
```

The handler listens for left-edge touch swipes, prevents native horizontal scroll when the gesture clearly becomes a back swipe, triggers haptics when available, and calls `onBack` only after a committed right swipe.

## Route Transition

```tsx
import { MobileRouteTransition } from "@splitin/react-mobile-interactions";

export function MobilePage() {
  return (
    <MobileRouteTransition transitionKey="settings" direction="up">
      <main>...</main>
    </MobileRouteTransition>
  );
}
```

The default transition is a bottom sheet-up motion using `nativeSprings.smooth`. Set `active={false}` to render children directly.

## Motion Presets

```tsx
import {
  nativeDialogVariants,
  nativeOverlayVariants,
  nativeSheetVariants,
  nativeSprings,
  shouldAnimate,
} from "@splitin/react-mobile-interactions";
```

`shouldAnimate()` reads `prefers-reduced-motion` at runtime. Components should call it when deciding whether to apply motion-sensitive transforms.

## License

MIT. Free to use in personal, open-source, and commercial applications.
