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

class DOMMatrixReadOnlyMock {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  m11 = 1;
  m22 = 1;
  m41 = 0;
  m42 = 0;

  constructor(_transform?: string) {}

  inverse() {
    return this;
  }
}

Object.defineProperty(window, 'DOMMatrixReadOnly', {
  writable: true,
  value: DOMMatrixReadOnlyMock,
});

Object.defineProperty(globalThis, 'DOMMatrixReadOnly', {
  writable: true,
  value: DOMMatrixReadOnlyMock,
});

Object.defineProperty(window, 'DOMMatrix', {
  writable: true,
  value: DOMMatrixReadOnlyMock,
});

Object.defineProperty(globalThis, 'DOMMatrix', {
  writable: true,
  value: DOMMatrixReadOnlyMock,
});
