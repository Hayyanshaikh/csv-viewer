let rawData = [];
let headers = [];
let columnFilters = {};
let visibleColumns = new Set();
let currentSort = { index: -1, dir: "asc" };
let activeFilterCol = -1;
let dragCounter = 0;
let currentUploadedFileName = "";
const VIEW_STATE_KEY = "csvviewer:viewState:v1";
let isRestoringState = false;
let preferredGroupColumnName = null;

function getUploadedBaseName() {
  const sourceName =
    currentUploadedFileName ||
    document.getElementById("modal-filename")?.textContent ||
    "DataForge_Export";
  return sourceName.replace(/\.[^/.]+$/, "").trim() || "DataForge_Export";
}

function getColumnNameByIndex(i) {
  return headers[i] || "Column " + (i + 1);
}

function findColumnIndexByName(name) {
  return headers.findIndex((h, i) => getColumnNameByIndex(i) === name);
}

function readSavedViewState() {
  try {
    const raw = localStorage.getItem(VIEW_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

function clearSavedViewState() {
  try {
    localStorage.removeItem(VIEW_STATE_KEY);
  } catch (error) {
    // Ignore storage errors in private/restricted contexts.
  }
}

function saveViewState() {
  if (isRestoringState || headers.length === 0) return;
  try {
    const filterByColumnName = {};
    Object.keys(columnFilters).forEach((idx) => {
      const colIdx = Number(idx);
      if (!Number.isInteger(colIdx) || !headers[colIdx]) return;
      const values = [...(columnFilters[colIdx] || [])];
      if (values.length > 0)
        filterByColumnName[getColumnNameByIndex(colIdx)] = values;
    });

    const sortColumnName =
      currentSort.index >= 0 ? getColumnNameByIndex(currentSort.index) : null;

    const picker = document.getElementById("group-col-picker");
    let groupColumnName = preferredGroupColumnName;
    if (picker && picker.value !== "") {
      groupColumnName = getColumnNameByIndex(Number(picker.value));
    }

    const payload = {
      searchQuery: document.getElementById("global-search").value || "",
      sort: {
        columnName: sortColumnName,
        dir: currentSort.dir === "desc" ? "desc" : "asc",
      },
      visibleColumnNames: [...visibleColumns]
        .sort((a, b) => a - b)
        .map((i) => getColumnNameByIndex(i)),
      filterByColumnName,
      groupColumnName: groupColumnName || null,
    };

    localStorage.setItem(VIEW_STATE_KEY, JSON.stringify(payload));
  } catch (error) {
    // Ignore storage quota or serialization errors.
  }
}

function applySavedViewStateToCurrentCsv() {
  const saved = readSavedViewState();
  if (!saved) return false;

  isRestoringState = true;
  let hasApplied = false;

  if (typeof saved.searchQuery === "string") {
    document.getElementById("global-search").value = saved.searchQuery;
    hasApplied = hasApplied || saved.searchQuery.length > 0;
  }

  if (
    Array.isArray(saved.visibleColumnNames) &&
    saved.visibleColumnNames.length
  ) {
    const nextVisible = new Set();
    saved.visibleColumnNames.forEach((name) => {
      const idx = findColumnIndexByName(name);
      if (idx !== -1) nextVisible.add(idx);
    });
    if (nextVisible.size > 0) {
      visibleColumns = nextVisible;
      hasApplied = true;
    }
  }

  if (saved.sort && saved.sort.columnName) {
    const idx = findColumnIndexByName(saved.sort.columnName);
    if (idx !== -1) {
      currentSort = {
        index: idx,
        dir: saved.sort.dir === "desc" ? "desc" : "asc",
      };
      hasApplied = true;
    }
  }

  if (
    saved.filterByColumnName &&
    typeof saved.filterByColumnName === "object"
  ) {
    Object.keys(saved.filterByColumnName).forEach((columnName) => {
      const idx = findColumnIndexByName(columnName);
      if (idx === -1) return;
      const values = saved.filterByColumnName[columnName];
      if (!Array.isArray(values) || values.length === 0) return;
      columnFilters[idx] = new Set(values);
      hasApplied = true;
    });
  }

  preferredGroupColumnName =
    typeof saved.groupColumnName === "string" ? saved.groupColumnName : null;
  if (preferredGroupColumnName) hasApplied = true;

  isRestoringState = false;
  return hasApplied;
}

// 1. Column Bulk Actions
function bulkSelectColumns(shouldSelect) {
  if (shouldSelect) {
    headers.forEach((_, i) => visibleColumns.add(i));
  } else {
    // Keep at least one visible
    const first = visibleColumns.values().next().value || 0;
    visibleColumns.clear();
    visibleColumns.add(first);
  }
  renderColumnOptions();
}

// 2. Filter Bulk Actions
function bulkFilterValues(shouldSelect) {
  const uniqueValues = [
    ...new Set(rawData.slice(1).map((row) => row[activeFilterCol])),
  ];
  if (shouldSelect) {
    uniqueValues.forEach((v) => columnFilters[activeFilterCol].add(v));
  } else {
    columnFilters[activeFilterCol].clear();
  }
  renderFilterOptions();
}

function toggleColumnDropdown(e) {
  e.stopPropagation();
  closeFilterDropdown(false);
  const dropdown = document.getElementById("column-dropdown");
  if (dropdown.style.display === "flex") {
    closeColumnDropdown();
    return;
  }
  document.getElementById("column-search").value = "";
  renderColumnOptions();
  dropdown.style.display = "flex";
  const btn = e.currentTarget.getBoundingClientRect();
  dropdown.style.top = btn.bottom + 8 + "px";
  dropdown.style.left = Math.max(10, btn.right - 300) + "px";
}

function renderColumnOptions() {
  const list = document.getElementById("column-options-list");
  const search = document.getElementById("column-search").value.toLowerCase();
  list.innerHTML = headers
    .map((h, i) => {
      const colName = h || "Column " + (i + 1);
      if (search && !colName.toLowerCase().includes(search)) return "";
      const isChecked = visibleColumns.has(i) ? "checked" : "";
      return `<label class="dropdown-option"><input type="checkbox" onchange="toggleColumnVisibility(${i})" ${isChecked} class="w-4 h-4 rounded text-blue-600 focus:ring-0"><span class="truncate">${colName}</span></label>`;
    })
    .join("");
  document.getElementById("col-count-status").textContent =
    `${visibleColumns.size} Visible`;
}

function toggleColumnVisibility(idx) {
  if (visibleColumns.has(idx)) {
    if (visibleColumns.size > 1) visibleColumns.delete(idx);
  } else {
    visibleColumns.add(idx);
  }
  renderColumnOptions(); // Just update UI, apply happens on Close
}

function closeColumnDropdown() {
  document.getElementById("column-dropdown").style.display = "none";
  applyAllFilters();
}

window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragCounter++;
  document.body.classList.add("drag-active");
});
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragCounter--;
  if (dragCounter === 0) document.body.classList.remove("drag-active");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragCounter = 0;
  document.body.classList.remove("drag-active");
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

document.getElementById("drop-zone").onclick = () =>
  document.getElementById("csv-input").click();
document.getElementById("csv-input").onchange = (e) =>
  handleFile(e.target.files[0]);

function handleFile(file) {
  if (!file || !file.name.toLowerCase().endsWith(".csv")) return;
  currentUploadedFileName = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    const lines = e.target.result.split(/\r?\n/).filter((l) => l.trim() !== "");
    rawData = lines.map((line) => {
      let parts = [],
        cur = "",
        inQ = false;
      for (let char of line) {
        if (char === '"') inQ = !inQ;
        else if (char === "," && !inQ) {
          parts.push(cur.trim());
          cur = "";
        } else cur += char;
      }
      parts.push(cur.trim());
      return parts.map((p) => p.replace(/^"|"$/g, ""));
    });
    headers = rawData[0];
    visibleColumns = new Set(headers.map((_, i) => i));
    resetAllFilters(false, false);
    const restoredFromLocalStorage = applySavedViewStateToCurrentCsv();
    document.getElementById("modal-filename").textContent = file.name;
    document.getElementById("landing").classList.add("hidden");
    document.getElementById("modal").classList.remove("hidden");
    applyAllFilters();
    if (restoredFromLocalStorage) {
      showToast(
        "Warning: Previous view settings were restored. Use Clear Filters to reset local storage.",
        { warning: true, duration: 4200 },
      );
    }
  };
  reader.readAsText(file);
}

