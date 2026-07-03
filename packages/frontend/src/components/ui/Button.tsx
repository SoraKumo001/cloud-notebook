import { Link } from '@tanstack/react-router'
import React, { forwardRef } from 'react'

// `lucide-react@1.22.0` doesn't export a clean `LucideIcon` type, so we accept
// any component that takes these props (matching lucide's standard signature).
export type ButtonIconComponent = React.ComponentType<{
  size?: number
  strokeWidth?: number
  'aria-hidden'?: boolean
  className?: string
}>

export type ButtonVariant = 'primary' | 'neutral' | 'ghost' | 'error' | 'warning' | 'link'

export type ButtonSize = 'xs' | 'sm' | 'md'

export type ButtonShape = 'default' | 'circle' | 'square'

export type ButtonIconSlot = ButtonIconComponent | React.ReactNode

interface BaseProps {
  variant?: ButtonVariant
  size?: ButtonSize
  shape?: ButtonShape
  loading?: boolean
  iconLeft?: ButtonIconSlot
  iconRight?: ButtonIconSlot
  iconOnlyAriaLabel?: string
  className?: string
  title?: string
  children?: React.ReactNode
}

export type ButtonAsButtonProps = BaseProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof BaseProps> & {
    as?: 'button'
  }

export type ButtonAsLinkProps = BaseProps &
  Omit<React.ComponentProps<typeof Link>, keyof BaseProps> & {
    as: 'link'
    to: string
  }

export type ButtonProps = ButtonAsButtonProps | ButtonAsLinkProps

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

function variantClass(variant: ButtonVariant): string {
  switch (variant) {
    case 'primary':
      return 'btn-primary'
    case 'neutral':
      return 'btn-neutral'
    case 'ghost':
      return 'btn-ghost'
    case 'error':
      return 'btn-error'
    case 'warning':
      return 'btn-warning'
    case 'link':
      return 'link link-primary'
  }
}

function sizeClass(size: ButtonSize, isLink: boolean): string {
  if (isLink) return ''
  if (size === 'xs') return 'btn-xs'
  if (size === 'sm') return 'btn-sm'
  return ''
}

function shapeClass(shape: ButtonShape, isLink: boolean): string {
  if (isLink) return ''
  if (shape === 'circle') return 'btn-circle'
  if (shape === 'square') return 'btn-square'
  return ''
}

function iconSizeForButtonSize(size: ButtonSize): number {
  if (size === 'xs') return 14
  if (size === 'sm') return 16
  return 18
}

function renderIcon(icon: ButtonIconSlot, size: ButtonSize, key: string): React.ReactNode {
  if (!icon) return null
  // Function components (incl. forwardRef without a `.render` property) and
  // React.memo/React.lazy wrappers are all "callable component types" — render
  // them with our standard size/strokeWidth props.
  if (typeof icon === 'function') {
    const Icon = icon as ButtonIconComponent
    return (
      <Icon
        key={key}
        size={iconSizeForButtonSize(size)}
        strokeWidth={2}
        aria-hidden='true'
        className='flex-shrink-0'
      />
    )
  }
  if (typeof icon === 'object' && icon !== null) {
    const obj = icon as Record<string, unknown>
    // forwardRef components (lucide-react) have a `.render` method
    if (typeof obj.render === 'function') {
      const Icon = icon as unknown as ButtonIconComponent
      return (
        <Icon
          key={key}
          size={iconSizeForButtonSize(size)}
          strokeWidth={2}
          aria-hidden='true'
          className='flex-shrink-0'
        />
      )
    }
    // Already-rendered React element — render as-is
    if (React.isValidElement(icon)) {
      return (
        <span key={key} className='flex-shrink-0 inline-flex'>
          {icon}
        </span>
      )
    }
  }
  // Fallback: treat as opaque ReactNode
  return (
    <span key={key} className='flex-shrink-0 inline-flex'>
      {icon as React.ReactNode}
    </span>
  )
}

function isIconOnly(hasIconLeft: boolean, hasIconRight: boolean, hasChildren: boolean): boolean {
  return !hasChildren && (hasIconLeft || hasIconRight)
}

