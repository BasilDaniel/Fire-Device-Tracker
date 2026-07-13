"use strict";

const STORAGE_KEY = "fireDeviceTracker.devices.v1";

const REQUIRED_CSV_COLUMNS = [
  "Address",
  "Device ID",
  "Device type",
  "Description",
];

const state = {
  devices: [],
  searchQuery: "",
  activeFilter: "all",
  highlightedDeviceId: null,
  scanner: null,
  scannerRunning: false,
  highlightTimer: null,
  toastTimer: null,
};

const elements = {
  searchInput: document.getElementById("searchInput"),
  clearSearchButton: document.getElementById("clearSearchButton"),
  scannerButton: document.getElementById("scannerButton"),

  filterButtons: Array.from(document.querySelectorAll(".filter-button")),

  totalCount: document.getElementById("totalCount"),
  printedCount: document.getElementById("printedCount"),
  installedCount: document.getElementById("installedCount"),
  completedCount: document.getElementById("completedCount"),

  emptyState: document.getElementById("emptyState"),
  noResultsState: document.getElementById("noResultsState"),
  deviceContent: document.getElementById("deviceContent"),

  mobileDeviceList: document.getElementById("mobileDeviceList"),
  desktopDeviceTableBody: document.getElementById("desktopDeviceTableBody"),

  dataMenuButton: document.getElementById("dataMenuButton"),
  dataMenu: document.getElementById("dataMenu"),
  menuBackdrop: document.getElementById("menuBackdrop"),
  closeDataMenuButton: document.getElementById("closeDataMenuButton"),

  importButton: document.getElementById("importButton"),
  emptyImportButton: document.getElementById("emptyImportButton"),
  exportButton: document.getElementById("exportButton"),
  clearDataButton: document.getElementById("clearDataButton"),
  csvFileInput: document.getElementById("csvFileInput"),

  resetFiltersButton: document.getElementById("resetFiltersButton"),

  scannerModal: document.getElementById("scannerModal"),
  closeScannerButton: document.getElementById("closeScannerButton"),
  qrReader: document.getElementById("qrReader"),
  scannerStatus: document.getElementById("scannerStatus"),
  manualQrInput: document.getElementById("manualQrInput"),
  manualQrSearchButton: document.getElementById("manualQrSearchButton"),

  toast: document.getElementById("toast"),
};

const dataRepository = {
  async getAll() {
    const rawValue = localStorage.getItem(STORAGE_KEY);

    if (!rawValue) {
      return [];
    }

    try {
      const parsedValue = JSON.parse(rawValue);

      if (!Array.isArray(parsedValue)) {
        return [];
      }

      return parsedValue
        .map(normalizeStoredDevice)
        .filter((device) => device.deviceId);
    } catch (error) {
      console.error("Не удалось прочитать данные:", error);
      return [];
    }
  },

  async saveAll(devices) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
  },

  async clear() {
    localStorage.removeItem(STORAGE_KEY);
  },
};

function normalizeStoredDevice(device) {
  return {
    address: String(device.address || "").trim(),
    deviceId: String(device.deviceId || "").trim(),
    deviceType: String(device.deviceType || "").trim(),
    description: String(device.description || "").trim(),
    printed: Boolean(device.printed),
    installed: Boolean(device.installed),
  };
}

function normalizeSearchValue(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase();
}

function normalizeHeaderName(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeCsvValue(value) {
  const stringValue = String(value ?? "");

  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replaceAll('"', '""')}"`;
  }

  return stringValue;
}

function parseBooleanCsvValue(value) {
  const normalizedValue = normalizeSearchValue(value);

  return ["true", "1", "yes", "y", "да", "taip", "checked"].includes(
    normalizedValue,
  );
}

function sortDevices(devices) {
  return [...devices].sort((firstDevice, secondDevice) => {
    const addressComparison = firstDevice.address.localeCompare(
      secondDevice.address,
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    );

    if (addressComparison !== 0) {
      return addressComparison;
    }

    return firstDevice.deviceId.localeCompare(
      secondDevice.deviceId,
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    );
  });
}

