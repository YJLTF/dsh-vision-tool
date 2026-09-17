import { createElement, useState } from 'react'
import type { ReactNode } from 'react'
import { VISION_DEFAULT_PROMPT } from '../config.js'

export interface OverrideRow {
  model: string
  modality: 'text' | 'image'
}

/** Minimal shape of the settingsScope snapshot consumed by the card. */
export interface SettingsSnapshot {
  value: {
    enabled?: boolean
    visionProvider?: string
    visionModel?: string
    visionSystemPrompt?: string
    maxTokens?: number
    guidanceInjection?: boolean
    overrides?: OverrideRow[]
  }
}

export interface VisionModelCardProps {
  scope: {
    get(): SettingsSnapshot
    set(field: string, value: unknown): void
    unset?(field: string): void
  }
  /** Optional list of models dsh already has configured (from the model catalog). */
  available?: { provider: string; model: string; modal: 'text' | 'image' }[]
}

/**
 * Settings card for the `vision` namespace. The vision provider/model must be
 * one of the models dsh already has configured — this card reads that single
 * source of truth and never manages a separate model registry.
 */
export function VisionModelCard({ scope, available = [] }: VisionModelCardProps): ReactNode {
  const value = scope.get().value
  const [provider, setProvider] = useState(value.visionProvider ?? '')
  const [model, setModel] = useState(value.visionModel ?? '')
  const [enabled, setEnabled] = useState(value.enabled ?? true)
  const [prompt, setPrompt] = useState(value.visionSystemPrompt ?? VISION_DEFAULT_PROMPT)
  const [overrides, setOverrides] = useState<OverrideRow[]>(value.overrides ?? [])

  const choices = available.length > 0 ? available : undefined

  return createElement(
    'div',
    {},
    createElement('h3', {}, 'Vision proxy'),
    createElement('label', {},
      createElement('input', {
        type: 'checkbox',
        checked: enabled,
        onChange: (e) => {
          setEnabled(e.target.checked)
          scope.set('enabled', e.target.checked)
        },
      }),
      ' Enable image understanding for text-only models',
    ),
    'Use the models dsh already has configured (single source of truth):',
    choices === undefined
      ? createElement('p', {},
        'Configured models are not enumerable in this standalone bundle yet. ',
        'Enter the provider route and model id of a small multimodal model as ',
        'configured in dsh (e.g. deepseek-official / deepseek-v4-flash-vision-exp).',
      )
      : createElement(
          'select',
          {
            value: `${provider}/${model}`,
            onChange: (e) => {
              const [p, m] = e.target.value.split('/')
              setProvider(p)
              setModel(m)
              scope.set('visionProvider', p)
              scope.set('visionModel', m)
            },
          },
          choices.map((c) =>
            createElement(
              'option',
              { key: `${c.provider}/${c.model}`, value: `${c.provider}/${c.model}` },
              `${c.provider}/${c.model}`,
            ),
          ),
        ),
    // Manual fallback inputs (kept in sync with the dropdown above).
    createElement('input', {
      placeholder: 'vision provider route',
      value: provider,
      onChange: (e) => {
        setProvider(e.target.value)
        scope.set('visionProvider', e.target.value || undefined)
      },
    }),
    createElement('input', {
      placeholder: 'vision model id',
      value: model,
      onChange: (e) => {
        setModel(e.target.value)
        scope.set('visionModel', e.target.value || undefined)
      },
    }),
    createElement('textarea', {
      value: prompt,
      onChange: (e) => {
        setPrompt(e.target.value)
        scope.set('visionSystemPrompt', e.target.value)
      },
    }),
    createElement('p', {}, 'Models that declare multimodal (back off the proxy):'),
    overrides.map((row, index) =>
      createElement('div', { key: index },
        createElement('input', {
          value: row.model,
          onChange: (e) => {
            const next = [...overrides]
            next[index] = { ...row, model: e.target.value }
            setOverrides(next)
            scope.set('overrides', next)
          },
        }),
        createElement('select', {
          value: row.modality,
          onChange: (e) => {
            const next = [...overrides]
            next[index] = { ...row, modality: e.target.value as 'text' | 'image' }
            setOverrides(next)
            scope.set('overrides', next)
          },
        }, createElement('option', { value: 'text' }, 'text'),
          createElement('option', { value: 'image' }, 'image')),
      ),
    ),
    createElement(
      'button',
      { onClick: () => { setOverrides([...overrides, { model: '', modality: 'image' }]) } },
      '+ Add model override',
    ),
  )
}