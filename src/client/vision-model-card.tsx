import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { VISION_DEFAULT_PROMPT } from '../meta.js'
import type { VisionCardFace } from './index.js'

// Official-card chrome, reproduced. The settings-plugins package does not
// export PluginCard/fields as values, and the purity gate forbids cross-plugin
// value imports anyway; the classes below copy the compiled official
// stylesheets (PluginCard.module.css / fields.module.css) under our own prefix.
// The rules are written entirely against the global `--dsw-alias-*` design
// tokens, so the card themes with light/dark exactly like the built-ins.
const CSS = `
.dvt-card{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}
.dvt-card:hover{border-color:var(--dsw-alias-label-dimmed)}
.dvt-cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dvt-header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dvt-header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dvt-headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dvt-name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dvt-description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dvt-chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.dvt-chevronOpen{transform:rotate(180deg)}
.dvt-body{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dvt-readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.dvt-footer{border-top:.5px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
.dvt-failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}
.dvt-discard,.dvt-save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dvt-discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.dvt-discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dvt-save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dvt-discard:disabled,.dvt-save:disabled{opacity:.4;cursor:default}
.dvt-discard:focus-visible,.dvt-save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dvt-field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.dvt-field+.dvt-field{border-top:.5px solid var(--dsw-alias-border-l2)}
.dvt-head{align-items:center;gap:8px;display:flex}
.dvt-label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.dvt-badges{align-items:center;gap:8px;display:inline-flex}
.dvt-tag{font-size:11px;line-height:1.5;padding:1px 8px;border-radius:999px;border:.5px solid var(--dsw-alias-border-l3);background:var(--dsw-alias-bg-layer-4);color:var(--dsw-alias-label-secondary)}
.dvt-input{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
.dvt-input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dvt-input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dvt-inputInvalid{border-color:var(--dsw-alias-label-error)}
.dvt-invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.dvt-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.dvt-textarea{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);min-height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 12px;font-size:13px;line-height:1.5;resize:vertical;width:100%;box-sizing:border-box}
.dvt-textarea:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dvt-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.dvt-checkRow{align-items:center;gap:8px;padding:12px 0;display:flex}
.dvt-checkRow+.dvt-checkRow{border-top:.5px solid var(--dsw-alias-border-l2)}
.dvt-checkLabel{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5;cursor:pointer}
.dvt-overrideRow{display:grid;grid-template-columns:minmax(0,1fr) 96px auto;gap:8px;align-items:center;margin-top:8px}
.dvt-ghost{appearance:none;font:inherit;cursor:pointer;border:.5px solid var(--dsw-alias-border-l2);background:0 0;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:4px 12px;font-size:12px;line-height:1.5;white-space:nowrap;flex:none}
.dvt-ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dvt-ghost:disabled{opacity:.4;cursor:default}
.dvt-ghost:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dvt-catalogError{color:var(--dsw-alias-label-error);justify-content:space-between;align-items:center;gap:12px;font-size:12px;display:flex}
.dvt-select{width:100%}
`;
const STYLE_TAG_ID = "@deepseek-ai/dsh-vision-tool/card.module.css";
if (typeof document !== "undefined" && document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-vision-tool";
  tag.dataset.pluginCss = STYLE_TAG_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

export interface ModelChoice {
  provider: string
  model: string
  name?: string
}

export interface OverrideRow {
  model: string
  modality: 'text' | 'image'
}

interface VisionSettings {
  enabled?: boolean
  visionProvider?: string
  visionModel?: string
  visionSystemPrompt?: string
  maxTokens?: number
  guidanceInjection?: boolean
  overrides?: OverrideRow[]
}

const h = createElement

function Chevron({ open }: { open: boolean }): ReactNode {
  return h('svg', {
    className: 'dvt-chevron' + (open ? ' dvt-chevronOpen' : ''),
    width: 14,
    height: 14,
    viewBox: '0 0 14 14',
    fill: 'none',
    'aria-hidden': true,
  }, h('path', {
    d: 'M3.5 5.25 7 8.75l3.5-3.5',
    stroke: 'currentColor',
    'stroke-width': '1.2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }))
}

/** One staged labelled field: label head, control, hint line (official ValueField shape). */
function Field(props: {
  id: string
  label: string
  hint?: string
  children: ReactNode
}): ReactNode {
  return h('div', { className: 'dvt-field' },
    h('div', { className: 'dvt-head' },
      h('label', { className: 'dvt-label', htmlFor: props.id }, props.label)),
    props.children,
    props.hint ? h('p', { className: 'dvt-hint' }, props.hint) : null,
  )
}

/**
 * Settings card for the `vision` namespace, mirroring the built-in plugin
 * cards: collapsible header, staged edits with one save button, official
 * field styling. The model picker lists the Host-generation model catalog
 * (dsh's single source of configured models); manual entry stays available
 * as the fallback, and a refresh re-reads the catalog.
 */
export function VisionModelCard(face: VisionCardFace): ReactNode {
  const { scope, listModels, lastError, refresh } = face
  // Scope methods are controller-class methods (`this`-dependent); call them
  // through closures — passing the references themselves would drop `this` and
  // crash inside React's render.
  const getSnapshot = useCallback(() => scope.getSnapshot(), [scope])
  const subscribe = useCallback((listener: () => void) => scope.subscribe(listener), [scope])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)
  const saved = (snapshot.value ?? {}) as VisionSettings

  const [draft, setDraft] = useState<VisionSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const [choices, setChoices] = useState<ModelChoice[]>(listModels)
  const [catalogError, setCatalogError] = useState<string | undefined>(lastError)
  const saveStarted = useRef(false)

  const writable = snapshot.writable
  const value: VisionSettings = draft ?? saved
  const dirty = draft !== null
  const maxTokensText = value.maxTokens === undefined ? '' : String(value.maxTokens)
  const maxTokensInvalid = maxTokensText !== '' && (!/^\d+$/.test(maxTokensText) || Number(maxTokensText) < 256 || Number(maxTokensText) > 8192)

  const edit = useCallback((patch: Partial<VisionSettings>) => {
    setFailed(false)
    setDraft(prev => ({ ...(prev ?? saved), ...patch }))
  }, [saved])

  const discard = useCallback(() => {
    setDraft(null)
    setFailed(false)
  }, [])

  const save = useCallback(async () => {
    if (draft === null || maxTokensInvalid) return
    setSaving(true)
    try {
      const ops: ({ op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] })[] = []
      for (const key of ['enabled', 'visionProvider', 'visionModel', 'visionSystemPrompt', 'maxTokens', 'guidanceInjection'] as const) {
        const next = draft[key]
        const prev = saved[key]
        if (JSON.stringify(next) === JSON.stringify(prev)) continue
        if (next === undefined) ops.push({ op: 'unset', path: [key] })
        else ops.push({ op: 'set', path: [key], value: next })
      }
      if (JSON.stringify(draft.overrides) !== JSON.stringify(saved.overrides)) {
        ops.push({ op: 'set', path: ['overrides'], value: draft.overrides ?? [] })
      }
      if (ops.length > 0) await scope.mutate(ops)
      saveStarted.current = true
      setDraft(null)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setSaving(false)
    }
  }, [draft, saved, scope, maxTokensInvalid])

  const refreshChoices = useCallback(async () => {
    await refresh()
    setChoices(listModels())
    setCatalogError(lastError())
  }, [refresh, listModels, lastError])

  const openState = useState(false)
  const open = openState[0]
  const setOpen = openState[1]
  // A finished save collapses the card, matching the built-ins' gesture.
  useEffect(() => {
    if (saveStarted.current && !saving && !dirty && !failed) {
      saveStarted.current = false
      setOpen(false)
    }
  }, [saving, dirty, failed])

  const selected = value.visionProvider || value.visionModel
    ? `${value.visionProvider ?? ''}/${value.visionModel ?? ''}`
    : ''
  const options = choices.map(c => ({
    ...c,
    label: `${c.provider}/${c.model}` + (c.name && c.name !== c.model ? ` (${c.name})` : ''),
  }))

  const overrides = value.overrides ?? []

  return h('li', { className: 'dvt-card' + (open ? ' dvt-cardOpen' : '') },
    h('button', {
      type: 'button',
      className: 'dvt-header',
      'aria-expanded': open,
      onClick: () => setOpen(!open),
    },
      h('span', { className: 'dvt-headText' },
        h('span', { className: 'dvt-name' }, '识图代理'),
        h('span', { className: 'dvt-description' }, '把图片理解委托给小参数多模态模型;多模态主模型自动退避'),
      ),
      dirty ? h('span', { className: 'dvt-tag' }, '未保存') : null,
      h(Chevron, { open }),
    ),
    open ? h('div', { className: 'dvt-body' },
      !writable ? h('p', { className: 'dvt-readOnly', role: 'status' }, '当前连接对该配置为只读') : null,
      h('div', { className: 'dvt-checkRow' },
        h('input', {
          type: 'checkbox',
          id: 'dvt-enabled',
          checked: value.enabled ?? true,
          disabled: !writable,
          onChange: e => edit({ enabled: e.target.checked }),
        }),
        h('label', { className: 'dvt-checkLabel', htmlFor: 'dvt-enabled' },
          '启用文本模型的识图代理 (understand_image)'),
      ),
      h(Field, {
        id: 'dvt-model',
        label: '识图模型(来自 dsh 已配置的模型)',
        hint: choices.length > 0
          ? '列表即 dsh 已配置的全部模型;下拉与下方手动输入保存时生效。'
          : '暂无法枚举已配置的模型,请在下方手动输入 dsh 中已配置的多模态模型。',
      },
        choices.length > 0
          ? h('div', { style: { display: 'flex', gap: 8 } },
              h('select', {
                id: 'dvt-model',
                className: 'dvt-input dvt-select',
                value: selected,
                disabled: !writable,
                onChange: e => {
                  if (e.target.value === '') { edit({ visionProvider: undefined, visionModel: undefined }); return }
                  const [p, m] = e.target.value.split('/')
                  edit({ visionProvider: p, visionModel: m })
                },
              },
                h('option', { key: '', value: '' }, '— 选择一个模型 —'),
                options.map(c =>
                  h('option', { key: c.label, value: `${c.provider}/${c.model}` }, c.label)),
              ),
              h('button', {
                type: 'button',
                className: 'dvt-ghost',
                onClick: () => void refreshChoices(),
              }, '刷新列表'),
            )
          : h('div', { className: 'dvt-row2' },
              h('input', {
                className: 'dvt-input',
                placeholder: 'provider 路由(如 zai-coding-cn)',
                value: value.visionProvider ?? '',
                disabled: !writable,
                onChange: e => edit({ visionProvider: e.target.value || undefined }),
              }),
              h('input', {
                className: 'dvt-input',
                placeholder: '模型 id(如 glm-5.3-flash)',
                value: value.visionModel ?? '',
                disabled: !writable,
                onChange: e => edit({ visionModel: e.target.value || undefined }),
              }),
            ),
      ),
      choices.length > 0
        ? h('div', { className: 'dvt-field' },
            h('div', { className: 'dvt-row2' },
              h('input', {
                className: 'dvt-input',
                'aria-label': 'provider 路由',
                placeholder: 'provider 路由',
                value: value.visionProvider ?? '',
                disabled: !writable,
                onChange: e => edit({ visionProvider: e.target.value || undefined }),
              }),
              h('input', {
                className: 'dvt-input',
                'aria-label': '模型 id',
                placeholder: '模型 id',
                value: value.visionModel ?? '',
                disabled: !writable,
                onChange: e => edit({ visionModel: e.target.value || undefined }),
              }),
            ),
            catalogError ? h('p', { className: 'dvt-catalogError' }, `模型目录读取失败:${catalogError}`) : null,
          )
        : null,
      h(Field, {
        id: 'dvt-prompt',
        label: '视觉模型系统提示词',
        hint: '视觉模型每次识图调用遵循的系统提示;主模型的问题会作为用户消息发送。',
      },
        h('textarea', {
          id: 'dvt-prompt',
          className: 'dvt-textarea',
          rows: 4,
          value: value.visionSystemPrompt ?? VISION_DEFAULT_PROMPT,
          disabled: !writable,
          onChange: e => edit({ visionSystemPrompt: e.target.value }),
        }),
      ),
      h(Field, {
        id: 'dvt-max-tokens',
        label: '最大输出 Token',
        hint: '单次识图调用的输出上限(256–8192)。',
      },
        h('input', {
          id: 'dvt-max-tokens',
          className: (maxTokensInvalid ? 'dvt-inputInvalid ' : '') + 'dvt-input',
          type: 'text',
          inputMode: 'numeric',
          'aria-invalid': maxTokensInvalid || undefined,
          value: maxTokensText,
          disabled: !writable,
          onChange: e => {
            const text = e.target.value
            edit({ maxTokens: text === '' ? undefined : (Number(text) as VisionSettings['maxTokens']) })
          },
        }),
      ),
      maxTokensInvalid ? h('p', { className: 'dvt-invalid' }, '最大输出 Token 需为 256–8192 的整数') : null,
      h('div', { className: 'dvt-checkRow' },
        h('input', {
          type: 'checkbox',
          id: 'dvt-guidance',
          checked: value.guidanceInjection ?? true,
          disabled: !writable,
          onChange: e => edit({ guidanceInjection: e.target.checked }),
        }),
        h('label', { className: 'dvt-checkLabel', htmlFor: 'dvt-guidance' },
          '为纯文本模型注入识图引导(多模态模型自动退避)'),
      ),
      h('div', { className: 'dvt-field' },
        h('div', { className: 'dvt-head' },
          h('label', { className: 'dvt-label' }, '多模态声明覆盖'),
          h('span', { className: 'dvt-hint' }, '标记后本插件对这些模型退避'),
        ),
        overrides.map((row, index) =>
          h('div', { key: index, className: 'dvt-overrideRow' },
            h('input', {
              className: 'dvt-input',
              'aria-label': `覆盖模型 ${index + 1}`,
              placeholder: '模型 id',
              value: row.model,
              disabled: !writable,
              onChange: e => {
                const next = [...overrides]
                next[index] = { ...row, model: e.target.value }
                edit({ overrides: next })
              },
            }),
            h('select', {
              className: 'dvt-input',
              'aria-label': `覆盖模态 ${index + 1}`,
              value: row.modality,
              disabled: !writable,
              onChange: e => {
                const next = [...overrides]
                next[index] = { ...row, modality: e.target.value as 'text' | 'image' }
                edit({ overrides: next })
              },
            },
              h('option', { value: 'text' }, 'text'),
              h('option', { value: 'image' }, 'image'),
            ),
            h('button', {
              type: 'button',
              className: 'dvt-ghost',
              disabled: !writable,
              onClick: () => edit({ overrides: overrides.filter((_, i) => i !== index) }),
            }, '删除'),
          ),
        ),
        h('div', {},
          h('button', {
            type: 'button',
            className: 'dvt-ghost',
            disabled: !writable,
            onClick: () => edit({ overrides: [...overrides, { model: '', modality: 'image' }] }),
          }, '+ 添加模型声明'),
        ),
      ),
      h('div', { className: 'dvt-footer' },
        failed ? h('p', { className: 'dvt-failed', role: 'status' }, '保存失败,请重试') : null,
        h('button', {
          type: 'button',
          className: 'dvt-discard',
          disabled: !dirty || saving,
          onClick: discard,
        }, '放弃'),
        h('button', {
          type: 'button',
          className: 'dvt-save',
          disabled: !dirty || maxTokensInvalid || saving,
          onClick: () => void save(),
        }, saving ? '保存中…' : '保存'),
      ),
    ) : null,
  )
}