function getFilteredDevices() {
  const normalizedQuery = normalizeSearchValue(state.searchQuery);

  return state.devices.filter((device) => {
    const matchesSearch =
      !normalizedQuery ||
      normalizeSearchValue(device.address).includes(normalizedQuery) ||
      normalizeSearchValue(device.deviceId).includes(normalizedQuery) ||
      normalizeSearchValue(device.description).includes(normalizedQuery);

    if (!matchesSearch) {
      return false;
    }

    switch (state.activeFilter) {
      case "printed":
        return device.printed;

      case "not-printed":
        return !device.printed;

      case "installed":
        return device.installed;

      case "not-installed":
        return !device.installed;

      case "all":
      default:
        return true;
    }
  });
}

function renderStatistics() {
  const total = state.devices.length;

  const printed = state.devices.filter((device) => device.printed).length;

  const installed = state.devices.filter((device) => device.installed).length;

  const completed = state.devices.filter(
    (device) => device.printed && device.installed,
  ).length;

  elements.totalCount.textContent = String(total);
  elements.printedCount.textContent = String(printed);
  elements.installedCount.textContent = String(installed);
  elements.completedCount.textContent = String(completed);
}

function createMobileDeviceCard(device) {
  const highlightedClass =
    device.deviceId === state.highlightedDeviceId ? " is-highlighted" : "";

  const printedCompleteClass = device.printed ? " is-complete" : "";

  const installedCompleteClass = device.installed ? " is-complete" : "";

  return `
    <article
      class="device-card${highlightedClass}"
      data-device-id="${escapeHtml(device.deviceId)}"
    >
      <div class="device-card__top">
        <div>
          <h2 class="device-card__address">
            ${escapeHtml(device.address || "Без адреса")}
          </h2>

          <p class="device-card__id">
            Device ID: ${escapeHtml(device.deviceId)}
          </p>
        </div>
      </div>

      ${
        device.deviceType
          ? `
            <div class="device-card__type">
              ${escapeHtml(device.deviceType)}
            </div>
          `
          : ""
      }

      ${
        device.description
          ? `
            <p class="device-card__description">
              ${escapeHtml(device.description)}
            </p>
          `
          : ""
      }

      <div class="device-card__statuses">
        <label class="status-toggle${printedCompleteClass}">
          <input
            type="checkbox"
            data-device-id="${escapeHtml(device.deviceId)}"
            data-status-field="printed"
            ${device.printed ? "checked" : ""}
          >

          <span
            class="status-toggle__box"
            aria-hidden="true"
          >
            ✓
          </span>

          <span>Printed</span>
        </label>

        <label class="status-toggle${installedCompleteClass}">
          <input
            type="checkbox"
            data-device-id="${escapeHtml(device.deviceId)}"
            data-status-field="installed"
            ${device.installed ? "checked" : ""}
          >

          <span
            class="status-toggle__box"
            aria-hidden="true"
          >
            ✓
          </span>

          <span>Installed</span>
        </label>
      </div>
    </article>
  `;
}

function createDesktopDeviceRow(device) {
  const highlightedClass =
    device.deviceId === state.highlightedDeviceId ? " is-highlighted" : "";

  return `
    <tr
      class="${highlightedClass.trim()}"
      data-device-id="${escapeHtml(device.deviceId)}"
    >
      <td>
        <strong>${escapeHtml(device.address)}</strong>
      </td>

      <td class="device-table__id">
        ${escapeHtml(device.deviceId)}
      </td>

      <td>
        ${escapeHtml(device.deviceType)}
      </td>

      <td>
        ${escapeHtml(device.description)}
      </td>

      <td class="status-column">
        <label class="table-checkbox">
          <span class="visually-hidden">
            Printed: ${escapeHtml(device.deviceId)}
          </span>

          <input
            type="checkbox"
            data-device-id="${escapeHtml(device.deviceId)}"
            data-status-field="printed"
            ${device.printed ? "checked" : ""}
          >
        </label>
      </td>

      <td class="status-column">
        <label class="table-checkbox">
          <span class="visually-hidden">
            Installed: ${escapeHtml(device.deviceId)}
          </span>

          <input
            type="checkbox"
            data-device-id="${escapeHtml(device.deviceId)}"
            data-status-field="installed"
            ${device.installed ? "checked" : ""}
          >
        </label>
      </td>
    </tr>
  `;
}

