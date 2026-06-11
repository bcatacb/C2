export interface TemplateVariables {
  username?: string
  display_name?: string
}

export interface TemplateValidationResult {
  valid: boolean
  unknownVariables: string[]
}

const KNOWN_VARIABLES = ['username', 'display_name']

const PLACEHOLDER_REGEX = /\{\{(\w+)\}\}/g

const WARMUP_STARTERS = [
  "Hey {{display_name}}! Quick question for you, are you still active here?",
  "Hey! Saw your profile and wanted to say hi 👋",
  "Hi {{display_name}}, quick question - do you do collabs?",
  "Hey there! Love your content. Quick question, how long have you been posting?",
  "Hello! Just came across your videos. Quick question, do you check your DMs often?",
]

function resolveSpintax(text: string): string {
  const spintaxRegex = /\{([^{}]+)\}/g
  let resolved = text
  while (spintaxRegex.test(resolved)) {
    resolved = resolved.replace(spintaxRegex, (match, optionsStr) => {
      const choices = optionsStr.split('|')
      return choices[Math.floor(Math.random() * choices.length)]
    })
  }
  return resolved
}

/**
 * Replaces known {{variable}} placeholders with values from the variables object.
 * Leaves unknown variables or variables with empty/null/undefined values unchanged.
 */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  let text = template
  if (text.trim() === '[WARMUP]') {
    text = WARMUP_STARTERS[Math.floor(Math.random() * WARMUP_STARTERS.length)]
  }

  const rendered = text.replace(PLACEHOLDER_REGEX, (match, varName) => {
    if (KNOWN_VARIABLES.includes(varName)) {
      const value = variables[varName as keyof TemplateVariables]
      if (value !== undefined && value !== null) {
        return value
      }
    }
    return match
  })

  return resolveSpintax(rendered)
}

/**
 * Validates a template by checking if all {{variable}} placeholders reference known variables.
 * Returns valid: false with a unique list of unknown variable names if any are found.
 */
export function validateTemplate(template: string): TemplateValidationResult {
  if (template.trim() === '[WARMUP]') {
    return { valid: true, unknownVariables: [] }
  }

  const knownSet = new Set(KNOWN_VARIABLES)
  const matches = template.match(PLACEHOLDER_REGEX) || []
  const unknownVariables = [
    ...new Set(
      matches
        .map(m => m.slice(2, -2))
        .filter(v => !knownSet.has(v))
    ),
  ]

  return {
    valid: unknownVariables.length === 0,
    unknownVariables,
  }
}

/**
 * Returns the list of available template variables.
 */
export function getAvailableVariables(): string[] {
  return [...KNOWN_VARIABLES]
}
