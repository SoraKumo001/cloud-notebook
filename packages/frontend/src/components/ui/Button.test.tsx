import React, { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the TanStack Router Link to a plain anchor, so we don't need a router context.
vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    Link: React.forwardRef<
      HTMLAnchorElement,
      { to: string; children?: React.ReactNode; className?: string; [k: string]: unknown }
    >(function MockLink({ to, children, className, ...rest }, ref) {
      return createElement('a', { ref, href: to, className, ...rest }, children)
    }),
  }
})

// Dynamic import so the mock is applied before Button module is evaluated
const { Button } = await import('./Button')

// Stub icon component (matches lucide-react's prop shape)
function StubIcon(props: {
  size?: number
  strokeWidth?: number
  'aria-hidden'?: boolean
  className?: string
}) {
  return createElement('svg', {
    'data-testid': 'stub-icon',
    'data-size': props.size,
    'data-stroke': props.strokeWidth,
    'aria-hidden': props['aria-hidden'],
    className: props.className,
  })
}

async function renderButton(
  element: React.ReactElement,
): Promise<{ container: HTMLDivElement; unmount: () => void }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root: Root = createRoot(container)
  await act(async () => {
    root.render(element)
  })
  return {
    container,
    unmount: () => {
      root.unmount()
      document.body.removeChild(container)
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('Button', () => {
  it('renders a <button> by default', async () => {
    const { container, unmount } = await renderButton(createElement(Button, null, 'Click me'))
    const btn = container.querySelector('button')
    expect(btn).not.toBeNull()
    expect(btn?.textContent).toBe('Click me')
    unmount()
  })

  it('renders a <Link> (anchor) when as="link" to="..." is passed', async () => {
    const { container, unmount } = await renderButton(
      createElement(Button, { as: 'link', to: '/notebooks' }, 'Go'),
    )
    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('/notebooks')
    unmount()
  })

  describe('variants', () => {
    const variants: Array<
      ['primary' | 'neutral' | 'ghost' | 'error' | 'warning' | 'link', string]
    > = [
      ['primary', 'btn-primary'],
      ['neutral', 'btn-neutral'],
      ['ghost', 'btn-ghost'],
      ['error', 'btn-error'],
      ['warning', 'btn-warning'],
      ['link', 'link link-primary'],
    ]
    for (const [variant, expectedClass] of variants) {
      it(`variant="${variant}" produces class "${expectedClass}"`, async () => {
        const { container, unmount } = await renderButton(createElement(Button, { variant }, 'x'))
        const el = container.firstElementChild
        expect(el?.className).toContain(expectedClass)
        unmount()
      })
    }
  })

  describe('sizes', () => {
    it('size="xs" produces btn-xs', async () => {
      const { container, unmount } = await renderButton(createElement(Button, { size: 'xs' }, 'x'))
      expect(container.firstElementChild?.className).toContain('btn-xs')
      unmount()
    })

    it('size="sm" produces btn-sm', async () => {
      const { container, unmount } = await renderButton(createElement(Button, { size: 'sm' }, 'x'))
      expect(container.firstElementChild?.className).toContain('btn-sm')
      unmount()
    })

    it('size="md" produces no btn-size class', async () => {
      const { container, unmount } = await renderButton(createElement(Button, { size: 'md' }, 'x'))
      const cn = container.firstElementChild?.className ?? ''
      expect(cn).not.toContain('btn-xs')
      expect(cn).not.toContain('btn-sm')
      unmount()
    })

    it('link variant ignores size', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { as: 'link', to: '/x', variant: 'link', size: 'sm' }, 'x'),
      )
      const cn = container.firstElementChild?.className ?? ''
      expect(cn).not.toContain('btn-sm')
      unmount()
    })
  })

  describe('shape', () => {
    it('shape="circle" produces btn-circle', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { shape: 'circle', iconOnlyAriaLabel: 'close' }, 'x'),
      )
      expect(container.firstElementChild?.className).toContain('btn-circle')
      unmount()
    })

    it('shape="square" produces btn-square', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { shape: 'square', iconOnlyAriaLabel: 'close' }, 'x'),
      )
      expect(container.firstElementChild?.className).toContain('btn-square')
      unmount()
    })
  })

  describe('icons', () => {
    it('iconLeft as a component renders an SVG with size 18 for md', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { iconLeft: StubIcon }, 'Save'),
      )
      const svg = container.querySelector('svg[data-testid="stub-icon"]')
      expect(svg).not.toBeNull()
      expect(svg?.getAttribute('data-size')).toBe('18')
      expect(svg?.getAttribute('data-stroke')).toBe('2')
      expect(svg?.getAttribute('aria-hidden')).toBe('true')
      unmount()
    })

    it('iconLeft size scales with size prop: xs=14, sm=16, md=18', async () => {
      const sizes: Array<'xs' | 'sm' | 'md'> = ['xs', 'sm', 'md']
      const expected = [14, 16, 18]
      for (let i = 0; i < sizes.length; i++) {
        const { container, unmount } = await renderButton(
          createElement(Button, { size: sizes[i], iconLeft: StubIcon }, 'x'),
        )
        expect(container.querySelector('svg')?.getAttribute('data-size')).toBe(String(expected[i]))
        unmount()
      }
    })

    it('iconLeft as a ReactNode is rendered as-is', async () => {
      const { container, unmount } = await renderButton(
        createElement(
          Button,
          { iconLeft: createElement('span', { 'data-testid': 'prebuilt-icon' }, '★') },
          'x',
        ),
      )
      const prebuilt = container.querySelector('[data-testid="prebuilt-icon"]')
      expect(prebuilt).not.toBeNull()
      unmount()
    })

    it('iconRight renders after children', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { iconRight: StubIcon }, 'Next'),
      )
      const svgs = container.querySelectorAll('svg[data-testid="stub-icon"]')
      expect(svgs.length).toBe(1)
      unmount()
    })
  })

  describe('loading', () => {
    it('loading=true shows spinner and forces disabled', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { loading: true }, 'Saving'),
      )
      const spinner = container.querySelector('.loading.loading-spinner')
      expect(spinner).not.toBeNull()
      const btn = container.querySelector('button')
      expect(btn?.hasAttribute('disabled')).toBe(true)
      unmount()
    })

    it('loading=true sets aria-busy', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { loading: true }, 'Save'),
      )
      expect(container.querySelector('button')?.getAttribute('aria-busy')).toBe('true')
      unmount()
    })
  })

  describe('icon-only accessibility', () => {
    it('uses iconOnlyAriaLabel as aria-label and title when only icon, no children', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { iconLeft: StubIcon, iconOnlyAriaLabel: 'Close dialog' }),
      )
      const btn = container.querySelector('button')
      expect(btn?.getAttribute('aria-label')).toBe('Close dialog')
      expect(btn?.getAttribute('title')).toBe('Close dialog')
      unmount()
    })

    it('explicit title overrides iconOnlyAriaLabel', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, {
          iconLeft: StubIcon,
          iconOnlyAriaLabel: 'Close',
          title: 'Close this dialog',
        }),
      )
      const btn = container.querySelector('button')
      expect(btn?.getAttribute('title')).toBe('Close this dialog')
      unmount()
    })

    it('does not force iconOnlyAriaLabel when children are present', async () => {
      const { container, unmount } = await renderButton(
        createElement(
          Button,
          { iconLeft: StubIcon, iconOnlyAriaLabel: 'ignored-when-text' },
          'Visible label',
        ),
      )
      const btn = container.querySelector('button')
      expect(btn?.getAttribute('aria-label')).toBeNull()
      expect(btn?.getAttribute('title')).toBeNull()
      unmount()
    })
  })

  describe('className merging', () => {
    it('appends custom className to DaisyUI classes', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { className: 'rounded-xl px-5 text-sm font-medium' }, 'Save'),
      )
      const cn = container.firstElementChild?.className ?? ''
      expect(cn).toContain('rounded-xl')
      expect(cn).toContain('px-5')
      expect(cn).toContain('text-sm')
      expect(cn).toContain('font-medium')
      expect(cn).toContain('btn')
      expect(cn).toContain('btn-neutral')
      unmount()
    })
  })

  describe('spacing', () => {
    it('adds gap-2 when iconLeft and children both present', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { iconLeft: StubIcon }, 'With text'),
      )
      expect(container.firstElementChild?.className).toContain('gap-2')
      unmount()
    })

    it('adds gap-2 when iconRight and children both present', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { iconRight: StubIcon }, 'With text'),
      )
      expect(container.firstElementChild?.className).toContain('gap-2')
      unmount()
    })

    it('does not add gap-2 for icon-only', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { iconLeft: StubIcon, iconOnlyAriaLabel: 'x' }),
      )
      expect(container.firstElementChild?.className).not.toContain('gap-2')
      unmount()
    })
  })

  describe('type forwarding', () => {
    it('defaults to type="button"', async () => {
      const { container, unmount } = await renderButton(createElement(Button, null, 'x'))
      expect(container.querySelector('button')?.getAttribute('type')).toBe('button')
      unmount()
    })

    it('preserves caller type="submit"', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { type: 'submit' }, 'Submit'),
      )
      expect(container.querySelector('button')?.getAttribute('type')).toBe('submit')
      unmount()
    })
  })

  describe('disabled', () => {
    it('disabled prop forces disabled attribute', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { disabled: true }, 'x'),
      )
      expect(container.querySelector('button')?.hasAttribute('disabled')).toBe(true)
      unmount()
    })

    it('loading forces disabled even without disabled prop', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { loading: true }, 'x'),
      )
      expect(container.querySelector('button')?.hasAttribute('disabled')).toBe(true)
      unmount()
    })
  })

  describe('link loading', () => {
    it('loading=true on a link sets aria-disabled and tabIndex=-1', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { as: 'link', to: '/x', loading: true }, 'Go'),
      )
      const link = container.querySelector('a')
      expect(link).not.toBeNull()
      expect(link?.getAttribute('aria-disabled')).toBe('true')
      expect(link?.getAttribute('tabindex')).toBe('-1')
      unmount()
    })

    it('link without loading has no aria-disabled or forced tabindex', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { as: 'link', to: '/x' }, 'Go'),
      )
      const link = container.querySelector('a')
      expect(link?.getAttribute('aria-disabled')).toBeNull()
      expect(link?.getAttribute('tabindex')).toBeNull()
      unmount()
    })
  })

  describe('ref forwarding', () => {
    it('forwards a ref to the underlying <button> element', async () => {
      const ref = createRef<HTMLButtonElement>()
      const { container, unmount } = await renderButton(createElement(Button, { ref }, 'x'))
      expect(ref.current).toBe(container.querySelector('button'))
      unmount()
    })

    it('forwards a ref to the underlying <a> element when as="link"', async () => {
      const ref = createRef<HTMLAnchorElement>()
      const { container, unmount } = await renderButton(
        createElement(Button, { as: 'link', to: '/x', ref }, 'Go'),
      )
      expect(ref.current).toBe(container.querySelector('a'))
      unmount()
    })
  })

  describe('as prop does not leak to DOM', () => {
    it('as="link" does not appear as an attribute on the rendered <a>', async () => {
      const { container, unmount } = await renderButton(
        createElement(Button, { as: 'link', to: '/x' }, 'Go'),
      )
      const link = container.querySelector('a')
      expect(link?.hasAttribute('as')).toBe(false)
      unmount()
    })
  })
})