function isMissing(val) {
  return (
    val === null ||
    val === undefined ||
    val.toString().trim() === "" ||
    val.toString().trim() === "-"
  );
}

function applyAllFilters() {
  const query = document.getElementById("global-search").value.toLowerCase();
  let data = rawData.slice(1);
  Object.keys(columnFilters).forEach((idx) => {
    if (columnFilters[idx].size > 0)
      data = data.filter((row) => columnFilters[idx].has(row[idx]));
  });
  if (query)
    data = data.filter((row) =>
      row.some((cell) => cell.toString().toLowerCase().includes(query)),
    );

  if (currentSort.index !== -1) {
    data.sort((a, b) => {
      let vA = a[currentSort.index],
        vB = b[currentSort.index];
      const nA = parseFloat(vA),
        nB = parseFloat(vB);
      if (!isNaN(nA) && !isNaN(nB)) {
        vA = nA;
        vB = nB;
      }
      return vA < vB
        ? currentSort.dir === "asc"
          ? -1
          : 1
        : vA > vB
          ? currentSort.dir === "asc"
            ? 1
            : -1
          : 0;
    });
  }
  renderTable(data, query);
  saveViewState();
}

function renderTable(data, query) {
  const head = document.getElementById("table-head");
  const body = document.getElementById("table-body");
  let headHTML = "<tr>";
  headers.forEach((h, i) => {
    if (!visibleColumns.has(i)) return;
    const isFiltered =
      columnFilters[i] && columnFilters[i].size > 0
        ? "filter-active-icon"
        : "text-slate-300";
    const sortArrow =
      currentSort.index === i ? (currentSort.dir === "asc" ? "↑" : "↓") : "↕";
    headHTML += `<th><div class="flex items-center justify-between"><span onclick="toggleSort(${i})" class="flex-grow cursor-pointer">${h} <span class="sort-icon ${currentSort.index === i ? "sort-active" : ""}">${sortArrow}</span></span><button onclick="showFilterDropdown(event, ${i})" class="ml-2 p-1.5 hover:bg-slate-200 rounded-md transition-all ${isFiltered}"><svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z"></path></svg></button></div></th>`;
  });
  head.innerHTML = headHTML + "</tr>";
  body.innerHTML = data
    .map((row) => {
      let rowHTML = "<tr>";
      row.forEach((cell, i) => {
        if (visibleColumns.has(i))
          rowHTML += `<td><div class="table-cell"><span class="cell-value">${highlightText(cell, query)}</span><button type="button" class="cell-copy-btn" data-copy-value="${escapeHtmlAttribute(cell)}" aria-label="Copy cell value" onclick="copyCellValue(this)"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button></div></td>`;
      });
      return rowHTML + "</tr>";
    })
    .join("");
  document.getElementById("footer-stats").textContent =
    `Total Rows: ${rawData.length - 1} | Matches: ${data.length}`;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(text) {
  return escapeHtml(text).replace(/`/g, "&#96;");
}

function highlightText(text, query) {
  const escapedText = escapeHtml(text);
  if (!query) return escapedText;
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  return escapedText.replace(regex, '<span class="search-highlight">$1</span>');
}

async function copyCellValue(button) {
  const value = button.dataset.copyValue || "";
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const tempInput = document.createElement("textarea");
      tempInput.value = value;
      tempInput.setAttribute("readonly", "");
      tempInput.style.position = "absolute";
      tempInput.style.left = "-9999px";
      document.body.appendChild(tempInput);
      tempInput.select();
      document.execCommand("copy");
      document.body.removeChild(tempInput);
    }
    button.classList.add("copied");
    window.clearTimeout(button._copyResetTimer);
    button._copyResetTimer = window.setTimeout(() => {
      button.classList.remove("copied");
    }, 1200);
    showCopyToast();
  } catch (error) {
    console.error("Failed to copy cell value", error);
  }
}

function showToast(message, options = {}) {
  const toast = document.getElementById("copy-toast");
  const duration = Number(options.duration) || 3000;
  const isWarning = Boolean(options.warning);

  toast.textContent = message;
  toast.classList.toggle("warning", isWarning);
  toast.classList.add("show");

  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.classList.remove("show");
    toast.classList.remove("warning");
  }, duration);
}

function showCopyToast() {
  showToast("Copied", { duration: 3000 });
}

function resetAllFilters(apply = true, clearSavedState = true) {
  columnFilters = {};
  headers.forEach((_, i) => (columnFilters[i] = new Set()));
  document.getElementById("global-search").value = "";
  currentSort = { index: -1, dir: "asc" };
  preferredGroupColumnName = null;
  if (clearSavedState) clearSavedViewState();
  if (apply) applyAllFilters();
}

function toggleSort(i) {
  if (currentSort.index === i)
    currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
  else {
    currentSort.index = i;
    currentSort.dir = "asc";
  }
  applyAllFilters();
}

function showFilterDropdown(e, colIdx) {
  e.stopPropagation();
  activeFilterCol = colIdx;
  const dropdown = document.getElementById("filter-dropdown");
  const rect = e.currentTarget.getBoundingClientRect();
  document.getElementById("filter-search").value = "";
  renderFilterOptions();
  dropdown.style.display = "flex";
  dropdown.style.top = rect.bottom + 8 + "px";
  dropdown.style.left =
    Math.max(10, Math.min(rect.left - 150, window.innerWidth - 300)) + "px";
}

function renderFilterOptions() {
  const list = document.getElementById("filter-options-list");
  const search = document.getElementById("filter-search").value.toLowerCase();
  const uniqueValues = [
    ...new Set(rawData.slice(1).map((row) => row[activeFilterCol])),
  ].sort();
  const filtered = uniqueValues.filter((v) =>
    v.toString().toLowerCase().includes(search),
  );

  list.innerHTML = filtered
    .map((val) => {
      const isChecked = columnFilters[activeFilterCol].has(val)
        ? "checked"
        : "";
      return `<label class="dropdown-option"><input type="checkbox" onchange="toggleFilterValue('${val.toString().replace(/'/g, "\\'")}')" ${isChecked} class="w-4 h-4 rounded text-blue-600"><span class="truncate">${val || "(Blank)"}</span></label>`;
    })
    .join("");
  document.getElementById("filter-count-status").textContent =
    `${columnFilters[activeFilterCol].size} Selected`;
}