function renderDevices() {
  const filteredDevices = getFilteredDevices();
  const hasDevices = state.devices.length > 0;
  const hasResults = filteredDevices.length > 0;

  elements.emptyState.hidden = hasDevices;
  elements.noResultsState.hidden = !hasDevices || hasResults;
  elements.deviceContent.hidden = !hasDevices || !hasResults;

  if (!hasDevices || !hasResults) {
    elements.mobileDeviceList.innerHTML = "";
    elements.desktopDeviceTableBody.innerHTML = "";
    return;
  }

  elements.mobileDeviceList.innerHTML = filteredDevices
    .map(createMobileDeviceCard)
    .join("");

  elements.desktopDeviceTableBody.innerHTML = filteredDevices
    .map(createDesktopDeviceRow)
    .join("");
}

function renderSearchControls() {
  elements.clearSearchButton.hidden = state.searchQuery.length === 0;

  elements.filterButtons.forEach((button) => {
    const isActive = button.dataset.filter === state.activeFilter;

    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function render() {
  renderStatistics();
  renderSearchControls();
  renderDevices();
}

async function saveDevices() {
  try {
    await dataRepository.saveAll(state.devices);
  } catch (error) {
    console.error("Не удалось сохранить данные:", error);

    showToast("Не удалось сохранить изменения", "error");
  }
}

async function updateDeviceStatus(deviceId, statusField, checked) {
  if (statusField !== "printed" && statusField !== "installed") {
    return;
  }

  const device = state.devices.find((item) => item.deviceId === deviceId);

  if (!device) {
    return;
  }

  device[statusField] = Boolean(checked);

  await saveDevices();
  render();
}

function parseCsv(text) {
  const rows = [];
  let currentRow = [];
  let currentValue = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (insideQuotes) {
      if (character === '"' && nextCharacter === '"') {
        currentValue += '"';
        index += 1;
        continue;
      }

      if (character === '"') {
        insideQuotes = false;
        continue;
      }

      currentValue += character;
      continue;
    }

    if (character === '"') {
      insideQuotes = true;
      continue;
    }

    if (character === ",") {
      currentRow.push(currentValue);
      currentValue = "";
      continue;
    }

    if (character === "\n") {
      currentRow.push(currentValue.replace(/\r$/, ""));

      rows.push(currentRow);

      currentRow = [];
      currentValue = "";
      continue;
    }

    currentValue += character;
  }

  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue.replace(/\r$/, ""));

    rows.push(currentRow);
  }

  return rows.filter((row) => row.some((value) => String(value).trim() !== ""));
}

function detectDelimiter(text) {
  const firstNonEmptyLine = text
    .split(/\r?\n/)
    .find((line) => line.trim() !== "");

  if (!firstNonEmptyLine) {
    return ",";
  }

  const commaCount = firstNonEmptyLine.split(",").length - 1;

  const semicolonCount = firstNonEmptyLine.split(";").length - 1;

  return semicolonCount > commaCount ? ";" : ",";
}

function convertDelimiterToComma(text, delimiter) {
  if (delimiter === ",") {
    return text;
  }

  let result = "";
  let insideQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && insideQuotes && nextCharacter === '"') {
      result += '""';
      index += 1;
      continue;
    }

    if (character === '"') {
      insideQuotes = !insideQuotes;
      result += character;
      continue;
    }

    if (character === delimiter && !insideQuotes) {
      result += ",";
      continue;
    }

    result += character;
  }

  return result;
}

function getColumnIndexMap(headers) {
  const normalizedHeaders = headers.map(normalizeHeaderName);

  const aliases = {
    address: ["address"],
    deviceId: ["device id", "deviceid", "device_id", "id"],
    deviceType: ["device type", "devicetype", "device_type", "type"],
    description: ["description"],
    printed: ["printed"],
    installed: ["installed"],
  };

  const result = {};

  Object.entries(aliases).forEach(([fieldName, fieldAliases]) => {
    result[fieldName] = normalizedHeaders.findIndex((header) =>
      fieldAliases.includes(header),
    );
  });

  return result;
}

