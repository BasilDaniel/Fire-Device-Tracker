"use strict";

const STORAGE_KEY = "fire-device-tracker-v6";

let devices = [];
let deferredPrompt = null;

let html5QrCode = null;
let scannerRunning = false;
let scanLocked = false;
let pendingScannedId = "";
let highlightedDeviceId = "";

const $ = (id) => document.getElementById(id);

const search = $("search");
const blockFilter = $("blockFilter");
const statusFilter = $("statusFilter");

const cards = $("cards");
const tbody = document.querySelector("#deviceTable tbody");
const cardTemplate = $("cardTemplate");

const dataMenuBackdrop = $("dataMenuBackdrop");
const scannerModal = $("scannerModal");
const scanConfirmModal = $("scanConfirmModal");

/* ------------------------------------------------------------------
   Data
------------------------------------------------------------------ */

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();

  return ["1", "true", "yes", "да", "printed", "installed"].includes(
    normalized,
  );
}

function normalizeRow(row) {
  return {
    block: row.block ?? row.Block ?? "",

    address: row.address ?? row.Address ?? "",

    deviceId: String(row.deviceId ?? row["Device ID"] ?? "").trim(),

    deviceType: row.deviceType ?? row["Device type"] ?? "",

    description: row.description ?? row.Description ?? "",

    printed: normalizeBoolean(row.printed ?? row.Printed),

    installed: normalizeBoolean(row.installed ?? row.Installed),
  };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(devices));
}

function load() {
  const raw = localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    devices = [];
    render();
    return;
  }

  try {
    const parsed = JSON.parse(raw);

    devices = Array.isArray(parsed) ? parsed.map(normalizeRow) : [];
  } catch (error) {
    console.error("Ошибка чтения localStorage:", error);
    devices = [];
  }

  render();
}

/* ------------------------------------------------------------------
   CSV
------------------------------------------------------------------ */

function detectDelimiter(firstLine) {
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;

  return semicolonCount > commaCount ? ";" : ",";
}

function csvParse(text) {
  const cleaned = String(text ?? "").replace(/^\uFEFF/, "");

  const firstLine = cleaned.split(/\r?\n/, 1)[0] ?? "";

  const delimiter = detectDelimiter(firstLine);

  const rows = [];

  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const char = cleaned[i];
    const next = cleaned[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }

      row.push(cell);
      cell = "";

      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    cell += char;
  }

  row.push(cell);

  if (row.some((value) => value.trim() !== "")) {
    rows.push(row);
  }

  return rows;
}

function importCsv(text) {
  const rows = csvParse(text);

  if (rows.length < 2) {
    throw new Error("CSV пустой или не содержит строк данных.");
  }

  const headers = rows[0].map((header) => String(header).trim());

  const requiredHeaders = [
    "Block",
    "Address",
    "Device ID",
    "Device type",
    "Description",
  ];

  const missingHeaders = requiredHeaders.filter(
    (header) => !headers.includes(header),
  );

  if (missingHeaders.length > 0) {
    throw new Error(`Отсутствуют колонки: ${missingHeaders.join(", ")}`);
  }

  const importedDevices = rows
    .slice(1)
    .map((columns) => {
      const row = {};

      headers.forEach((header, index) => {
        row[header] = columns[index] ?? "";
      });

      return normalizeRow(row);
    })
    .filter((device) => device.deviceId || device.address);

  /*
   * При повторном импорте сохраняем текущие статусы
   * по Device ID.
   */
  const currentStatuses = new Map(
    devices.map((device) => [
      device.deviceId,
      {
        printed: device.printed,
        installed: device.installed,
      },
    ]),
  );

  devices = importedDevices.map((device) => {
    const previous = currentStatuses.get(device.deviceId);

    if (!previous) {
      return device;
    }

    return {
      ...device,
      printed: previous.printed,
      installed: previous.installed,
    };
  });

  save();
  render();
}