function toggleFilterValue(val) {
  if (columnFilters[activeFilterCol].has(val))
    columnFilters[activeFilterCol].delete(val);
  else columnFilters[activeFilterCol].add(val);
  document.getElementById("filter-count-status").textContent =
    `${columnFilters[activeFilterCol].size} Selected`;
}

function openGroupingModal() {
  const rows = rawData.slice(1);

  document.getElementById("grouping-summary-cards").innerHTML = `
          <div class="flex items-center gap-1.5"><span class="text-[9px] font-bold text-slate-400 uppercase">Rows:</span><span class="text-xs font-black">${rows.length}</span></div>
          <div class="flex items-center gap-1.5"><span class="text-[9px] font-bold text-slate-400 uppercase">Cols:</span><span class="text-xs font-black">${headers.length}</span></div>
          <div class="flex items-center gap-1.5"><span class="text-[9px] font-bold text-slate-400 uppercase text-cyan-500">Mode:</span><span class="text-xs font-black text-cyan-600">Grouping</span></div>
        `;

  const picker = document.getElementById("group-col-picker");
  picker.innerHTML =
    `<option value="">-- Select Field --</option>` +
    headers
      .map(
        (h, i) =>
          `<option value="${i}">${escapeHtml(h || "Col " + (i + 1))}</option>`,
      )
      .join("");

  if (preferredGroupColumnName) {
    const preferredIdx = findColumnIndexByName(preferredGroupColumnName);
    if (preferredIdx !== -1) picker.value = String(preferredIdx);
  }

  document.getElementById("group-wrapper").classList.add("hidden");
  document.getElementById("group-placeholder").classList.remove("hidden");
  document.getElementById("no-groups-msg").classList.add("hidden");
  document.getElementById("group-table-head").innerHTML = "";
  document.getElementById("group-table-body").innerHTML = "";

  document.getElementById("grouping-modal").classList.remove("hidden");
  if (picker.value !== "") detectAndRenderGroups();
}