function validateRequiredColumns(indexMap) {
  const missingColumns = [];

  if (indexMap.address === -1) {
    missingColumns.push("Address");
  }

  if (indexMap.deviceId === -1) {
    missingColumns.push("Device ID");
  }

  if (indexMap.deviceType === -1) {
    missingColumns.push("Device type");
  }

  if (indexMap.description === -1) {
    missingColumns.push("Description");
  }

  return missingColumns;
}

function createDevicesFromCsvRows(rows) {
  if (rows.length < 2) {
    throw new Error("CSV-файл не содержит строк с устройствами");
  }

  const headers = rows[0];
  const indexMap = getColumnIndexMap(headers);
  const missingColumns = validateRequiredColumns(indexMap);

  if (missingColumns.length > 0) {
    throw new Error(`Отсутствуют колонки: ${missingColumns.join(", ")}`);
  }

  const devicesById = new Map();

  rows.slice(1).forEach((row) => {
    const deviceId = String(row[indexMap.deviceId] || "").trim();

    if (!deviceId) {
      return;
    }

    devicesById.set(deviceId, {
      address: String(row[indexMap.address] || "").trim(),

      deviceId,

      deviceType: String(row[indexMap.deviceType] || "").trim(),

      description: String(row[indexMap.description] || "").trim(),

      printed:
        indexMap.printed >= 0
          ? parseBooleanCsvValue(row[indexMap.printed])
          : false,

      installed:
        indexMap.installed >= 0
          ? parseBooleanCsvValue(row[indexMap.installed])
          : false,
    });
  });

  return Array.from(devicesById.values());
}

function mergeImportedDevices(importedDevices) {
  const existingDevicesById = new Map(
    state.devices.map((device) => [device.deviceId, device]),
  );

  return sortDevices(
    importedDevices.map((importedDevice) => {
      const existingDevice = existingDevicesById.get(importedDevice.deviceId);

      return {
        address: importedDevice.address,
        deviceId: importedDevice.deviceId,
        deviceType: importedDevice.deviceType,
        description: importedDevice.description,

        printed: existingDevice
          ? existingDevice.printed
          : importedDevice.printed,

        installed: existingDevice
          ? existingDevice.installed
          : importedDevice.installed,
      };
    }),
  );
}

async function importCsvFile(file) {
  if (!file) {
    return;
  }

  try {
    const text = await file.text();

    if (!text.trim()) {
      throw new Error("CSV-файл пуст");
    }

    const delimiter = detectDelimiter(text);

    const normalizedText = convertDelimiterToComma(text, delimiter);

    const rows = parseCsv(normalizedText);

    const importedDevices = createDevicesFromCsvRows(rows);

    if (importedDevices.length === 0) {
      throw new Error("В CSV-файле нет устройств с Device ID");
    }

    state.devices = mergeImportedDevices(importedDevices);

    state.searchQuery = "";
    state.activeFilter = "all";
    state.highlightedDeviceId = null;

    elements.searchInput.value = "";

    await saveDevices();
    render();
    closeDataMenu();

    showToast(`Импортировано устройств: ${state.devices.length}`, "success");
  } catch (error) {
    console.error("Ошибка импорта CSV:", error);

    showToast(error.message || "Не удалось импортировать CSV", "error");
  } finally {
    elements.csvFileInput.value = "";
  }
}