function csvEscape(value) {
  const text = String(value ?? "");

  if (/[",;\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function exportCsv() {
  const header = [
    "Block",
    "Address",
    "Device ID",
    "Device type",
    "Description",
    "Printed",
    "Installed",
  ];

  const lines = [header.join(",")];

  devices.forEach((device) => {
    lines.push(
      [
        device.block,
        device.address,
        device.deviceId,
        device.deviceType,
        device.description,
        device.printed,
        device.installed,
      ]
        .map(csvEscape)
        .join(","),
    );
  });

  downloadFile(
    "fire-devices.csv",
    "\uFEFF" + lines.join("\n"),
    "text/csv;charset=utf-8",
  );
}

/* ------------------------------------------------------------------
   Filtering and rendering
------------------------------------------------------------------ */

function getFilteredDevices() {
  const query = search.value.trim().toLowerCase();

  const selectedBlock = blockFilter.value;
  const selectedStatus = statusFilter.value;

  return devices.filter((device) => {
    const searchText = [
      device.block,
      device.address,
      device.deviceId,
      device.deviceType,
      device.description,
    ]
      .join(" ")
      .toLowerCase();

    const matchesSearch = !query || searchText.includes(query);

    const matchesBlock = !selectedBlock || device.block === selectedBlock;

    let matchesStatus = true;

    if (selectedStatus === "not_printed") {
      matchesStatus = !device.printed;
    }

    if (selectedStatus === "printed") {
      matchesStatus = device.printed && !device.installed;
    }

    if (selectedStatus === "installed") {
      matchesStatus = device.installed;
    }

    return matchesSearch && matchesBlock && matchesStatus;
  });
}

function updateDeviceStatus(deviceIndex, field, checked) {
  const device = devices[deviceIndex];

  if (!device) {
    return;
  }

  device[field] = checked;

  /*
   * Если устройство наклеено,
   * оно автоматически считается распечатанным.
   */
  if (field === "installed" && checked) {
    device.printed = true;
  }

  /*
   * Если снимается отметка "распечатано",
   * снимаем и "наклеено".
   */
  if (field === "printed" && !checked) {
    device.installed = false;
  }

  save();
  render();
}

function updateBlockOptions() {
  const currentBlock = blockFilter.value;

  const blocks = [
    ...new Set(devices.map((device) => device.block).filter(Boolean)),
  ].sort((a, b) =>
    a.localeCompare(b, undefined, {
      numeric: true,
    }),
  );

  blockFilter.innerHTML = '<option value="">Все блоки</option>';

  blocks.forEach((block) => {
    const option = document.createElement("option");

    option.value = block;
    option.textContent = block;

    if (block === currentBlock) {
      option.selected = true;
    }

    blockFilter.appendChild(option);
  });
}

function createDesktopRow(device) {
  const deviceIndex = devices.indexOf(device);

  const row = document.createElement("tr");

  if (highlightedDeviceId && device.deviceId === highlightedDeviceId) {
    row.classList.add("highlighted");
  }

  const blockCell = document.createElement("td");
  blockCell.textContent = device.block;

  const addressCell = document.createElement("td");
  const addressStrong = document.createElement("strong");

  addressStrong.textContent = device.address;
  addressCell.appendChild(addressStrong);

  const idCell = document.createElement("td");
  idCell.textContent = device.deviceId;

  const typeCell = document.createElement("td");
  typeCell.textContent = device.deviceType;

  const descriptionCell = document.createElement("td");
  descriptionCell.textContent = device.description;

  const printedCell = document.createElement("td");
  printedCell.className = "status";

  const printedCheckbox = document.createElement("input");
  printedCheckbox.type = "checkbox";
  printedCheckbox.checked = device.printed;

  printedCheckbox.addEventListener("change", (event) => {
    updateDeviceStatus(deviceIndex, "printed", event.target.checked);
  });

  printedCell.appendChild(printedCheckbox);

  const installedCell = document.createElement("td");
  installedCell.className = "status";

  const installedCheckbox = document.createElement("input");
  installedCheckbox.type = "checkbox";
  installedCheckbox.checked = device.installed;

  installedCheckbox.addEventListener("change", (event) => {
    updateDeviceStatus(deviceIndex, "installed", event.target.checked);
  });

  installedCell.appendChild(installedCheckbox);

  row.append(
    blockCell,
    addressCell,
    idCell,
    typeCell,
    descriptionCell,
    printedCell,
    installedCell,
  );

  return row;
}

function createMobileCard(device) {
  const deviceIndex = devices.indexOf(device);

  const fragment = cardTemplate.content.cloneNode(true);

  const card = fragment.querySelector(".device-card");

  if (highlightedDeviceId && device.deviceId === highlightedDeviceId) {
    card.classList.add("highlighted");
  }

  fragment.querySelector(".address").textContent = device.address;

  fragment.querySelector(".block").textContent = device.block || "Без блока";

  fragment.querySelector(".type").textContent =
    device.deviceType || "Устройство";

  fragment.querySelector(".device-id").textContent = `ID: ${device.deviceId}`;

  fragment.querySelector(".description").textContent = device.description;

  const printedCheckbox = fragment.querySelector(".printed-check");

  const installedCheckbox = fragment.querySelector(".installed-check");

  printedCheckbox.checked = device.printed;

  installedCheckbox.checked = device.installed;

  printedCheckbox.addEventListener("change", (event) => {
    updateDeviceStatus(deviceIndex, "printed", event.target.checked);
  });

  installedCheckbox.addEventListener("change", (event) => {
    updateDeviceStatus(deviceIndex, "installed", event.target.checked);
  });

  return fragment;
}

function render() {
  updateBlockOptions();

  const filteredDevices = getFilteredDevices();

  $("emptyState").classList.toggle("hidden", devices.length > 0);

  $("totalCount").textContent = devices.length;

  $("printedCount").textContent = devices.filter(
    (device) => device.printed,
  ).length;

  $("installedCount").textContent = devices.filter(
    (device) => device.installed,
  ).length;

  tbody.innerHTML = "";
  cards.innerHTML = "";

  filteredDevices.forEach((device) => {
    tbody.appendChild(createDesktopRow(device));

    cards.appendChild(createMobileCard(device));
  });

  if (highlightedDeviceId && filteredDevices.length > 0) {
    requestAnimationFrame(() => {
      const highlighted = document.querySelector(".highlighted");

      highlighted?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
  }
}

/* ------------------------------------------------------------------
   Data menu
------------------------------------------------------------------ */

function openDataMenu() {
  dataMenuBackdrop.classList.remove("hidden");
  dataMenuBackdrop.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";
}

function closeDataMenu() {
  dataMenuBackdrop.classList.add("hidden");
  dataMenuBackdrop.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";
}

/* ------------------------------------------------------------------
   QR scanner
------------------------------------------------------------------ */

function extractDeviceId(decodedText) {
  const text = String(decodedText ?? "").trim();

  /*
   * Ищем десятизначный Device ID
   * внутри любого содержимого QR.
   */
  const match = text.match(/(?:^|\D)(\d{10})(?:\D|$)/);

  if (match) {
    return match[1];
  }

  /*
   * Если QR содержит ровно 10 цифр.
   */
  if (/^\d{10}$/.test(text)) {
    return text;
  }

  return "";
}

async function stopScannerCamera() {
  if (!html5QrCode || !scannerRunning) {
    return;
  }

  try {
    await html5QrCode.stop();
  } catch (error) {
    console.warn("Ошибка остановки камеры:", error);
  }

  try {
    await html5QrCode.clear();
  } catch (error) {
    console.warn("Ошибка очистки QR-сканера:", error);
  }

  scannerRunning = false;
}

async function closeScanner() {
  await stopScannerCamera();

  pendingScannedId = "";
  scanLocked = false;

  scannerModal.classList.add("hidden");
  scannerModal.setAttribute("aria-hidden", "true");

  scanConfirmModal.classList.add("hidden");
  scanConfirmModal.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";
}

async function handleScanSuccess(decodedText) {
  /*
   * Защищает от нескольких результатов подряд.
   */
  if (scanLocked) {
    return;
  }

  const deviceId = extractDeviceId(decodedText);

  if (!deviceId) {
    return;
  }

  scanLocked = true;
  pendingScannedId = deviceId;

  if ("vibrate" in navigator) {
    navigator.vibrate(80);
  }

  await stopScannerCamera();

  scannerModal.classList.add("hidden");
  scannerModal.setAttribute("aria-hidden", "true");

  $("scanConfirmId").textContent = deviceId;

  scanConfirmModal.classList.remove("hidden");

  scanConfirmModal.setAttribute("aria-hidden", "false");
}

async function startScanner() {
  /*
   * Старый ID очищается при каждом новом запуске.
   */
  search.value = "";
  highlightedDeviceId = "";
  pendingScannedId = "";
  scanLocked = false;

  render();

  scanConfirmModal.classList.add("hidden");

  scannerModal.classList.remove("hidden");
  scannerModal.setAttribute("aria-hidden", "false");

  document.body.style.overflow = "hidden";

  if (!html5QrCode) {
    html5QrCode = new Html5Qrcode("qrReader");
  }

  if (scannerRunning) {
    return;
  }

  try {
    await html5QrCode.start(
      {
        facingMode: "environment",
      },
      {
        fps: 7,

        /*
         * Библиотека анализирует только центральную
         * небольшую область, поэтому соседние QR-коды
         * реже попадают в результат.
         */
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const minSide = Math.min(viewfinderWidth, viewfinderHeight);

          const size = Math.floor(Math.min(minSide * 0.38, 210));

          return {
            width: size,
            height: size,
          };
        },

        aspectRatio: 1.333333,
        disableFlip: true,
      },
      handleScanSuccess,
      () => {
        /*
         * Ошибки "QR не найден" не показываем.
         */
      },
    );

    scannerRunning = true;
  } catch (error) {
    console.error("Не удалось запустить камеру:", error);

    scannerRunning = false;

    scannerModal.classList.add("hidden");
    scannerModal.setAttribute("aria-hidden", "true");

    document.body.style.overflow = "";

    alert(
      "Не удалось открыть камеру. " +
        "Проверьте доступ к камере и убедитесь, " +
        "что сайт открыт через HTTPS.",
    );
  }
}

async function confirmScannedId() {
  if (!pendingScannedId) {
    return;
  }

  const deviceId = pendingScannedId;

  search.value = deviceId;
  highlightedDeviceId = deviceId;

  pendingScannedId = "";
  scanLocked = false;

  scanConfirmModal.classList.add("hidden");
  scanConfirmModal.setAttribute("aria-hidden", "true");

  document.body.style.overflow = "";

  render();

  const exists = devices.some((device) => device.deviceId === deviceId);

  if (!exists) {
    alert(`Device ID ${deviceId} отсутствует в таблице.`);
  }
}

async function retryScanner() {
  pendingScannedId = "";
  scanLocked = false;

  /*
   * Перед повторным сканированием снова
   * очищаем старый результат.
   */
  search.value = "";
  highlightedDeviceId = "";

  scanConfirmModal.classList.add("hidden");
  scanConfirmModal.setAttribute("aria-hidden", "true");

  render();

  await startScanner();
}

/* ------------------------------------------------------------------
   Files and backup
------------------------------------------------------------------ */

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/* ------------------------------------------------------------------
   Event handlers
------------------------------------------------------------------ */

$("openDataMenuBtn").addEventListener("click", openDataMenu);

$("closeDataMenuBtn").addEventListener("click", closeDataMenu);

dataMenuBackdrop.addEventListener("click", (event) => {
  if (event.target === dataMenuBackdrop) {
    closeDataMenu();
  }
});

search.addEventListener("input", () => {
  highlightedDeviceId = "";
  render();
});

blockFilter.addEventListener("change", render);

statusFilter.addEventListener("change", render);

$("scanQrBtn").addEventListener("click", async () => {
  await stopScannerCamera();
  await startScanner();
});

$("closeScannerBtn").addEventListener("click", closeScanner);

$("confirmScanBtn").addEventListener("click", confirmScannedId);

$("retryScanBtn").addEventListener("click", retryScanner);

$("cancelScanBtn").addEventListener("click", closeScanner);

$("csvInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    importCsv(text);
    closeDataMenu();

    alert(`Импортировано устройств: ${devices.length}`);
  } catch (error) {
    console.error(error);
    alert(error.message);
  } finally {
    event.target.value = "";
  }
});

$("exportCsvBtn").addEventListener("click", exportCsv);

$("exportJsonBtn").addEventListener("click", () => {
  downloadFile(
    "fire-devices-backup.json",
    JSON.stringify(devices, null, 2),
    "application/json",
  );
});

$("jsonInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  try {
    const parsed = JSON.parse(await file.text());

    if (!Array.isArray(parsed)) {
      throw new Error("Резервная копия имеет неверный формат.");
    }

    devices = parsed.map(normalizeRow);

    save();
    render();
    closeDataMenu();

    alert(`Восстановлено устройств: ${devices.length}`);
  } catch (error) {
    console.error(error);
    alert(error.message);
  } finally {
    event.target.value = "";
  }
});