function toggleGroup(groupId) {
  const rows = document.querySelectorAll(`[data-group-id="${groupId}"]`);
  const headerRow = document.getElementById(`header-row-${groupId}`);
  const isExpanding = headerRow.classList.toggle("expanded");
  rows.forEach((row) => {
    row.style.display = isExpanding ? "table-row" : "none";
  });
}

function getGroupedRowsByColumn(colIdx) {
  const rows = rawData.slice(1);
  const grouped = {};

  rows.forEach((row) => {
    const rawValue = row[colIdx];
    const groupKey = isMissing(rawValue) ? "(Blank)" : String(rawValue);
    if (!grouped[groupKey]) grouped[groupKey] = [];
    grouped[groupKey].push(row);
  });

  const groupKeys = Object.keys(grouped).sort((a, b) => {
    if (a === "(Blank)" && b !== "(Blank)") return 1;
    if (b === "(Blank)" && a !== "(Blank)") return -1;
    return a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });

  return { grouped, groupKeys };
}

function detectAndRenderGroups() {
  const colIdx = document.getElementById("group-col-picker").value;
  const wrapper = document.getElementById("group-wrapper");
  const placeholder = document.getElementById("group-placeholder");
  const body = document.getElementById("group-table-body");
  const head = document.getElementById("group-table-head");
  const noMsg = document.getElementById("no-groups-msg");

  if (colIdx === "") {
    preferredGroupColumnName = null;
    wrapper.classList.add("hidden");
    placeholder.classList.remove("hidden");
    saveViewState();
    return;
  }

  preferredGroupColumnName = getColumnNameByIndex(Number(colIdx));

  placeholder.classList.add("hidden");
  wrapper.classList.remove("hidden");

  const { grouped, groupKeys } = getGroupedRowsByColumn(Number(colIdx));

  if (groupKeys.length === 0) {
    body.innerHTML = "";
    head.innerHTML = "";
    noMsg.classList.remove("hidden");
    return;
  }

  noMsg.classList.add("hidden");
  head.innerHTML = `<tr>${headers.map((h, i) => `<th class="!py-2 px-6 text-[10px] font-black text-slate-400 uppercase bg-white border-b border-slate-200">${escapeHtml(h || "Col " + (i + 1))}</th>`).join("")}</tr>`;

  let finalHTML = "";
  groupKeys.forEach((val, idx) => {
    const groupRows = grouped[val];
    const groupId = `grp-group-${idx}`;
    finalHTML += `
            <tr id="header-row-${groupId}" class="group-header bg-cyan-50/40" onclick="toggleGroup('${groupId}')">
              <td colspan="${headers.length}" class="py-3 px-6 text-xs font-black text-slate-800 border-b !border-black/10">
                <div class="flex items-center gap-3">
                  <svg class="w-4 h-4 text-cyan-500 chevron-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-width="3" d="M9 5l7 7-7 7"></path></svg>
                  <span>${escapeHtml(val)}</span>
                  <span class="ml-auto sticky right-6 bg-cyan-100 text-cyan-700 px-2.5 py-0.5 rounded-full text-[10px]">${groupRows.length} RECORDS</span>
                </div>
              </td>
            </tr>
          `;

    groupRows.forEach((row) => {
      finalHTML += `
              <tr data-group-id="${groupId}" class="hidden-row bg-white hover:bg-cyan-50/20 transition-colors">
                ${row.map((cell, i) => `<td class="py-2.5 px-6 border-b border-slate-100 ${i == colIdx ? "font-bold text-cyan-700 bg-cyan-50/30" : "text-slate-600"}">${escapeHtml(cell)}</td>`).join("")}
              </tr>
            `;
    });
  });

  body.innerHTML = finalHTML;
  saveViewState();
}

