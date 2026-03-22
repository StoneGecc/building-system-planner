import type { SystemData, BuildingDimensions } from '../types/system'
import { CATEGORY_LABELS } from '../types/system'

const LAYER_TYPES = 'CLT, WOOD, INSULATION, MEMBRANE, METAL, CONCRETE, AIR_GAP, GLASS, GRAVEL_SOIL, MISC'
const CATEGORY_IDS = 'A, B, C, D'

function buildDataSummary(systems: SystemData[], maxChars = 3500): string {
  const summary = systems.map(s => ({
    id: s.id,
    name: s.name,
    category: s.category,
    categoryLabel: CATEGORY_LABELS[s.category],
    layerCount: s.layers.length,
    totalThickness: s.totalThickness,
    totalR: s.totalR,
    layers: s.layers.map(l => ({
      name: l.name,
      material: l.material,
      thickness: l.thickness,
      rValue: l.rValue,
      layerType: l.layerType,
    })),
  }))
  let json = JSON.stringify(summary, null, 0)
  if (json.length > maxChars) {
    json = json.slice(0, maxChars) + '...[truncated]'
  }
  return json
}

export function buildSystemPrompt(systems: SystemData[], buildingDimensions: BuildingDimensions): string {
  const dataSummary = buildDataSummary(systems)
  return `You are an assistant for a Mass Timber Building System application. You help users understand and modify building systems data.

## Data Schema

- **SystemData**: { id: string (e.g. "A4-01"), name: string, category: CategoryId, layers: Layer[], totalThickness: string, totalR: string }
- **Layer**: { index, name, material, thickness, rValue, connection, fastener, fastenerSize, fastenerIcon?, layerType, fill?, notes, visible? }
- **fastenerIcon** (optional): one of: none, wood_screw, bolt, adhesive, rivet, plate, clip — shown on section callouts
- **CategoryId**: ${CATEGORY_IDS} (A=Structural, B=Building Envelope, C=Interior, D=Special)
- **LayerType**: ${LAYER_TYPES}

## Current Data

${dataSummary}

## Building Dimensions (inches)

Footprint: ${buildingDimensions.footprintWidth} x ${buildingDimensions.footprintDepth}, Floor-to-floor: ${buildingDimensions.floorToFloor}

## Instructions

1. **Questions**: Answer in natural language using the provided data. Be concise and accurate.

2. **Adding systems, layers, or data**: When the user asks to add a new system, add layers to an existing system, or create new data, you MUST respond with a JSON block (and nothing else) in this exact format:
\`\`\`json
{"action":"apply","data":{"systems":[...]}}
\`\`\`

Where \`systems\` is an array of full SystemData objects:
- For "add new system": include the new system with a unique id (e.g. A4-23). Use the next available number after A4-22. Include all required fields: id, name, category, layers (array of Layer), totalThickness, totalR. Each layer needs: index, name, material, thickness, rValue, connection, fastener, fastenerSize, layerType, notes, visible; optionally fastenerIcon (none | wood_screw | bolt | adhesive | rivet | plate | clip).
- For "add layer to system X": include the UPDATED system (same id) with the new layer appended. Recalculate totalThickness and totalR if possible.
- Layer index should be 1-based sequential.
- Valid layerType values: ${LAYER_TYPES}
- Valid category values: ${CATEGORY_IDS}

3. If the user's request is ambiguous or you cannot fulfill it, explain in natural language. Do not output the JSON block unless you are proposing concrete data changes.

4. When outputting the apply JSON, ensure it is valid JSON. The systems array should contain complete SystemData objects.`
}