$("resetBtn").addEventListener("click", () => {
  const firstConfirmation = confirm(
    "Очистить все локальные данные и отметки? " +
      "Это действие нельзя отменить без резервной копии.",
  );

  if (!firstConfirmation) {
    return;
  }

  const confirmationText = prompt("Для подтверждения введите слово УДАЛИТЬ");

  if (confirmationText !== "УДАЛИТЬ") {
    alert("Очистка отменена.");
    return;
  }

  devices = [];
  search.value = "";
  highlightedDeviceId = "";

  save();
  render();
  closeDataMenu();

  alert("Локальные данные очищены.");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (!scanConfirmModal.classList.contains("hidden")) {
    closeScanner();
    return;
  }

  if (!scannerModal.classList.contains("hidden")) {
    closeScanner();
    return;
  }

  closeDataMenu();
});

/* ------------------------------------------------------------------
   PWA installation
------------------------------------------------------------------ */

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;

  $("installBtn").classList.remove("hidden");
});

$("installBtn").addEventListener("click", async () => {
  if (!deferredPrompt) {
    return;
  }

  deferredPrompt.prompt();

  await deferredPrompt.userChoice;

  deferredPrompt = null;

  $("installBtn").classList.add("hidden");
});

/* ------------------------------------------------------------------
   Service worker
------------------------------------------------------------------ */

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js?v=6");
    } catch (error) {
      console.error("Ошибка регистрации service worker:", error);
    }
  });
}

/* ------------------------------------------------------------------
   Startup
------------------------------------------------------------------ */

load();