const ButtonInner = forwardRef<HTMLButtonElement, ButtonAsButtonProps>(
  function ButtonInner(props, ref) {
    const {
      variant = 'neutral',
      size = 'md',
      shape = 'default',
      loading = false,
      iconLeft,
      iconRight,
      iconOnlyAriaLabel,
      className,
      title,
      children,
      type,
      disabled,
      as: _as,
      ...rest
    } = props

    const isLink = false
    const hasIconLeft = Boolean(iconLeft) || loading
    const hasIconRight = Boolean(iconRight)
    const hasChildren = Boolean(children)
    const onlyIcon = isIconOnly(hasIconLeft && !loading, hasIconRight, hasChildren)

    const base = variant === 'link' ? '' : 'btn'
    const classes = cx(
      base,
      variantClass(variant),
      sizeClass(size, isLink),
      shapeClass(shape, isLink),
      hasIconLeft && hasChildren && 'gap-2',
      hasIconRight && hasChildren && 'gap-2',
      className,
    )

    const spinnerColor =
      variant === 'primary' || variant === 'error' || variant === 'warning'
        ? 'text-white'
        : 'text-base-content/50'

    const ariaLabel = onlyIcon ? iconOnlyAriaLabel : rest['aria-label']
    const computedTitle = title ?? (onlyIcon ? iconOnlyAriaLabel : undefined)

    const finalType = type ?? 'button'
    const finalDisabled = loading || disabled

    return (
      <button
        ref={ref}
        type={finalType}
        className={classes}
        disabled={finalDisabled}
        aria-label={ariaLabel}
        aria-busy={loading || undefined}
        title={computedTitle}
        {...rest}
      >
        {loading ? (
          <span
            key='spinner'
            className={`loading loading-spinner loading-${size === 'xs' ? 'xs' : 'sm'} ${spinnerColor} flex-shrink-0`}
          />
        ) : (
          renderIcon(iconLeft as ButtonIconSlot, size, 'iconLeft')
        )}
        {children}
        {!loading && renderIcon(iconRight as ButtonIconSlot, size, 'iconRight')}
      </button>
    )
  },
)

const LinkButtonInner = forwardRef<HTMLAnchorElement, ButtonAsLinkProps>(
  function LinkButtonInner(props, ref) {
    const {
      variant = 'neutral',
      size = 'md',
      shape = 'default',
      loading = false,
      iconLeft,
      iconRight,
      iconOnlyAriaLabel,
      className,
      title,
      children,
      as: _as,
      ...rest
    } = props

    const isLink = true
    const hasIconLeft = Boolean(iconLeft) || loading
    const hasIconRight = Boolean(iconRight)
    const hasChildren = Boolean(children)
    const onlyIcon = isIconOnly(hasIconLeft && !loading, hasIconRight, hasChildren)

    const base = variant === 'link' ? '' : 'btn'
    const classes = cx(
      base,
      variantClass(variant),
      sizeClass(size, isLink),
      shapeClass(shape, isLink),
      hasIconLeft && hasChildren && 'gap-2',
      hasIconRight && hasChildren && 'gap-2',
      className,
    )

    const ariaLabel = onlyIcon ? iconOnlyAriaLabel : rest['aria-label']
    const computedTitle = title ?? (onlyIcon ? iconOnlyAriaLabel : undefined)

    return (
      <Link
        ref={ref}
        to={props.to}
        className={classes}
        aria-label={ariaLabel}
        aria-busy={loading || undefined}
        aria-disabled={loading || undefined}
        title={computedTitle}
        tabIndex={loading ? -1 : undefined}
        {...rest}
      >
        {loading ? (
          <span
            key='spinner'
            className={`loading loading-spinner loading-${size === 'xs' ? 'xs' : 'sm'} text-base-content/50 flex-shrink-0`}
          />
        ) : (
          renderIcon(iconLeft as ButtonIconSlot, size, 'iconLeft')
        )}
        {children}
        {!loading && renderIcon(iconRight as ButtonIconSlot, size, 'iconRight')}
      </Link>
    )
  },
)

export function Button(props: ButtonProps): JSX.Element {
  if (props.as === 'link') {
    return <LinkButtonInner {...props} to={props.to} />
  }
  return <ButtonInner {...props} />
}
