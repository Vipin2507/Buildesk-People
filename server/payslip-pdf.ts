import PDFDocument from "pdfkit";
import type { PayslipDto } from "../src/domain/payslip.ts";

const NAVY = "#1B2A4A";
const GRID = "#222222";
const PALE = "#DCEAF7";
const MUTED = "#444444";

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function pageSize(dto: PayslipDto): { size: "LETTER" | "A4"; width: number; height: number } {
  if (dto.company.paperSize === "a4") return { size: "A4", width: 595.28, height: 841.89 };
  return { size: "LETTER", width: 612, height: 792 };
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  cols: Array<{ text: string; width: number; align?: "left" | "right" | "center"; bold?: boolean; fill?: string }>,
  rowHeight: number,
) {
  let cursor = x;
  cols.forEach((col) => {
    if (col.fill) {
      doc.save();
      doc.rect(cursor, y, col.width, rowHeight).fill(col.fill);
      doc.restore();
    }
    doc.rect(cursor, y, col.width, rowHeight).stroke(GRID);
    doc
      .fillColor(GRID)
      .font(col.bold ? "Times-Bold" : "Times-Roman")
      .fontSize(9)
      .text(col.text, cursor + 4, y + 5, { width: col.width - 8, align: col.align ?? "left", lineBreak: false });
    cursor += col.width;
  });
}

