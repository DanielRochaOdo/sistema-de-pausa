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

export const exportPdf = (rows, filename, title) => {
  if (!rows.length) return
  const doc = new jsPDF({ orientation: 'landscape' })
  const headers = Object.keys(rows[0])
  const body = rows.map((row) => headers.map((key) => String(row[key] ?? '')))

  if (title) {
    doc.setFontSize(14)
    doc.text(title, 14, 16)
  }

  autoTable(doc, {
    startY: title ? 22 : 14,
    head: [headers],
    body
  })

  doc.save(filename)
}