function exportCsv() {
  if (state.devices.length === 0) {
    showToast("Нет данных для экспорта", "error");

    return;
  }

  const headers = [...REQUIRED_CSV_COLUMNS, "Printed", "Installed"];

  const csvRows = [headers.map(escapeCsvValue).join(",")];

  sortDevices(state.devices).forEach((device) => {
    csvRows.push(
      [
        device.address,
        device.deviceId,
        device.deviceType,
        device.description,
        device.printed ? "true" : "false",
        device.installed ? "true" : "false",
      ]
        .map(escapeCsvValue)
        .join(","),
    );
  });

  const csvContent = `\uFEFF${csvRows.join("\r\n")}`;

  const blob = new Blob([csvContent], {
    type: "text/csv;charset=utf-8",
  });

  const downloadUrl = URL.createObjectURL(blob);

  const downloadLink = document.createElement("a");

  const dateValue = new Date().toISOString().slice(0, 10);

  downloadLink.href = downloadUrl;
  downloadLink.download = `fire-device-tracker-${dateValue}.csv`;

  document.body.appendChild(downloadLink);
  downloadLink.click();
  downloadLink.remove();

  URL.revokeObjectURL(downloadUrl);

  closeDataMenu();

  showToast("CSV-файл экспортирован", "success");
}

async function clearAllData() {
  if (state.devices.length === 0) {
    closeDataMenu();

    showToast("Данные уже очищены");

    return;
  }

  const firstConfirmation = window.confirm(
    "Удалить все устройства и сохраненные статусы?",
  );

  if (!firstConfirmation) {
    return;
  }

  const secondConfirmation = window.confirm(
    "Это действие нельзя отменить. Подтвердить полную очистку?",
  );

  if (!secondConfirmation) {
    return;
  }

  try {
    await dataRepository.clear();

    state.devices = [];
    state.searchQuery = "";
    state.activeFilter = "all";
    state.highlightedDeviceId = null;

    elements.searchInput.value = "";

    closeDataMenu();
    render();

    showToast("Все данные удалены", "success");
  } catch (error) {
    console.error("Ошибка очистки данных:", error);

    showToast("Не удалось очистить данные", "error");
  }
}

function openDataMenu() {
  elements.menuBackdrop.hidden = false;

  requestAnimationFrame(() => {
    elements.dataMenu.classList.add("is-open");
  });

  elements.dataMenu.setAttribute("aria-hidden", "false");

  elements.dataMenuButton.setAttribute("aria-expanded", "true");

  document.body.classList.add("is-locked");
}

function closeDataMenu() {
  elements.dataMenu.classList.remove("is-open");

  elements.dataMenu.setAttribute("aria-hidden", "true");

  elements.dataMenuButton.setAttribute("aria-expanded", "false");

  elements.menuBackdrop.hidden = true;
  document.body.classList.remove("is-locked");
}

