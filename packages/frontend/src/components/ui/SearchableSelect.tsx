import { Check, ChevronDown, Search } from 'lucide-react'
import * as React from 'react'
import { createPortal } from 'react-dom'

export interface SelectGroup {
  connectionId: string
  connectionName: string
  models: string[]
}

interface SearchableSelectProps {
  id?: string
  value: string
  onChange: (value: string) => void
  groups: SelectGroup[]
  placeholder?: string
  disabled?: boolean
  inheritLabel?: string // For 'inherit' (inherit settings) option
}

export function SearchableSelect({
  id,
  value,
  onChange,
  groups,
  placeholder = 'Select model...',
  disabled = false,
  inheritLabel,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const containerRef = React.useRef<HTMLDivElement>(null)
  const buttonRef = React.useRef<HTMLButtonElement>(null)
  const [coords, setCoords] = React.useState({ top: 0, left: 0, width: 0 })

  const handleToggle = () => {
    if (disabled) return
    if (!isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const dropdownHeight = 280 // Max height constraint in CSS
      const spaceBelow = window.innerHeight - rect.bottom
      const showAbove = spaceBelow < dropdownHeight && rect.top > dropdownHeight

      setCoords({
        top: showAbove ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      })
    }
    setIsOpen(!isOpen)
  }

  // Close when clicking outside or scrolling
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        // Also check if click is inside the portal dropdown
        const portalDropdown = document.getElementById('searchable-select-portal')
        if (portalDropdown && portalDropdown.contains(event.target as Node)) {
          return
        }
        setIsOpen(false)
      }
    }

    const handleScrollOrResize = (event: Event) => {
      const portalDropdown = document.getElementById('searchable-select-portal')
      if (portalDropdown && event.target instanceof Node && portalDropdown.contains(event.target)) {
        return
      }
      setIsOpen(false)
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      // Listen to scroll events in capture phase to catch scroll inside modals
      window.addEventListener('scroll', handleScrollOrResize, true)
      window.addEventListener('resize', handleScrollOrResize)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
  }, [isOpen])

  // Reset search when opening/closing
  React.useEffect(() => {
    if (!isOpen) {
      setSearch('')
    }
  }, [isOpen])

  // Find active selected label
  const getSelectedLabel = () => {
    if (value === 'inherit' && inheritLabel) {
      return inheritLabel
    }
    for (const group of groups) {
      for (const m of group.models) {
        const fullVal = `${group.connectionId}:${m}`
        if (fullVal === value || (group.connectionId === 'workers-ai' && m === value)) {
          return m
        }
      }
    }
    return value || placeholder
  }

  // Filter groups and models based on search term
  const filteredGroups = React.useMemo(() => {
    const term = search.toLowerCase().trim()
    if (!term) return groups

    return groups
      .map((group) => {
        const matchingModels = group.models.filter((m) =>
          m.toLowerCase().includes(term)
        )
        return {
          ...group,
          models: matchingModels,
        }
      })
      .filter((group) => group.models.length > 0)
  }, [groups, search])

  const handleSelect = (val: string) => {
    onChange(val)
    setIsOpen(false)
  }

  // Dropdown menu content rendered inside React Portal
  const dropdownMenu = isOpen && (
    <div
      id="searchable-select-portal"
      className="fixed z-[9999] bg-base-100 border border-base-300 rounded-xl shadow-2xl overflow-hidden flex flex-col transition-opacity duration-150 animate-in fade-in duration-100"
      style={{
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        width: `${coords.width}px`,
        maxHeight: '280px',
      }}
    >
      {/* Search Input */}
      <div className="p-2 border-b border-base-300 flex items-center gap-2 bg-base-200/50">
        <Search size={14} className="text-base-content/40 shrink-0" />
        <input
          type="text"
          placeholder="Search models..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-transparent border-none text-sm focus:outline-none text-base-content"
          // biome-ignore lint/a11y/noAutofocus: user opens select intending to search
          autoFocus
        />
      </div>

      {/* Options List */}
      <div className="overflow-y-auto py-1 flex-1">
        {inheritLabel && (
          <button
            type="button"
            onClick={() => handleSelect('inherit')}
            className="w-full flex items-center justify-between px-4 py-2 text-sm text-left hover:bg-base-200 text-base-content transition-colors duration-150"
          >
            <span className="font-semibold text-primary">{inheritLabel}</span>
            {value === 'inherit' && <Check size={14} className="text-primary" />}
          </button>
        )}

        {filteredGroups.length === 0 ? (
          <div className="px-4 py-3 text-sm text-base-content/50 text-center">
            No models found
          </div>
        ) : (
          filteredGroups.map((group) => (
            <div key={group.connectionId} className="border-t border-base-300/40 first:border-t-0">
              <div className="px-3 py-1.5 text-[11px] font-bold tracking-wider text-base-content/40 bg-base-200/20 uppercase">
                {group.connectionName}
              </div>
              <div className="py-1">
                {group.models.map((m) => {
                  const fullVal = `${group.connectionId}:${m}`
                  const isSelected = value === fullVal || (group.connectionId === 'workers-ai' && m === value)

                  return (
                    <button
                      key={`${group.connectionId}:${m}`}
                      type="button"
                      onClick={() => handleSelect(fullVal)}
                      className={`w-full flex items-center justify-between px-5 py-2 text-sm text-left transition-colors duration-150 ${
                        isSelected ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-base-200 text-base-content/80'
                      }`}
                    >
                      <span className="truncate">{m}</span>
                      {isSelected && <Check size={14} className="text-primary shrink-0" />}
                    </button>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )

  return (
    <div ref={containerRef} className="relative w-full text-left" id={id}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-4 py-2 text-sm bg-base-200 border border-base-300 rounded-xl hover:bg-base-300/50 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 min-h-[42px]"
      >
        <span className="truncate text-base-content font-medium">{getSelectedLabel()}</span>
        <ChevronDown size={16} className={`text-base-content/50 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && createPortal(dropdownMenu, document.body)}
    </div>
  )
}