function closeGroupingModal() {
  document.getElementById("grouping-modal").classList.add("hidden");
}
function closeFilterDropdown(apply = true) {
  document.getElementById("filter-dropdown").style.display = "none";
  if (apply) applyAllFilters();
}
function closeModal() {
  closeGroupingModal();
  document.getElementById("modal").classList.add("hidden");
  document.getElementById("landing").classList.remove("hidden");
}

function getExcelHeaderStyle() {
  return {
    font: { bold: true, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "0F766E" } },
    alignment: { horizontal: "center", vertical: "center" },
  };
}

function getExcelGroupStyle() {
  return {
    font: { bold: true, color: { rgb: "0E7490" } },
    fill: { fgColor: { rgb: "CFFAFE" } },
    alignment: { horizontal: "left", vertical: "center" },
  };
}

function applyRowStyle(ws, rowIndex, colCount, style) {
  for (let col = 0; col < colCount; col += 1) {
    const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: col });
    if (!ws[cellAddress]) ws[cellAddress] = { t: "s", v: "" };
    ws[cellAddress].s = style;
  }
}

document.getElementById("btn-export").onclick = () => {
  const filteredData = rawData.map((row) =>
    row.filter((_, i) => visibleColumns.has(i)),
  );
  const ws = XLSX.utils.aoa_to_sheet(filteredData);
  if (filteredData.length > 0) {
    applyRowStyle(ws, 0, filteredData[0].length, getExcelHeaderStyle());
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "DataForge");
  XLSX.writeFile(wb, `${getUploadedBaseName()}.xlsx`);
};

