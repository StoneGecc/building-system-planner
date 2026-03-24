import { renderToStaticMarkup } from 'react-dom/server'
import JSZip from 'jszip'
import { jsPDF } from 'jspdf'
import 'svg2pdf.js'
import type { SystemData } from '../types/system'
import type { BuildingLayout } from '../data/buildingLayout'
import type { BuildingDimensions } from '../types/system'
import { BuildingSection } from '../components/BuildingSection'
import { BuildingPlan } from '../components/BuildingPlan'
import { SectionDrawing } from '../components/SectionDrawing'
import { SHEET_W, SHEET_H } from '../data/sheetLayout'
import { resolveFastenerIcon } from './fastenerIcons'
import { calloutSystemIdsFromSystems } from './systemSort'

const CSV_HEADER =
  'System_ID,System_Type,Location,Stack_Direction,System_Name,Category,#,Layer,Material,Thickness_in,Approx_R_Value,Connection,Fastener,Fastener_Size,Layer_Type,Fill,Fastener_Icon,Fastener_Spacing_OC_in,Min_Edge_Dist_in,Min_End_Dist_in,Fastener_Pattern,Typ_Module_Width_in,Element_Spacing_OC_in,Cavity_Depth_in,Control_Joint_Spacing_ft,Draw_Module_Joints,Draw_Control_Joints,Draw_Fastener_Graphics,Detail_Max_Module_Joints,Detail_Min_Feature_Px,Config_Key,Config_Value,Sheet_Order,Diagram_Detail_Level,Diagram_Label,Diagram_Hatch,Diagram_Section_Zones_JSON,Diagram_Plan_Zones_JSON,View_Orientation,View_Reverse,View_Top_Label,View_Bottom_Label,Drawing_Note,Plan_Draw_Layers'

const BLD_DIM_ROWS: Array<[string, keyof Pick<BuildingDimensions,
  'footprintWidth' | 'footprintDepth' | 'floorToFloor' | 'voidClearWidth' | 'stairWidth' | 'sectionScale' | 'planScale'
>]> = [
  ['Footprint Width (interior)', 'footprintWidth'],
  ['Footprint Depth', 'footprintDepth'],
  ['Floor to Floor Height', 'floorToFloor'],
  ['Void Clear Width', 'voidClearWidth'],
  ['Stair Width', 'stairWidth'],
  ['Section Scale px/in', 'sectionScale'],
  ['Plan Scale px/in', 'planScale'],
]

const BLD_DIAGRAM_REF_ROWS: Array<[string, keyof Pick<BuildingDimensions,
  'diagramSectionRefWidth' | 'diagramSectionRefHeight' | 'planRefWidth' | 'planRefHeight'
>]> = [
  ['Diagram Section Ref Width', 'diagramSectionRefWidth'],
  ['Diagram Section Ref Height', 'diagramSectionRefHeight'],
  ['Plan Ref Width', 'planRefWidth'],
  ['Plan Ref Height', 'planRefHeight'],
]

