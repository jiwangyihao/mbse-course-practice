import '@testing-library/jest-dom/vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList,
});

const originalGetComputedStyle = window.getComputedStyle.bind(window);

Object.defineProperty(window, 'getComputedStyle', {
  writable: true,
  value: (element: Element, pseudoElement?: string | null): CSSStyleDeclaration => {
    if (pseudoElement) {
      return originalGetComputedStyle(element);
    }

    return originalGetComputedStyle(element);
  },
});

class ResizeObserverMock implements ResizeObserver {
  disconnect() {
    return undefined;
  }

  observe() {
    return undefined;
  }

  unobserve() {
    return undefined;
  }
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});

Object.defineProperty(globalThis, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});