document.getElementById("btn-group-export").onclick = () => {
  const colIdx = document.getElementById("group-col-picker").value;
  if (colIdx === "") {
    showToast("Warning: Select a grouping column before export.", {
      warning: true,
      duration: 3200,
    });
    return;
  }

  const selectedColIdx = Number(colIdx);
  const selectedGroupColumnName =
    headers[selectedColIdx] || `Column ${selectedColIdx + 1}`;
  const { grouped, groupKeys } = getGroupedRowsByColumn(selectedColIdx);
  const aoa = [headers];
  const merges = [];
  const groupHeaderRows = [];

  groupKeys.forEach((groupKey) => {
    const groupHeaderRowIndex = aoa.length;
    groupHeaderRows.push(groupHeaderRowIndex);
    const groupHeaderRow = new Array(headers.length).fill("");
    groupHeaderRow[0] = `${selectedGroupColumnName}: ${groupKey} (${grouped[groupKey].length} records)`;
    aoa.push(groupHeaderRow);
    if (headers.length > 1) {
      merges.push({
        s: { r: groupHeaderRowIndex, c: 0 },
        e: { r: groupHeaderRowIndex, c: headers.length - 1 },
      });
    }
    grouped[groupKey].forEach((row) => aoa.push(row));
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (merges.length) ws["!merges"] = merges;
  if (headers.length > 0) {
    applyRowStyle(ws, 0, headers.length, getExcelHeaderStyle());
    groupHeaderRows.forEach((rowIndex) => {
      applyRowStyle(ws, rowIndex, headers.length, getExcelGroupStyle());
    });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "GroupedData");

  const safeColName = String(
    headers[selectedColIdx] || `Column_${selectedColIdx + 1}`,
  )
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  const fileName = `${getUploadedBaseName()}_Grouped_${safeColName || "Column"}.xlsx`;

  XLSX.writeFile(wb, fileName);
  showToast("Grouped Excel exported.", { duration: 2600 });
};

window.onclick = (e) => {
  if (
    !document.getElementById("filter-dropdown").contains(e.target) &&
    !e.target.closest("button")
  )
    closeFilterDropdown(false);
  if (
    !document.getElementById("column-dropdown").contains(e.target) &&
    !e.target.closest("#column-selector-btn")
  )
    closeColumnDropdown();
};
window.onkeydown = (e) => {
  if (e.key === "Escape") {
    closeFilterDropdown();
    closeColumnDropdown();
    closeGroupingModal();
    closeModal();
  }
};
