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

/**
 * Replaces known {{variable}} placeholders with values from the variables object.
 * Leaves unknown variables or variables with empty/null/undefined values unchanged.
 */
export function renderTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(PLACEHOLDER_REGEX, (match, varName) => {
    if (KNOWN_VARIABLES.includes(varName)) {
      const value = variables[varName as keyof TemplateVariables]
      if (value) {
        return value
      }
    }
    return match
  })
}

/**
 * Validates a template by checking if all {{variable}} placeholders reference known variables.
 * Returns valid: false with a unique list of unknown variable names if any are found.
 */
export function validateTemplate(template: string): TemplateValidationResult {
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
