<p align="center">
  <img src="../docs/brand/splitin-logo.png" alt="SplitIn logo" width="96" height="96">
</p>

<h1 align="center">@splitin/react-mobile-interactions</h1>

<p align="center">
  <strong>Swipe, edge-back, overlays, and native-feeling motion for React.</strong>
</p>

<p align="center">
  <a href="https://github.com/splitintech/open-internal-tools/blob/main/react-mobile-interactions/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  <a href="https://www.npmjs.com/package/@splitin/react-mobile-interactions"><img src="https://img.shields.io/badge/npm-@splitin/react--mobile--interactions-cb3837" alt="npm package"></a>
  <a href="https://github.com/splitintech/open-internal-tools/tree/main/react-mobile-interactions"><img src="https://img.shields.io/badge/product-open--internal--tools-orange" alt="Open Internal Tools"></a>
</p>

<p align="center">
  <a href="../README.md">Hub</a>
  ·
  <a href="#getting-started">Docs</a>
  ·
  <a href="#swipe-tabs">Swipe</a>
  ·
  <a href="#overlay-back-layers">Back</a>
  ·
  <a href="https://www.splitin.net/careers-requests">Careers</a>
</p>

<p align="center">
  <img src="../docs/brand/login-banner.webp" alt="SplitIn login welcome art">
</p>

# Mobile interactions that feel native — package first, product later

Reusable React primitives for swipe gestures, edge-back navigation, overlay back layers, route transitions, and motion presets. V1 is **package-only**: install it, ship it, keep versioning it.

Built internally, open sourced so others can use the same gestures SplitIn uses. A tool specialist owns this folder end to end. It can stay MIT and later also power a hosted SplitIn experience.

- **Swipe tabs**: left forward, right back; inputs and maps ignored by default.
- **Overlay back stack**: highest priority layer wins.
- **Edge-swipe back**: router-agnostic, haptic when available.
- **Out of the box**: Framer Motion presets that respect `prefers-reduced-motion`.

## Table of contents

- [Getting started](#getting-started)
- [Swipe tabs](#swipe-tabs)
- [Overlay back layers](#overlay-back-layers)
- [Edge-swipe back](#edge-swipe-back)
- [Route transition](#route-transition)
- [Motion presets](#motion-presets)
- [Careers](#careers)

## Getting started

```sh
npm install @splitin/react-mobile-interactions framer-motion
```

Peer dependencies: `react`, `react-dom`, `framer-motion`.

From this hub (source only; `dist/` is gitignored):

```sh
git clone https://github.com/splitintech/open-internal-tools.git
cd open-internal-tools/react-mobile-interactions
npm install
npm run build
npm test
```

Work in sync with other contributors and agents. PRs stay in `react-mobile-interactions/`.

## Swipe tabs

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

## Overlay back layers

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

## Edge-swipe back

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

## Route transition

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

## Motion presets

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

## Careers

Own this package end to end — or explore SplitIn tech careers — at **[https://www.splitin.net/careers-requests](https://www.splitin.net/careers-requests)**.

<p align="center">
  <img src="../docs/brand/login-banner.webp" alt="SplitIn login welcome art">
</p>

## License

MIT. Free to use in personal, open-source, and commercial applications. See [LICENSE](LICENSE). Program rules: [CONTRIBUTING.md](../CONTRIBUTING.md).