function showToast(message, type = "default") {
  window.clearTimeout(state.toastTimer);

  elements.toast.textContent = message;

  elements.toast.classList.remove("is-error", "is-success");

  if (type === "error") {
    elements.toast.classList.add("is-error");
  }

  if (type === "success") {
    elements.toast.classList.add("is-success");
  }

  elements.toast.hidden = false;

  state.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function extractDeviceIdFromQrText(qrText) {
  const value = String(qrText || "").trim();

  if (!value) {
    return null;
  }

  const exactDevice = state.devices.find((device) => device.deviceId === value);

  if (exactDevice) {
    return exactDevice.deviceId;
  }

  const containedDevice = state.devices.find(
    (device) => device.deviceId && value.includes(device.deviceId),
  );

  if (containedDevice) {
    return containedDevice.deviceId;
  }

  const labeledMatch = value.match(
    /(?:device\s*id|deviceid|device_id|\bid)\s*[:=#-]?\s*([a-z0-9._-]{4,40})/i,
  );

  if (labeledMatch) {
    return labeledMatch[1];
  }

  const numericMatches = value.match(/\b\d{6,20}\b/g);

  if (numericMatches && numericMatches.length > 0) {
    return numericMatches[0];
  }

  const alphanumericMatches = value.match(/\b[a-z0-9][a-z0-9._-]{5,39}\b/gi);

  if (alphanumericMatches && alphanumericMatches.length > 0) {
    return alphanumericMatches[0];
  }

  return value;
}

function findDeviceByExtractedId(deviceId) {
  if (!deviceId) {
    return null;
  }

  const normalizedId = normalizeSearchValue(deviceId);

  return (
    state.devices.find(
      (device) => normalizeSearchValue(device.deviceId) === normalizedId,
    ) || null
  );
}

function scrollToHighlightedDevice() {
  requestAnimationFrame(() => {
    const isDesktop = window.matchMedia("(min-width: 900px)").matches;

    const selector = isDesktop
      ? `#desktopDeviceTableBody tr[data-device-id="${CSS.escape(
          state.highlightedDeviceId,
        )}"]`
      : `#mobileDeviceList article[data-device-id="${CSS.escape(
          state.highlightedDeviceId,
        )}"]`;

    const targetElement = document.querySelector(selector);

    if (!targetElement) {
      return;
    }

    targetElement.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  });
}

function highlightDevice(deviceId) {
  window.clearTimeout(state.highlightTimer);

  state.highlightedDeviceId = deviceId;
  render();
  scrollToHighlightedDevice();

  state.highlightTimer = window.setTimeout(() => {
    if (state.highlightedDeviceId === deviceId) {
      state.highlightedDeviceId = null;
      render();
    }
  }, 5000);
}

async function searchByQrText(qrText) {
  const extractedId = extractDeviceIdFromQrText(qrText);

  if (!extractedId) {
    showToast("Не удалось определить Device ID", "error");

    return false;
  }

  const foundDevice = findDeviceByExtractedId(extractedId);

  state.searchQuery = extractedId;
  state.activeFilter = "all";

  elements.searchInput.value = extractedId;

  if (!foundDevice) {
    state.highlightedDeviceId = null;
    render();

    showToast(`Устройство ${extractedId} не найдено`, "error");

    return false;
  }

  state.searchQuery = foundDevice.deviceId;
  elements.searchInput.value = foundDevice.deviceId;

  highlightDevice(foundDevice.deviceId);

  showToast(`Найдено устройство: ${foundDevice.address}`, "success");

  return true;
}

async function handleQrScanSuccess(decodedText) {
  if (!state.scannerRunning) {
    return;
  }

  elements.scannerStatus.textContent = "QR-код распознан";

  const found = await searchByQrText(decodedText);

  if (found) {
    await closeScanner();
  }
}

function handleQrScanError() {
  if (!state.scannerRunning) {
    return;
  }

  elements.scannerStatus.textContent = "Наведите камеру на QR-код";
}

async function startScanner() {
  if (typeof Html5Qrcode === "undefined") {
    elements.scannerStatus.textContent = "Библиотека QR Scanner не загружена";

    showToast("Файл html5-qrcode.min.js не найден", "error");

    return;
  }

  if (!window.isSecureContext && location.hostname !== "localhost") {
    elements.scannerStatus.textContent = "Камера доступна только через HTTPS";

    showToast("Для камеры необходимо открыть приложение через HTTPS", "error");

    return;
  }

  try {
    if (!state.scanner) {
      state.scanner = new Html5Qrcode("qrReader");
    }

    const readerWidth = elements.qrReader.clientWidth || 320;

    const qrBoxSize = Math.max(180, Math.min(280, readerWidth - 40));

    elements.scannerStatus.textContent = "Запрашивается доступ к камере";

    const cameras = await Html5Qrcode.getCameras();

    if (!cameras || cameras.length === 0) {
      throw new Error("Камеры не найдены");
    }

    const rearCamera =
      cameras.find((camera) => {
        const label = String(camera.label || "").toLowerCase();

        return (
          label.includes("back") ||
          label.includes("rear") ||
          label.includes("environment") ||
          label.includes("зад")
        );
      }) || cameras[cameras.length - 1];

    await state.scanner.start(
      rearCamera.id,
      {
        fps: 10,
        qrbox: {
          width: qrBoxSize,
          height: qrBoxSize,
        },
        aspectRatio: 1,
      },
      handleQrScanSuccess,
      handleQrScanError,
    );

    state.scannerRunning = true;

    elements.scannerStatus.textContent = "Наведите камеру на QR-код";
  } catch (error) {
    state.scannerRunning = false;

    console.error("Не удалось запустить камеру:", error);

    elements.scannerStatus.textContent = "Не удалось запустить камеру";

    showToast("Проверьте разрешение Safari на использование камеры", "error");
  }
}

async function stopScanner() {
  if (!state.scanner || !state.scannerRunning) {
    return;
  }

  try {
    await state.scanner.stop();
  } catch (error) {
    console.warn("Не удалось корректно остановить сканер:", error);
  }

  try {
    await state.scanner.clear();
  } catch (error) {
    console.warn("Не удалось очистить область сканера:", error);
  }

  state.scannerRunning = false;
}

async function openScanner() {
  if (state.devices.length === 0) {
    showToast("Сначала импортируйте CSV", "error");

    return;
  }

  elements.scannerModal.hidden = false;
  elements.manualQrInput.value = "";
  elements.scannerStatus.textContent = "Камера не запущена";

  document.body.classList.add("is-locked");

  await startScanner();
}

async function closeScanner() {
  await stopScanner();

  elements.scannerModal.hidden = true;
  elements.scannerStatus.textContent = "Камера не запущена";

  document.body.classList.remove("is-locked");
}

function resetSearchAndFilters() {
  state.searchQuery = "";
  state.activeFilter = "all";
  state.highlightedDeviceId = null;

  elements.searchInput.value = "";

  render();
  elements.searchInput.focus();
}

function handleSearchInput(event) {
  state.searchQuery = event.target.value;
  state.highlightedDeviceId = null;
  render();
}

function handleFilterClick(event) {
  const filterValue = event.currentTarget.dataset.filter;

  if (!filterValue) {
    return;
  }

  state.activeFilter = filterValue;
  state.highlightedDeviceId = null;

  render();
}

function handleStatusChange(event) {
  const target = event.target;

  if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
    return;
  }

  const deviceId = target.dataset.deviceId;
  const statusField = target.dataset.statusField;

  if (!deviceId || !statusField) {
    return;
  }

  updateDeviceStatus(deviceId, statusField, target.checked);
}

function bindEvents() {
  elements.searchInput.addEventListener("input", handleSearchInput);

  elements.clearSearchButton.addEventListener("click", () => {
    state.searchQuery = "";
    state.highlightedDeviceId = null;

    elements.searchInput.value = "";
    elements.searchInput.focus();

    render();
  });

  elements.filterButtons.forEach((button) => {
    button.addEventListener("click", handleFilterClick);
  });

  elements.mobileDeviceList.addEventListener("change", handleStatusChange);

  elements.desktopDeviceTableBody.addEventListener(
    "change",
    handleStatusChange,
  );

  elements.dataMenuButton.addEventListener("click", openDataMenu);

  elements.closeDataMenuButton.addEventListener("click", closeDataMenu);

  elements.menuBackdrop.addEventListener("click", closeDataMenu);

  elements.importButton.addEventListener("click", () => {
    elements.csvFileInput.click();
  });

  elements.emptyImportButton.addEventListener("click", () => {
    elements.csvFileInput.click();
  });

  elements.csvFileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];

    importCsvFile(file);
  });

  elements.exportButton.addEventListener("click", exportCsv);

  elements.clearDataButton.addEventListener("click", clearAllData);

  elements.resetFiltersButton.addEventListener("click", resetSearchAndFilters);

  elements.scannerButton.addEventListener("click", openScanner);

  elements.closeScannerButton.addEventListener("click", closeScanner);

  elements.scannerModal.addEventListener("click", (event) => {
    if (event.target === elements.scannerModal) {
      closeScanner();
    }
  });

  elements.manualQrSearchButton.addEventListener("click", async () => {
    const qrText = elements.manualQrInput.value;

    const found = await searchByQrText(qrText);

    if (found) {
      await closeScanner();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }

    if (!elements.scannerModal.hidden) {
      closeScanner();
      return;
    }

    if (elements.dataMenu.classList.contains("is-open")) {
      closeDataMenu();
    }
  });

  window.addEventListener("pagehide", () => {
    if (state.scannerRunning) {
      stopScanner();
    }
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js?v=7");
  } catch (error) {
    console.error("Service Worker не зарегистрирован:", error);
  }
}

async function initializeApp() {
  bindEvents();

  state.devices = sortDevices(await dataRepository.getAll());

  render();

  await registerServiceWorker();
}

initializeApp();