function escapeCsv(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** Config_Key … View_Bottom_Label (12 cells: ck, cv, sheet, diagram detail, diagram fields…) */
function diagramMetaColumns(system: SystemData, layerIndex: number, isTotal: boolean): string[] {
  if (isTotal || layerIndex !== 1) {
    return Array(12).fill('') as string[]
  }
  return [
    '',
    '',
    system.sheetOrder !== undefined ? String(system.sheetOrder) : '',
    system.diagramDetailLevel !== undefined ? String(system.diagramDetailLevel) : '',
    system.diagramLabel ?? '',
    system.diagramHatch ?? '',
    system.diagramSectionZonesJson ?? '',
    system.diagramPlanZonesJson ?? '',
    system.viewOrientation ?? '',
    system.viewReverse !== undefined ? (system.viewReverse ? '1' : '0') : '',
    system.viewTopLabel ?? '',
    system.viewBottomLabel ?? '',
  ]
}

function systemToCsvRows(system: SystemData): string[] {
  const st = system.systemType ?? ''
  const loc = system.location ?? ''
  const sd = system.stackDirection ?? ''
  const rows: string[] = []
  for (const layer of system.layers) {
    const meta = diagramMetaColumns(system, layer.index, false)
    rows.push(
      [
        system.id,
        st,
        loc,
        sd,
        system.name,
        system.category,
        layer.index,
        layer.name,
        layer.material,
        layer.thickness,
        layer.rValue,
        layer.connection,
        layer.fastener,
        layer.fastenerSize,
        layer.layerType,
        layer.fill ?? '',
        resolveFastenerIcon(layer),
        layer.fastenerSpacingOcIn ?? '',
        layer.fastenerMinEdgeIn ?? '',
        layer.fastenerMinEndIn ?? '',
        layer.fastenerPattern ?? '',
        layer.typModuleWidthIn ?? '',
        layer.elementSpacingOcIn ?? '',
        layer.cavityDepthIn ?? '',
        layer.controlJointSpacingFt ?? '',
        layer.drawModuleJoints === true ? '1' : layer.drawModuleJoints === false ? '0' : '',
        layer.drawControlJoints === true ? '1' : layer.drawControlJoints === false ? '0' : '',
        layer.drawFastenerGraphics ?? '',
        layer.detailMaxModuleJoints !== undefined ? String(layer.detailMaxModuleJoints) : '',
        layer.detailMinFeaturePx !== undefined ? String(layer.detailMinFeaturePx) : '',
        ...meta,
        layer.notes,
        system.planDrawLayers?.length ? system.planDrawLayers.join(';') : '',
      ]
        .map((v) => escapeCsv(String(v)))
        .join(',')
    )
  }
  const totalMeta = diagramMetaColumns(system, 0, true)
  rows.push(
    [
      system.id,
      st,
      loc,
      sd,
      system.name,
      system.category,
      'TOTAL',
      '—',
      '—',
      system.totalThickness,
      system.totalR,
      '—',
      '—',
      '—',
      '—',
      '',
      'none',
      '', '', '', '', '', '', '', '', '', '', '', '', '',
      ...totalMeta,
      '',
      system.planDrawLayers?.length ? system.planDrawLayers.join(';') : '',
    ]
      .map(escapeCsv)
      .join(',')
  )
  return rows
}

function buildCsv(
  orderedSystems: SystemData[],
  buildingDimensions: BuildingDimensions
): string {
  const rows: string[] = [CSV_HEADER]
  const d = buildingDimensions

  let rowNum = 0
  const pushBldRow = (
    layerName: string,
    thicknessVal: string | number,
    meta12: string[],
    drawingNote: string,
  ) => {
    rowNum += 1
    const preConfig = [
      '', '', '', '', '', '', '', '', '', '', '', '', '',
    ] as string[]
    rows.push(
      [
        'BLD',
        'building_dimensions',
        '',
        '',
        'Building Dimensions',
        '',
        String(rowNum),
        layerName,
        '—',
        String(thicknessVal),
        '0',
        '—',
        '—',
        '—',
        'MISC',
        'MISC',
        'none',
        ...preConfig,
        ...meta12,
        drawingNote,
        '',
      ]
        .map((v) => escapeCsv(String(v)))
        .join(',')
    )
  }

  const empty12 = () => Array(12).fill('') as string[]

  for (let i = 0; i < BLD_DIM_ROWS.length; i++) {
    const [layerName, key] = BLD_DIM_ROWS[i]
    const val = (d as unknown as Record<string, number>)[key] ?? ''
    const note =
      i === 0
        ? 'Interior width between CLT faces for section/plan'
        : i === 1
          ? 'Building depth N-S for plan'
          : i === 2
            ? '11 ft floor-to-floor'
            : i === 3
              ? 'Courtyard void clear opening ~4\'-5"'
              : i === 4
                ? 'Stair shaft width 4\'-0"'
                : i === 5
                  ? 'Pixels per inch for section drawing'
                  : 'Pixels per inch for plan drawing'
    pushBldRow(layerName, val, empty12(), note)
  }

  for (let i = 0; i < BLD_DIAGRAM_REF_ROWS.length; i++) {
    const [layerName, key] = BLD_DIAGRAM_REF_ROWS[i]
    const val = (d as unknown as Record<string, number | undefined>)[key]
    pushBldRow(
      layerName,
      val ?? '',
      empty12(),
      'Reference size for normalized Diagram_*_Zones_JSON (see docs/CSV_SCHEMA.md)',
    )
  }

  const configs: Array<[string, string, string]> = [
    ['exterior_wall_assembly', d.layoutRefs.exterior_wall_assembly, 'Schematic primary wall thickness'],
    ['structural_clt_core', d.layoutRefs.structural_clt_core, 'Core CLT strip in section'],
    ['interior_partition', d.layoutRefs.interior_partition, 'Partition thickness in plan/section'],
    ['balcony_assembly', d.layoutRefs.balcony_assembly, 'Balcony / edge assembly thickness'],
    ['system_id_prefix', d.systemIdPrefix, 'Prefix for generated system IDs in the editor'],
    [
      'default_diagram_detail_level',
      String(d.defaultDiagramDetailLevel ?? 1),
      'Default section diagram detail preset (0–3)',
    ],
    [
      'detail_max_module_joints',
      String(d.detailMaxModuleJoints ?? 12),
      'Max module crease segments per layer',
    ],
    [
      'detail_min_feature_px',
      String(d.detailMinFeaturePx ?? 8),
      'Min layer size (px) for creases and shop extras',
    ],
    [
      'shop_max_fastener_marks_per_layer',
      String(d.shopMaxFastenerMarksPerLayer ?? 8),
      'Cap on repeated fastener marks at shop detail level',
    ],
  ]
  for (const [ck, cv, note] of configs) {
    rowNum += 1
    const preConfig = ['', '', '', '', '', '', '', '', '', '', '', '', ''] as string[]
    rows.push(
      [
        'BLD',
        'building_dimensions',
        '',
        '',
        'Building Dimensions',
        '',
        String(rowNum),
        'Configuration',
        '—',
        '0',
        '0',
        '—',
        '—',
        '—',
        'MISC',
        'MISC',
        'none',
        ...preConfig,
        ck,
        cv,
        '', '', '', '', '', '', '', '', '', '',
        note,
        '',
      ]
        .map((v) => escapeCsv(String(v)))
        .join(',')
    )
  }

  for (const system of orderedSystems) {
    rows.push(...systemToCsvRows(system))
  }
  return rows.join('\n')
}

function ensureSvgXmlns(svgStr: string): string {
  if (!svgStr.includes('xmlns="http://www.w3.org/2000/svg"')) {
    return svgStr.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  return svgStr
}

/** Fix unescaped ampersands that break XML parsing (e.g. in user-edited layer names) */
function sanitizeSvgForXml(svgStr: string): string {
  return svgStr.replace(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
}

function svgStringToElement(svgStr: string, sheetName?: string): SVGSVGElement {
  const withXmlns = ensureSvgXmlns(svgStr)
  const sanitized = sanitizeSvgForXml(withXmlns)
  const parser = new DOMParser()

  const xmlDoc = parser.parseFromString(
    '<?xml version="1.0" encoding="utf-8"?>\n' + sanitized,
    'image/svg+xml'
  )
  let svg = xmlDoc.querySelector('svg')
  const parserError = xmlDoc.querySelector('parsererror')

  if (!svg || parserError) {
    const htmlDoc = parser.parseFromString(
      '<!DOCTYPE html><html><body>' + sanitized + '</body></html>',
      'text/html'
    )
    svg = htmlDoc.querySelector('svg')
  }

  if (!svg) {
    const errDetail = parserError?.textContent?.slice(0, 100) || 'Unknown XML error'
    throw new Error(`SVG parse failed${sheetName ? ` (${sheetName})` : ''}: ${errDetail}`)
  }
  return svg
}

async function addSvgToPdf(
  doc: jsPDF,
  svgStr: string,
  isFirstPage: boolean,
  sheetName?: string
): Promise<void> {
  if (!isFirstPage) doc.addPage([SHEET_W, SHEET_H], 'l')
  const svgEl = svgStringToElement(svgStr, sheetName)
  await doc.svg(svgEl, {
    x: 0,
    y: 0,
    width: SHEET_W,
    height: SHEET_H,
  })
}

export function prepareSvgContent(svgStr: string): string {
  const full = ensureSvgXmlns(svgStr)
  return '<?xml version="1.0" encoding="utf-8"?>\n' + full
}

export async function exportAllSheets(
  orderedSystems: SystemData[],
  layout: BuildingLayout,
  buildingDimensions: BuildingDimensions
): Promise<void> {
  const zip = new JSZip()
  const svgsFolder = zip.folder('svgs')
  if (!svgsFolder) throw new Error('Could not create svgs folder')

  const svgEntries: Array<{ name: string; content: string }> = []
  const calloutIds = calloutSystemIdsFromSystems(orderedSystems)

  const sectionSvg = renderToStaticMarkup(
    <BuildingSection
      systems={orderedSystems}
      layout={layout}
      calloutSystemIds={calloutIds}
      systemIndex={0}
    />
  )
  svgEntries.push({
    name: 'A3-building-section.svg',
    content: prepareSvgContent(sectionSvg),
  })

  const planSvg = renderToStaticMarkup(
    <BuildingPlan
      systems={orderedSystems}
      layout={layout}
      calloutSystemIds={calloutIds}
      systemIndex={1}
    />
  )
  svgEntries.push({
    name: 'A1-building-plan.svg',
    content: prepareSvgContent(planSvg),
  })

  orderedSystems.forEach((system, index) => {
    const systemIndex = index + 3
    const svgStr = renderToStaticMarkup(
      <SectionDrawing system={system} systemIndex={systemIndex} buildingDimensions={buildingDimensions} />
    )
    const safeName = system.name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-')
    svgEntries.push({
      name: `${system.id}-${safeName}.svg`,
      content: prepareSvgContent(svgStr),
    })
  })

  for (const { name, content } of svgEntries) {
    svgsFolder.file(name, content)
  }

  const csv = buildCsv(orderedSystems, buildingDimensions)
  zip.file('building-systems.csv', csv)

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'pt',
    format: [SHEET_W, SHEET_H],
  })

  for (let i = 0; i < svgEntries.length; i++) {
    await addSvgToPdf(doc, svgEntries[i].content, i === 0, svgEntries[i].name)
  }

  const pdfBlob = doc.output('blob')
  zip.file('all-sheets.pdf', pdfBlob)

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'mass-timber-building-system-export.zip'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
