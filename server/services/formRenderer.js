"use strict";

const PDFDocument = require("pdfkit");

function esc(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nice(value) {
  if (value === null || value === undefined || value === "") {
    return "\u2014";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value);
}

function scopeLine(data) {
  const scope = data.scope || {};
  const bits = [];
  if (scope.schoolYear && scope.schoolYear.name) bits.push(`School Year ${scope.schoolYear.name}`);
  if (scope.gradeLevel && scope.gradeLevel.name) bits.push(`Grade ${scope.gradeLevel.name}`);
  if (scope.section && scope.section.name) bits.push(`Section ${scope.section.name}`);
  if (scope.period) bits.push(`Period ${scope.period}`);
  if (scope.learner && scope.learner.name) bits.push(scope.learner.name);
  return bits.join(" \u2022 ");
}

function renderHtml(data, options = {}) {
  const status = options.status || "draft";
  const draft = !["approved", "finalized"].includes(status);
  const landscape = (data.template && data.template.orientation) === "landscape";
  const paper = (data.template && data.template.paperSize) || "A4";
  const school = data.scope && data.scope.school ? data.scope.school : {};
  const district = data.scope && data.scope.district ? data.scope.district : {};
  const summary = (data.summary || [])
    .map(
      (item) =>
        `<div class="sf-summary__item"><span>${esc(item.label)}</span><strong>${esc(nice(item.value))}</strong></div>`
    )
    .join("");
  const tables = (data.tables || [])
    .map((table) => {
      const columns = table.columns || [];
      const head = columns
        .map(
          (column) =>
            `<th class="align-${esc(column.align || "left")}" style="width:${Number(column.width || 1)}%">${esc(column.label)}</th>`
        )
        .join("");
      const rows = (table.rows || [])
        .map(
          (row) =>
            `<tr>${columns
              .map(
                (column) =>
                  `<td class="align-${esc(column.align || "left")}">${esc(nice(row[column.key]))}</td>`
              )
              .join("")}</tr>`
        )
        .join("");
      const empty = rows
        ? ""
        : `<tr><td colspan="${columns.length}" class="sf-empty">${esc(table.emptyText || "No records for this scope.")}</td></tr>`;
      return `<section class="sf-table-block">
        ${table.title ? `<h3>${esc(table.title)}</h3>` : ""}
        ${table.note ? `<p class="sf-note">${esc(table.note)}</p>` : ""}
        <table class="sf-table"><thead><tr>${head}</tr></thead><tbody>${rows}${empty}</tbody></table>
      </section>`;
    })
    .join("");
  const errors = (data.validation && data.validation.errors) || [];
  const warnings = (data.validation && data.validation.warnings) || [];
  const issueList = errors
    .slice(0, 12)
    .map(
      (issue) =>
        `<li><strong>${esc(issue.message)}</strong>${
          issue.source && issue.source.label ? ` <span>${esc(issue.source.label)}</span>` : ""
        }</li>`
    )
    .join("");
  const warningList = warnings
    .slice(0, 8)
    .map((issue) => `<li>${esc(issue.message)}</li>`)
    .join("");
  const validationBlock =
    errors.length || warnings.length
      ? `<section class="sf-validation${errors.length ? " has-errors" : ""}">
          <h3>Validation ${data.validation.complete ? "passed" : "needs attention"}</h3>
          ${issueList ? `<ul class="sf-errors">${issueList}</ul>` : ""}
          ${warningList ? `<ul class="sf-warnings">${warningList}</ul>` : ""}
          ${errors.length > 12 ? `<p class="sf-note">Showing the first 12 of ${errors.length} open items.</p>` : ""}
        </section>`
      : `<section class="sf-validation is-clear"><h3>Validation passed</h3><p>All required source records for this scope are present.</p></section>`;
  const signatures = (data.signatures || [])
    .map(
      (signature) =>
        `<div class="sf-signature"><span class="sf-signature__line"></span><strong>${esc(signature.name || "")}</strong><small>${esc(signature.label || "")}</small></div>`
    )
    .join("");
  const generatedAt = data.generatedAt
    ? new Date(data.generatedAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(data.title)} — ${esc(school.name || "")}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px; background: #eef2f7; color: #16212e;
    font-family: "Segoe UI", Arial, sans-serif; font-size: 11px; line-height: 1.4; }
  .sf-doc { max-width: ${landscape ? "1400px" : "900px"}; margin: 0 auto; background: #fff;
    padding: ${landscape ? "22px 24px" : "28px 30px"}; border: 1px solid #cbd5e1; border-radius: 4px; }
  .sf-head { display: flex; justify-content: space-between; gap: 16px; border-bottom: 2px solid #16212e; padding-bottom: 10px; }
  .sf-head__school { font-size: 12px; font-weight: 600; }
  .sf-head__district { font-size: 10px; color: #475569; }
  .sf-head__form { text-align: right; }
  .sf-head__form h1 { margin: 0; font-size: 16px; letter-spacing: .02em; }
  .sf-head__code { font-size: 10px; color: #475569; }
  .sf-scope { margin: 8px 0 12px; font-size: 10px; color: #334155; }
  .sf-banner { margin: 10px 0; padding: 7px 10px; border: 1px solid #c2410c; background: #fff7ed;
    color: #9a3412; font-size: 10px; border-radius: 3px; }
  .sf-banner strong { text-transform: uppercase; letter-spacing: .06em; }
  .sf-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 6px; margin: 12px 0; }
  .sf-summary__item { border: 1px solid #d7dee8; background: #f8fafc; padding: 6px 8px; border-radius: 3px; }
  .sf-summary__item span { display: block; font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: .04em; }
  .sf-summary__item strong { font-size: 13px; }
  .sf-table-block { margin-top: 14px; break-inside: auto; }
  .sf-table-block h3 { font-size: 11px; margin: 0 0 5px; }
  table.sf-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: ${landscape ? "8.2px" : "9.5px"}; }
  .sf-table th, .sf-table td { border: 1px solid #94a3b8; padding: 3px 4px; vertical-align: top; overflow-wrap: anywhere; }
  .sf-table th { background: #e2e8f0; font-size: 8px; text-transform: uppercase; letter-spacing: .03em; }
  .sf-table thead { display: table-header-group; }
  .sf-table tr { break-inside: avoid; }
  .align-right { text-align: right; }
  .align-center { text-align: center; }
  .sf-empty { text-align: center; color: #64748b; padding: 10px; }
  .sf-note { margin: 4px 0; color: #475569; font-size: 9px; }
  .sf-validation { margin-top: 14px; border: 1px solid #cbd5e1; background: #f8fafc; padding: 8px 10px; border-radius: 3px; }
  .sf-validation h3 { margin: 0 0 4px; font-size: 10px; }
  .sf-validation.has-errors { border-color: #ef4444; background: #fef2f2; }
  .sf-validation.is-clear { border-color: #86efac; background: #f0fdf4; }
  .sf-errors, .sf-warnings { margin: 4px 0 0 16px; padding: 0; }
  .sf-errors li { color: #991b1b; margin-bottom: 2px; }
  .sf-warnings li { color: #92400e; margin-bottom: 2px; }
  .sf-signatures { display: flex; justify-content: space-between; gap: 30px; margin-top: 34px; break-inside: avoid; }
  .sf-signature { flex: 1; text-align: center; font-size: 9px; }
  .sf-signature__line { display: block; border-bottom: 1px solid #16212e; height: 26px; margin-bottom: 4px; }
  .sf-signature strong { display: block; font-size: 10px; }
  .sf-signature small { color: #475569; }
  .sf-footer { margin-top: 20px; border-top: 1px solid #cbd5e1; padding-top: 6px; color: #64748b;
    font-size: 8px; display: flex; justify-content: space-between; gap: 12px; }
  .sf-draft { color: #b91c1c; font-weight: 700; letter-spacing: .08em; }
  @media print {
    body { background: #fff; padding: 0; font-size: 9.5px; }
    .sf-doc { max-width: none; border: 0; padding: 0; border-radius: 0; }
    @page { size: ${paper} ${landscape ? "landscape" : "portrait"}; margin: 10mm; }
    .sf-table { font-size: ${landscape ? "7.6px" : "8.8px"}; }
    .sf-summary__item { break-inside: avoid; }
  }
</style>
</head>
<body>
  <main class="sf-doc">
    <header class="sf-head">
      <div>
        <div class="sf-head__school">${esc(school.name || "")}</div>
        <div class="sf-head__district">${esc(district.name || "")}${school.code ? ` \u2022 School ID ${esc(school.code)}` : ""}</div>
        <div class="sf-head__district">${esc(school.address || "")}</div>
      </div>
      <div class="sf-head__form">
        <div class="sf-head__code">${esc(data.code ? data.code.toUpperCase() : "")}</div>
        <h1>${esc(data.title)}</h1>
        <div class="sf-head__code">${esc(data.purpose || "")}</div>
      </div>
    </header>
    <div class="sf-scope">${esc(scopeLine(data))}</div>
    ${
      draft
        ? `<div class="sf-banner"><strong>Draft / system layout.</strong> This preview is not an approved or finalized school form. ${
            data.isOfficial
              ? ""
              : "The layout is a system-generated table pending verification against the current official DepEd template."
          }</div>`
        : ""
    }
    ${summary ? `<section class="sf-summary">${summary}</section>` : ""}
    ${tables}
    ${validationBlock}
    <section class="sf-signatures">${signatures}</section>
    <footer class="sf-footer">
      <span>${esc(data.template ? `${data.template.name} ${data.template.version}` : "System template")} \u2022 Generated ${esc(generatedAt)}</span>
      <span class="${draft ? "sf-draft" : ""}">${esc(String(status).replace(/_/g, " ").toUpperCase())}</span>
    </footer>
  </main>
</body>
</html>`;
}

function pdfText(value) {
  return nice(value);
}

function renderPdfBuffer(data, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const status = options.status || "draft";
      const draft = !["approved", "finalized"].includes(status);
      const landscape = (data.template && data.template.orientation) === "landscape";
      const paper = String((data.template && data.template.paperSize) || "A4").toUpperCase();
      const size = paper === "LEGAL" ? "LEGAL" : paper === "LETTER" ? "LETTER" : "A4";
      const doc = new PDFDocument({
        size,
        layout: landscape ? "landscape" : "portrait",
        margins: { top: 34, bottom: 36, left: 30, right: 30 },
        bufferPages: true,
        info: {
          Title: `${data.title} - ${data.scope && data.scope.school ? data.scope.school.name : ""}`,
          Author: "School District Monitoring System",
          Subject: `${data.code ? data.code.toUpperCase() : ""} system-generated school form`,
          CreationDate: new Date()
        }
      });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const pageWidth = doc.page.width;
      const left = doc.page.margins.left;
      const contentWidth = pageWidth - left - doc.page.margins.right;
      const school = data.scope && data.scope.school ? data.scope.school : {};
      const district = data.scope && data.scope.district ? data.scope.district : {};

      function footer() {
        const range = doc.bufferedPageRange();
        for (let index = 0; index < range.count; index += 1) {
          doc.switchToPage(range.start + index);
          doc.fontSize(7).fillColor("#64748b").font("Helvetica");
          doc.text(
            `${data.code ? data.code.toUpperCase() : ""} \u2022 System layout \u2022 Generated ${new Date(data.generatedAt || Date.now()).toLocaleString("en-PH")}`,
            left,
            doc.page.height - 24,
            { width: contentWidth - 80, lineBreak: false }
          );
          doc.text(`Page ${index + 1} of ${range.count}`, left + contentWidth - 80, doc.page.height - 24, {
            width: 80,
            align: "right",
            lineBreak: false
          });
        }
      }

      function ensureSpace(height) {
        if (doc.y + height > doc.page.height - doc.page.margins.bottom - 8) {
          doc.addPage();
        }
      }

      // Header
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11);
      doc.text(school.name || "", left, doc.y, { width: contentWidth * 0.6 });
      doc.font("Helvetica").fontSize(8).fillColor("#475569");
      doc.text(`${district.name || ""}${school.code ? ` \u2022 School ID ${school.code}` : ""}`, { width: contentWidth * 0.6 });
      if (school.address) {
        doc.text(school.address, { width: contentWidth * 0.6 });
      }
      const headerBottom = doc.y;
      doc.y = 34;
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(14);
      doc.text(data.title || "", left + contentWidth * 0.55, 34, { width: contentWidth * 0.45, align: "right" });
      doc.font("Helvetica").fontSize(8).fillColor("#475569");
      doc.text(
        `${String(data.code || "").toUpperCase()} \u2022 ${data.purpose || ""}`,
        left + contentWidth * 0.55,
        doc.y,
        { width: contentWidth * 0.45, align: "right" }
      );
      doc.y = Math.max(doc.y, headerBottom) + 6;
      doc.moveTo(left, doc.y).lineTo(left + contentWidth, doc.y).strokeColor("#0f172a").lineWidth(1).stroke();
      doc.moveDown(0.4);
      doc.font("Helvetica").fontSize(8).fillColor("#334155");
      doc.text(scopeLine(data), left, doc.y, { width: contentWidth });

      if (draft) {
        doc.moveDown(0.4);
        const note = data.isOfficial
          ? "DRAFT. This preview is not an approved or finalized school form."
          : "DRAFT / SYSTEM LAYOUT. Not an approved DepEd template. Verify this layout against the current official form before official use.";
        const height = doc.heightOfString(note, { width: contentWidth - 12 }) + 8;
        ensureSpace(height + 6);
        const y = doc.y;
        doc.rect(left, y, contentWidth, height).fillAndStroke("#fff7ed", "#c2410c");
        doc.fillColor("#9a3412").fontSize(7.5).text(note, left + 6, y + 4, { width: contentWidth - 12 });
        doc.y = y + height + 6;
      }

      if (data.summary && data.summary.length) {
        doc.moveDown(0.3);
        const summary = data.summary
          .map((item) => `${item.label}: ${pdfText(item.value)}`)
          .join("     ");
        const height = doc.heightOfString(summary, { width: contentWidth }) + 6;
        ensureSpace(height);
        doc.font("Helvetica-Bold").fontSize(8).fillColor("#334155").text(summary, left, doc.y, {
          width: contentWidth
        });
        doc.moveDown(0.3);
      }

      (data.tables || []).forEach((table) => {
        const columns = table.columns || [];
        if (!columns.length) return;
        const usable = contentWidth;
        const weights = columns.map((column) => Number(column.width || 1));
        const totalWeight = weights.reduce((sum, value) => sum + value, 0) || columns.length;
        const widths = weights.map((weight) => (usable * weight) / totalWeight);
        const fontSize = landscape ? (columns.length > 16 ? 5.6 : 6.6) : columns.length > 12 ? 6 : 7.2;

        doc.moveDown(0.6);
        ensureSpace(34);
        if (table.title) {
          doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0f172a").text(table.title, left, doc.y, {
            width: contentWidth
          });
        }
        if (table.note) {
          doc.font("Helvetica").fontSize(7).fillColor("#475569").text(table.note, left, doc.y, {
            width: contentWidth
          });
        }
        doc.moveDown(0.2);

        function drawHeader() {
          const headerHeight =
            Math.max(
              ...columns.map((column) =>
                doc.heightOfString(String(column.label || ""), { width: widths[columns.indexOf(column)] - 4 })
              )
            ) + 5;
          ensureSpace(headerHeight + 14);
          const y = doc.y;
          doc.rect(left, y, contentWidth, headerHeight).fillAndStroke("#e2e8f0", "#64748b");
          let x = left;
          columns.forEach((column, index) => {
            doc
              .fillColor("#0f172a")
              .font("Helvetica-Bold")
              .fontSize(fontSize)
              .text(String(column.label || ""), x + 2, y + 2.5, {
                width: widths[index] - 4,
                height: headerHeight - 4,
                ellipsis: true
              });
            x += widths[index];
          });
          doc.y = y + headerHeight;
          return headerHeight;
        }

        drawHeader();
        const rows = table.rows || [];
        if (!rows.length) {
          ensureSpace(16);
          const y = doc.y;
          doc.rect(left, y, contentWidth, 14).strokeColor("#94a3b8").stroke();
          doc.fillColor("#64748b").font("Helvetica-Oblique").fontSize(fontSize).text(
            table.emptyText || "No records for this scope.",
            left + 3,
            y + 3,
            { width: contentWidth - 6 }
          );
          doc.y = y + 14;
        }
        rows.forEach((row) => {
          const cells = columns.map((column, index) => {
            const text = pdfText(row[column.key]);
            const height = doc.heightOfString(text, { width: widths[index] - 4 });
            return { text, height };
          });
          const rowHeight = Math.max(...cells.map((cell) => cell.height)) + 4;
          if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 8) {
            doc.addPage();
            drawHeader();
          }
          const y = doc.y;
          let x = left;
          cells.forEach((cell, index) => {
            doc.rect(x, y, widths[index], rowHeight).strokeColor("#94a3b8").lineWidth(0.4).stroke();
            doc
              .fillColor("#0f172a")
              .font("Helvetica")
              .fontSize(fontSize)
              .text(cell.text, x + 2, y + 2, {
                width: widths[index] - 4,
                height: rowHeight - 4,
                ellipsis: true
              });
            x += widths[index];
          });
          doc.y = y + rowHeight;
        });
      });

      // Validation summary
      const errors = (data.validation && data.validation.errors) || [];
      const warnings = (data.validation && data.validation.warnings) || [];
      if (errors.length || warnings.length) {
        doc.moveDown(0.8);
        ensureSpace(50);
        doc.font("Helvetica-Bold").fontSize(8).fillColor(errors.length ? "#991b1b" : "#92400e");
        doc.text(
          `Validation: ${errors.length ? `${errors.length} issue(s) need correction` : "passed with warnings"}`,
          left,
          doc.y,
          { width: contentWidth }
        );
        doc.font("Helvetica").fontSize(7).fillColor("#7f1d1d");
        errors.slice(0, 12).forEach((issue) => {
          doc.text(`\u2022 ${issue.message}`, left, doc.y, { width: contentWidth });
        });
        doc.fillColor("#92400e");
        warnings.slice(0, 6).forEach((issue) => {
          doc.text(`\u2022 ${issue.message}`, left, doc.y, { width: contentWidth });
        });
      }

      // Signatures
      if (data.signatures && data.signatures.length) {
        doc.moveDown(1.4);
        ensureSpace(60);
        const width = contentWidth / data.signatures.length;
        const y = doc.y;
        data.signatures.forEach((signature, index) => {
          const x = left + index * width;
          doc.moveTo(x + 8, y + 24).lineTo(x + width - 8, y + 24).strokeColor("#0f172a").stroke();
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0f172a").text(signature.name || "", x + 8, y + 27, {
            width: width - 16,
            align: "center"
          });
          doc.font("Helvetica").fontSize(6.5).fillColor("#475569").text(signature.label || "", x + 8, y + 36, {
            width: width - 16,
            align: "center"
          });
        });
        doc.y = y + 48;
      }

      footer();
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = { renderHtml, renderPdfBuffer, esc };