export function renderPayslipPdf(dto: PayslipDto): Promise<Buffer> {
  const page = pageSize(dto);
  const margin = 48;
  const contentWidth = page.width - margin * 2;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: page.size,
      margins: { top: margin, bottom: margin, left: margin, right: margin },
      info: {
        Title: dto.filename,
        Author: dto.company.legalName,
        Subject: `${dto.periodTitle} · ${dto.employee.employeeCode}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    if (dto.watermark) {
      doc.save();
      doc.fillColor("#B0B0B0").opacity(0.28).font("Times-Bold").fontSize(28);
      doc.rotate(-28, { origin: [page.width / 2, page.height / 2] });
      doc.text(dto.watermark, margin, page.height / 2 - 20, { width: contentWidth, align: "center" });
      doc.restore();
      doc.opacity(1);
    }

    let y = margin;
    doc.fillColor(NAVY).font("Times-Bold").fontSize(18).text(dto.company.legalName, margin, y, { width: contentWidth, align: "center" });
    y = doc.y + 4;
    if (dto.company.address) {
      doc.fillColor(MUTED).font("Times-Roman").fontSize(9).text(dto.company.address, margin, y, { width: contentWidth, align: "center" });
      y = doc.y + 2;
    }
    if (dto.company.registrationId) {
      doc.fillColor(MUTED).font("Times-Roman").fontSize(9).text(dto.company.registrationId, margin, y, { width: contentWidth, align: "center" });
      y = doc.y + 8;
    } else {
      y += 8;
    }

    doc.fillColor(NAVY).font("Times-Bold").fontSize(12).text(dto.periodTitle, margin, y, { width: contentWidth, align: "center" });
    y = doc.y + 12;

    const detailRows: Array<[string, string]> = [
      ["Employee Name", dto.employee.name],
      ["Employee ID", dto.employee.employeeCode],
      ["Designation", dto.employee.designation],
      ["Department", dto.employee.department],
      ["Location", dto.employee.location],
      ["Paid Days / LOP", `${dto.paidDays} / ${dto.lopDays}`],
    ];
    const labelW = 130;
    const valueW = contentWidth - labelW;
    detailRows.forEach(([label, value]) => {
      drawTableRow(doc, margin, y, [
        { text: label, width: labelW, bold: true, fill: "#F5F7FA" },
        { text: value, width: valueW },
      ], 18);
      y += 18;
    });

    y += 14;
    const gap = 14;
    const colWidth = (contentWidth - gap) / 2;
    const leftX = margin;
    const rightX = margin + colWidth + gap;
    const headH = 18;
    const rowH = 16;

    doc.save();
    doc.rect(leftX, y, colWidth, headH).fill(NAVY);
    doc.rect(rightX, y, colWidth, headH).fill(NAVY);
    doc.restore();
    doc.fillColor("#FFFFFF").font("Times-Bold").fontSize(9);
    doc.text("EARNINGS", leftX + 4, y + 5, { width: colWidth * 0.62, align: "left" });
    doc.text("AMOUNT (₹)", leftX + colWidth * 0.55, y + 5, { width: colWidth * 0.42, align: "right" });
    doc.text("DEDUCTIONS", rightX + 4, y + 5, { width: colWidth * 0.62, align: "left" });
    doc.text("AMOUNT (₹)", rightX + colWidth * 0.55, y + 5, { width: colWidth * 0.42, align: "right" });
    doc.rect(leftX, y, colWidth, headH).stroke(GRID);
    doc.rect(rightX, y, colWidth, headH).stroke(GRID);
    y += headH;

    const rows = Math.max(dto.earnings.length, dto.deductions.length, 1);
    for (let i = 0; i < rows; i += 1) {
      const earning = dto.earnings[i];
      const deduction = dto.deductions[i];
      drawTableRow(doc, leftX, y, [
        { text: earning?.label ?? "", width: colWidth * 0.62 },
        { text: earning ? money(earning.amount, dto.company.currency) : "", width: colWidth * 0.38, align: "right" },
      ], rowH);
      drawTableRow(doc, rightX, y, [
        { text: deduction?.label ?? "", width: colWidth * 0.62 },
        { text: deduction ? money(deduction.amount, dto.company.currency) : "", width: colWidth * 0.38, align: "right" },
      ], rowH);
      y += rowH;
    }

    drawTableRow(doc, leftX, y, [
      { text: "Gross Salary", width: colWidth * 0.62, bold: true, fill: PALE },
      { text: money(dto.grossEarnings, dto.company.currency), width: colWidth * 0.38, align: "right", bold: true, fill: PALE },
    ], rowH);
    drawTableRow(doc, rightX, y, [
      { text: "Total Deductions", width: colWidth * 0.62, bold: true, fill: PALE },
      { text: money(dto.totalDeductions, dto.company.currency), width: colWidth * 0.38, align: "right", bold: true, fill: PALE },
    ], rowH);
    y += rowH + 16;

    doc.save();
    doc.rect(margin, y, contentWidth, 56).fill(PALE).stroke(GRID);
    doc.restore();
    doc.fillColor(NAVY).font("Times-Bold").fontSize(11).text("NET PAY / IN-HAND SALARY", margin + 8, y + 8, { width: contentWidth - 16 });
    doc.fillColor(GRID).font("Times-Bold").fontSize(12).text(money(dto.netPayable, dto.company.currency), margin + 8, y + 24, { width: contentWidth - 16 });
    doc.fillColor(MUTED).font("Times-Italic").fontSize(8).text(dto.netPayableWords, margin + 8, y + 40, { width: contentWidth - 16 });
    y += 66;

    doc.fillColor(MUTED).font("Times-Roman").fontSize(8).text(`Calculation: ${dto.calculationSummary}`, margin, y, { width: contentWidth });
    y = doc.y + 10;

    if (dto.notes) {
      doc.fillColor(GRID).font("Times-Bold").fontSize(9).text("Notes", margin, y);
      y = doc.y + 2;
      doc.fillColor(MUTED).font("Times-Roman").fontSize(8).text(dto.notes, margin, y, { width: contentWidth });
      y = doc.y + 10;
    }

    doc.fillColor(MUTED).font("Times-Roman").fontSize(8)
      .text("This is a system-generated payslip and does not require a signature.", margin, Math.max(y + 8, page.height - margin - 24), {
        width: contentWidth,
        align: "center",
      });

    if (!dto.official) {
      doc.fillColor("#8A1C1C").font("Times-Bold").fontSize(8)
        .text("Draft / internal preview only. Official payslips require an approved payroll run.", margin, page.height - margin - 12, {
          width: contentWidth,
          align: "center",
        });
    }

    doc.end();
  });
}
