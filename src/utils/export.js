import { toCsv } from './csv'
import * as XLSX from 'xlsx'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const downloadBlob = (content, filename, type) => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

const resolveImageFormat = (dataUrl) => {
  if (!dataUrl) return 'PNG'
  if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'JPEG'
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP'
  return 'PNG'
}

const loadImageDataUrl = async (source) => {
  if (!source || typeof source !== 'string') return null
  if (source.startsWith('data:image/')) return source
  try {
    const response = await fetch(source)
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return null
    const blob = await response.blob()
    return await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result === 'string' && result.startsWith('data:image/')) {
          resolve(result)
        } else {
          resolve(null)
        }
      }
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch (err) {
    return null
  }
}

const loadImageDimensions = (dataUrl) =>
  new Promise((resolve) => {
    if (!dataUrl) return resolve(null)
    const img = new Image()
    img.onload = () => {
      const width = img.naturalWidth || img.width
      const height = img.naturalHeight || img.height
      if (!width || !height) return resolve(null)
      resolve({ width, height })
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })

export const exportCsv = (rows, filename) => {
  if (!rows.length) return
  const csv = toCsv(rows)
  downloadBlob(csv, filename, 'text/csv;charset=utf-8;')
}

export const exportXlsx = (rows, filename) => {
  if (!rows.length) return
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Relatorio')
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
  downloadBlob(data, filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
}

export const exportPdf = async (rows, filename, title, meta = {}) => {
  if (!rows.length) return
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const headers = Object.keys(rows[0])
  const body = rows.map((row) => headers.map((key) => String(row[key] ?? '')))
  const pageWidth = doc.internal.pageSize.getWidth()
  const margin = 40
  const headerHeight = 64
  const logoDataUrl = await loadImageDataUrl(meta?.logo)
  const logoSize = logoDataUrl ? await loadImageDimensions(logoDataUrl) : null

  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, pageWidth, headerHeight, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text(title || 'Relatorio', margin, 36)

  if (logoDataUrl) {
    const maxLogoWidth = meta?.logoWidth || 140
    const maxLogoHeight = meta?.logoHeight || 40
    let logoWidth = maxLogoWidth
    let logoHeight = maxLogoHeight
    if (logoSize?.width && logoSize?.height) {
      const scale = Math.min(maxLogoWidth / logoSize.width, maxLogoHeight / logoSize.height, 1)
      logoWidth = Math.max(1, Math.round(logoSize.width * scale))
      logoHeight = Math.max(1, Math.round(logoSize.height * scale))
    }
    const logoX = pageWidth - margin - logoWidth
    const logoYOffset = typeof meta?.logoYOffset === 'number' ? meta.logoYOffset : 0
    const logoY = Math.max(-30, (headerHeight - logoHeight) / 2 + logoYOffset)
    doc.addImage(logoDataUrl, resolveImageFormat(logoDataUrl), logoX, logoY, logoWidth, logoHeight)
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  const metaLineParts = []
  if (meta?.generatedBy) metaLineParts.push(`Gerado por: ${meta.generatedBy}`)
  if (meta?.generatedAt) metaLineParts.push(`Gerado em: ${meta.generatedAt}`)
  if (metaLineParts.length) {
    doc.text(metaLineParts.join(' | '), margin, 52)
  }

  doc.setTextColor(15, 23, 42)
  let startY = headerHeight + 16

  if (Array.isArray(meta?.filters) && meta.filters.length) {
    const filterRows = meta.filters.map((item) => [
      String(item?.label ?? ''),
      String(item?.value ?? '')
    ])
    autoTable(doc, {
      startY,
      head: [['Filtros aplicados', 'Valor']],
      body: filterRows,
      theme: 'grid',
      styles: {
        fontSize: 9,
        textColor: [30, 41, 59],
        cellPadding: 6,
        overflow: 'linebreak'
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold'
      },
      columnStyles: {
        0: { cellWidth: 140 }
      }
    })
    startY = doc.lastAutoTable.finalY + 14
  }

  autoTable(doc, {
    startY,
    head: [headers],
    body,
    theme: 'striped',
    styles: {
      fontSize: 8,
      cellPadding: 5,
      textColor: [15, 23, 42],
      overflow: 'linebreak'
    },
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: 255,
      fontStyle: 'bold'
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    }
  })

  doc.save(filename)
}
