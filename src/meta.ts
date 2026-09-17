/**
 * Shared constants kept free of any Host-side imports (schemastery and
 * friends), so both the Host half and the browser card can use them without
 * dragging Host packages into the client bundle.
 */

/** Settings namespace bound to both the Host half and the browser settings card. */
export const VISION_NS = 'vision'

/** Plugin identity used for message provenance. */
export const PLUGIN_NAME = 'dsh-vision-tool'

/** Default system prompt the vision model follows when none is configured. */
export const VISION_DEFAULT_PROMPT =
  'You are a compact image-understanding model. Describe the attached image ' +
  'precisely and completely so a text-only assistant can reason about it. ' +
  'Answer the specific question asked, and include all visible text verbatim.'
